/**
 * Heartbeat — is every pipeline that feeds this dashboard still running?
 *
 * `/roadmap` is the only surface that admits its data may be stale. Everywhere
 * else renders old data with the confidence of fresh data, so a dead pipeline
 * looks exactly like a quiet one. This is that banner, generalised.
 *
 * Reports the way `drift-check` does — a dated intel alert in operations, which
 * the /intel feed and Today already surface — and only when findings CHANGE, so
 * a known-late job does not re-announce itself every run into noise.
 *
 * Expectations are read from the LIVE cron schedules wherever they can be, not
 * hardcoded; `declaredHours` below is the fallback, and a disagreement between
 * the two is itself reported. See src/lib/heartbeat.ts for why.
 *
 * Run:  node --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/heartbeat.ts [--dry]
 */
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import matter from 'gray-matter'
import { PATHS } from '../src/lib/paths.ts'
import { runCommandArgs, getNormalizedCronJobs, getCronJobs } from '../src/lib/shell.ts'
import { localToday } from '../src/lib/dates.ts'
import { maxGapHours } from '../src/lib/cron-schedule.ts'
import { evaluateBeat, findings, type Pipeline, type Probe, type Beat, type Evidence } from '../src/lib/heartbeat.ts'

const DRY = process.argv.includes('--dry')
const STATE = path.join(os.homedir(), '.local/state/heartbeat.json')
const HOME = os.homedir()
const ops = (p: string) => path.join(PATHS.operationsRoot, p)

/**
 * Every pipeline whose output this dashboard renders as if it were current.
 *
 * The bar for inclusion is that a run leaves EVIDENCE somewhere — a log line, a
 * stamped artifact, a dated file. A pipeline nobody can probe is not listed and
 * pretending otherwise would be the exact failure this script exists to catch;
 * `unclaimedCrons()` below reports those from the other direction instead.
 */
const PIPELINES: Pipeline[] = [
  {
    key: 'roadmap-check', name: 'Roadmap check', cron: 'roadmap-check',
    produces: 'roadmap/_status.md — every state, stage and ranking on /roadmap',
    // Weekdays 08:00, so the honest gap is Friday to Monday.
    declaredHours: 72, runsOn: 'mini',
    probes: [
      { kind: 'log-ok', path: PATHS.roadmapCheckLog, pattern: '^(\\S+) ok\\b' },
      { kind: 'frontmatter', path: PATHS.roadmapStatus, field: 'generated_at' },
    ],
  },
  {
    key: 'bid-sync', name: 'Bid sync', cron: 'bid-sync',
    produces: 'the bid pipeline on /bids and Today',
    declaredHours: 1, runsOn: 'mini',
    probes: [{ kind: 'log-ok', path: PATHS.bidSyncLog, pattern: '^(\\S+)' }],
  },
  {
    key: 'lead-sync', name: 'Lead sync', cron: 'lead-sync',
    produces: 'crm/leads/ — solicitations matched to the pipeline',
    declaredHours: 24, runsOn: 'mini', quietRunsAreNormal: true,
    probes: [{ kind: 'mtime', path: PATHS.crmLeads }],
  },
  {
    key: 'caleprocure-scan', name: 'Cal eProcure scan', cron: 'caleprocure',
    produces: 'intelligence/procurements/ — new solicitations and their deadlines',
    declaredHours: 24, runsOn: 'mini', quietRunsAreNormal: true,
    probes: [{ kind: 'dated-file', dir: ops('intelligence/procurements'), match: 'caleprocure' }],
  },
  {
    key: 'intel-watch-sources', name: 'Source watch', cron: 'intel-watch-sources',
    produces: 'intelligence/watch/ — what changed on the CDT, Governor, DGS SLP and AB 412 pages',
    declaredHours: 24, runsOn: 'mini', quietRunsAreNormal: true,
    // One file per watched page (slugs from scripts/watch-sources.ts), each
    // stamped only when its page changed; the newest stamp wins. A run that
    // finds nothing writes nothing, so the cron's run record is the real answer.
    probes: ['cdt-news', 'gov-newsroom', 'dgs-slp', 'ab-412'].map(slug =>
      ({ kind: 'frontmatter', path: ops(`intelligence/watch/${slug}.md`), field: 'checked_at' }) as Probe),
  },
  {
    key: 'sunday-brief', name: 'Sunday brief', cron: 'weekly-strategic-briefing',
    produces: 'intelligence/weekly/<date>-brief.md — the Sunday-night owed / closing / broken digest',
    // Sundays 20:00, so the honest gap is a week.
    declaredHours: 168, runsOn: 'mini',
    probes: [{ kind: 'dated-file', dir: ops('intelligence/weekly'), match: '-brief.md' }],
  },
  {
    key: 'email-sync', name: 'Email sync', cron: 'email-sync',
    produces: 'crm/intake/ — the correspondent review queue',
    declaredHours: 24, runsOn: 'mini',
    probes: [{ kind: 'log-ok', path: PATHS.emailSyncLog, pattern: '^(\\S+)' }],
  },
  {
    key: 'drift-check', name: 'Drift check',
    produces: 'dead citations, split agency slugs, stale agent context',
    declaredHours: 168, runsOn: 'macbook', quietRunsAreNormal: true,
    probes: [{ kind: 'dated-file', dir: PATHS.intelligence, match: 'drift-report' }],
  },
  {
    key: 'outreach', name: 'Outreach view',
    produces: 'intelligence/priority-outreach.md — the action items on Today',
    declaredHours: 24, runsOn: 'mini', quietRunsAreNormal: true,
    probes: [{ kind: 'mtime', path: ops('intelligence/priority-outreach.md') }],
  },
  {
    key: 'roadmap-watch', name: 'Roadmap watch',
    produces: 'a roadmap-check run within minutes of any push to any repo (the board follows the repos)',
    // launchd every 5 min; a quiet hour means the tick itself stopped.
    declaredHours: 1, runsOn: 'mini',
    probes: [{ kind: 'log-ok', path: path.join(HOME, '.openclaw/logs/roadmap-watch.log'), pattern: '^(\\S+) (quiet|triggered)\\b' }],
  },
  {
    key: 'nexus-sync', name: 'Nexus clone sync',
    produces: 'the read-only Nexus clone every health scan and roadmap check reads',
    declaredHours: 24, runsOn: 'mini',
    // Both candidate locations: `repos/Nexus` on the mini, `infiniteai_platform`
    // on the MacBook. Listing both means neither machine reports a false "never".
    probes: [
      { kind: 'mtime', path: path.join(HOME, 'repos/Nexus/.git/FETCH_HEAD') },
      { kind: 'mtime', path: path.join(HOME, 'infiniteai_platform/.git/FETCH_HEAD') },
    ],
  },
  {
    key: 'deploy', name: 'Dashboard deploy',
    produces: 'the code the mini is actually serving',
    declaredHours: 24, runsOn: 'mini',
    probes: [{ kind: 'frontmatter', path: path.join(HOME, '.openclaw/state/command-center-deploy.json'), field: 'at' }],
  },
]

// ── probes ──────────────────────────────────────────────────────────────────

/** `seen` says the source EXISTS here, independent of whether it evidenced a run. */
async function runProbe(p: Probe): Promise<{ at: string | null; seen: boolean }> {
  const val = async (): Promise<string | null> => {
    switch (p.kind) {
      case 'log-ok': {
        const lines = (await fs.readFile(p.path, 'utf-8')).trim().split('\n')
        const re = new RegExp(p.pattern)
        for (let i = lines.length - 1; i >= 0; i--) {
          const m = re.exec(lines[i])
          if (m && !Number.isNaN(new Date(m[1]).getTime())) return m[1]
        }
        return null
      }
      case 'frontmatter': {
        const raw = await fs.readFile(p.path, 'utf-8')
        // The deploy state is JSON, not markdown; accept both so one probe kind
        // covers a stamped artifact whatever its format.
        if (p.path.endsWith('.json')) {
          const v = JSON.parse(raw)[p.field]
          return typeof v === 'string' ? v : null
        }
        const v = matter(raw).data[p.field]
        return v instanceof Date ? v.toISOString() : (typeof v === 'string' ? v : null)
      }
      case 'dated-file': {
        const names = (await fs.readdir(p.dir))
          .filter(n => n.includes(p.match) && /^\d{4}-\d{2}-\d{2}/.test(n))
          .sort()
        const last = names[names.length - 1]
        if (!last) return null
        // Midday, so a date-only filename is not read as "23h old at 23:00".
        return new Date(`${last.slice(0, 10)}T12:00:00`).toISOString()
      }
      case 'mtime': {
        const st = await fs.stat(p.path)
        return new Date(st.mtimeMs).toISOString()
      }
    }
    return null
  }
  try {
    return { at: await val(), seen: true }
  } catch {
    // Missing source on this machine is "no evidence here", never "never ran".
    return { at: null, seen: false }
  }
}

/** The newest evidence across every probe — see decision 1 in the lib header. */
async function probeAll(p: Pipeline): Promise<Evidence> {
  let at: string | null = null
  let kind: Evidence['kind'] = 'none'
  let sourceSeen = false
  for (const probe of p.probes) {
    const r = await runProbe(probe)
    if (r.seen) sourceSeen = true
    if (r.at && (!at || r.at > at)) {
      at = r.at
      kind = probe.kind === 'log-ok' ? 'run-record' : 'artifact'
    }
  }
  return { at, kind, sourceSeen }
}

// ── cron store export ───────────────────────────────────────────────────────
//
// The live cron store is a sqlite file on the mini that nothing backs up, and
// only 4 of its 13 jobs have installers; the other 9 exist only there (audit
// 2026-09-14). This writes the DEFINITIONS (never the run state) to
// operations/agents/main/cron-jobs.json whenever they change, so the janitor
// commits them and a rebuilt mini can recreate every job. Env values whose key
// looks like a secret are redacted; payloads only ever carried paths so far.

const SECRET_KEY = /token|secret|password|passwd|api[_-]?key|private/i

async function exportCronStore(raw: unknown[]): Promise<string | null> {
  const defs = (raw as Record<string, unknown>[]).map(j => {
    const payload = j.payload as Record<string, unknown> | undefined
    const env = payload?.env as Record<string, string> | undefined
    return {
      id: j.id, name: j.name, description: j.description, enabled: j.enabled, agentId: j.agentId,
      schedule: j.schedule, sessionTarget: j.sessionTarget, wakeMode: j.wakeMode,
      payload: payload && {
        ...payload,
        env: env && Object.fromEntries(Object.entries(env).map(([k, v]) => [k, SECRET_KEY.test(k) ? '<redacted>' : v])),
      },
      delivery: j.delivery, failureAlert: j.failureAlert,
    }
  }).sort((a, b) => String(a.name).localeCompare(String(b.name)))
  const out = `${JSON.stringify(defs, null, 2)}\n`
  const target = path.join(PATHS.operationsRoot, 'agents/main/cron-jobs.json')
  let prev = ''
  try { prev = await fs.readFile(target, 'utf8') } catch { /* first export */ }
  if (prev === out) return null
  await fs.writeFile(target, out)
  const rel = path.relative(PATHS.operationsRoot, target)
  try {
    await runCommandArgs('git', ['-C', PATHS.operationsRoot, 'add', '--', rel], 15_000)
    await runCommandArgs('git', ['-C', PATHS.operationsRoot, 'commit', '-q',
      '-m', `ops: cron store export (${defs.length} jobs)`, '-m', 'via: heartbeat', '--', rel], 15_000)
  } catch { /* the janitor sweeps */ }
  return rel
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  const { reachable, jobs } = await getNormalizedCronJobs()
  if (!DRY && reachable) {
    const { raw } = await getCronJobs()
    if (raw.length) {
      const exported = await exportCronStore(raw)
      if (exported) console.log(`heartbeat: cron store changed → ${exported}`)
    }
  }
  const matchJob = (needle?: string) =>
    needle ? jobs.find(j => j.name.toLowerCase().includes(needle.toLowerCase())) : undefined

  const beats: Beat[] = []
  const errors: string[] = []
  for (const p of PIPELINES) {
    const job = matchJob(p.cron)
    const gap = job?.scheduleExpr ? maxGapHours(job.scheduleExpr) : null
    // The cron store's own lastRunAt is evidence too, and better than a log for
    // a job whose log this machine cannot see.
    const fromCron = job?.lastRunStatus === 'ok' ? job.lastRunAt ?? null : null
    const probed = await probeAll(p)
    // The cron store is a RUN RECORD and outranks an artifact stamp, which is
    // what lets the mini tell a quiet pipeline from a dead one.
    const ev: Evidence = fromCron && (!probed.at || fromCron > probed.at)
      ? { at: fromCron, kind: 'run-record', sourceSeen: true }
      : { ...probed, sourceSeen: probed.sourceSeen || Boolean(job) }
    beats.push(evaluateBeat(p, ev, gap))

    if (job && !job.enabled) errors.push(`**${p.name}** — cron \`${job.name}\` is DISABLED`)
    if (job && job.consecutiveErrors > 0) {
      errors.push(`**${p.name}** — cron \`${job.name}\` has ${job.consecutiveErrors} consecutive `
        + `error(s)${job.lastError ? `: ${job.lastError.slice(0, 120)}` : ''}`)
    }
  }

  // The other direction: a cron nobody in PIPELINES claims is a job whose output
  // nothing is watching. Only meaningful when the gateway answered.
  const claimed = new Set(PIPELINES.map(p => matchJob(p.cron)?.name).filter(Boolean))
  const unclaimed = reachable ? jobs.filter(j => !claimed.has(j.name)).map(j => j.name) : []

  const bad = findings(beats)
  const total = bad.length + errors.length + unclaimed.length

  if (DRY) {
    console.log(`heartbeat --dry · cron gateway ${reachable ? 'reachable' : 'UNREACHABLE (expectations fall back to declared)'}`)
    for (const b of beats) {
      console.log(`  ${b.state.toUpperCase().padEnd(7)} ${b.name.padEnd(20)} ${b.detail}${b.drift ? ` · DRIFT: ${b.drift}` : ''}`)
    }
    for (const e of errors) console.log(`  ERROR   ${e.replace(/\*\*/g, '')}`)
    if (unclaimed.length) console.log(`  UNWATCHED cron jobs: ${unclaimed.join(', ')}`)
    return
  }

  const fingerprint = crypto.createHash('sha1')
    .update(JSON.stringify({
      bad: bad.map(b => [b.key, b.state, b.drift ?? '']), errors, unclaimed,
    })).digest('hex')
  let prev = ''
  try { prev = JSON.parse(await fs.readFile(STATE, 'utf8')).fingerprint } catch { /* first run */ }

  const save = async () => {
    await fs.mkdir(path.dirname(STATE), { recursive: true })
    await fs.writeFile(STATE, JSON.stringify({ fingerprint, at: new Date().toISOString() }))
  }

  if (total === 0) { await save(); console.log('heartbeat: all pipelines healthy'); return }
  if (fingerprint === prev) {
    console.log(`heartbeat: ${total} known finding(s), unchanged — not re-announcing`)
    return
  }

  const s: string[] = [
    `# Heartbeat — ${localToday()}`,
    '',
    'Pipelines whose output this dashboard renders as if it were current. A late',
    'pipeline does not make the dashboard look broken — it makes it look fine and',
    'be wrong, which is the reason this check exists. Expectations are read from',
    'the live cron schedules; `declared` means the schedule could not be read.',
    '',
  ]
  if (!reachable) {
    s.push('> The cron gateway was unreachable, so every expectation below is the',
      '> declared fallback rather than the live schedule.', '')
  }
  const section = (title: string, rows: string[]) => {
    if (rows.length) s.push(`## ${title} (${rows.length})`, '', ...rows, '')
  }
  section('Pipelines needing attention', bad.map(b =>
    `- **${b.name}** — ${b.state}. ${b.detail}. Produces: ${b.produces}.`
    + (b.drift ? ` _Schedule drift: ${b.drift}._` : '')))
  section('Cron jobs in trouble', errors.map(e => `- ${e}`))
  section('Cron jobs nothing is watching', unclaimed.map(n =>
    `- \`${n}\` — runs, but no pipeline in \`scripts/heartbeat.ts\` claims its output.`))

  const alertPath = path.join(PATHS.intelligence, `${localToday()}-heartbeat.md`)
  await fs.mkdir(PATHS.intelligence, { recursive: true })
  await fs.writeFile(alertPath, `${s.join('\n')}\n`)
  const rel = path.relative(PATHS.operationsRoot, alertPath)
  try {
    await runCommandArgs('git', ['-C', PATHS.operationsRoot, 'add', '--', rel], 15_000)
    await runCommandArgs('git', ['-C', PATHS.operationsRoot, 'commit', '-q',
      '-m', `intel: heartbeat — ${total} finding(s)`, '-m', 'via: heartbeat', '--', rel], 15_000)
  } catch { /* the janitor sweeps */ }
  await save()
  console.log(`heartbeat: ${total} finding(s) → ${rel}`)
}

main().catch(err => { console.error('heartbeat failed:', err); process.exit(1) })
