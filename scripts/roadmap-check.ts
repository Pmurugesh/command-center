/**
 * Weekly roadmap check — regenerate `operations/roadmap/_status.md` (Phase 12).
 *
 * Answers "are we on time?" for the ten tracked initiatives, from two numbers
 * per initiative: days to the target you set, and days since the last HUMAN
 * commit touching the evidence path. The second number is the whole trick — a
 * deadline approaching with nothing landing where the work should land is the
 * only honest slip signal available without status meetings.
 *
 * Three rules this script exists to obey, each learned from a real failure on
 * 2026-09-08:
 *
 *  1. **Read `origin`, never a working tree.** The mini's contract-management
 *     clone was 98 days behind its own origin; Nexus was 12 behind. A check
 *     against working trees declares live initiatives dead.
 *  2. **Exclude machine commits.** operations takes ~250 commits/90d of which
 *     the clear majority are janitor and cron writes (`auto:`, `crm: log touch`,
 *     Paladin). An evidence path under a machine-written tree is green forever.
 *     contract-management carries renovate[bot] for the same reason.
 *  3. **Absence renders unknown, never green.** A repo that will not fetch, a
 *     path that resolves to nothing — those are `error`, and `deriveState` turns
 *     them into `unknown`. Never `on-track`.
 *
 * Runs weekly ON THE MINI (always-on since the 2026-08-24 pmset fix, holds all
 * the clones), NOT in the MacBook's `com.pavan.weekly-sync` — that job silently
 * missed its 2026-09-07 run, which is how `_registry.md` went 8 days stale.
 *
 * Writes only when content changed, like generate-registry.ts.
 *
 * Run:  node --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/roadmap-check.ts [--dry]
 */
import fs from 'fs/promises'
import path from 'path'
import { execFile } from 'child_process'
import crypto from 'crypto'
import matter from 'gray-matter'
import { PATHS, REPO_CANDIDATES } from '../src/lib/paths.ts'
import { runCommandArgs } from '../src/lib/shell.ts'
import { deriveState, type HandoffState } from '../src/lib/roadmap.ts'

const DRY = process.argv.includes('--dry')

/**
 * Commits that are not progress. Bots bump dependencies; the janitors commit
 * cron output and dashboard writes. Both move a path without anyone working on
 * it, which is precisely the false green this whole check exists to avoid.
 */
const BOT_AUTHORS = new Set([
  'renovate[bot]', 'dependabot[bot]', 'github-actions[bot]',
  'Paladin', 'Paladin (mac mini)', 'Paladin (macbook)',
])
const BOT_SUBJECTS = /^(auto|chore\(deps\)|crm: log touch|outreach: regenerate|leads:|intake:)\b|^auto\(/i

/** Same person, two spellings, one git identity that never got normalized. */
const AUTHOR_ALIASES: Record<string, string> = { 'AntarikshRamesh': 'Antariksh Ramesh' }
const canonAuthor = (a: string) => AUTHOR_ALIASES[a] ?? a

const days = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)

/**
 * A repo this machine simply does not have — distinct from one that failed to
 * fetch. The first is a fact about the MACHINE and makes the whole run partial;
 * the second is a fact about the WORLD and is worth recording as `unknown`.
 * Only the first blocks the write (see main).
 */
const NOT_CLONED = 'not cloned on this machine'

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true } catch { return false }
}

/** First candidate path that is actually a git repo on this machine. */
const repoCache = new Map<string, string | null>()
async function resolveRepo(name: string): Promise<string | null> {
  if (repoCache.has(name)) return repoCache.get(name)!
  let found: string | null = null
  for (const c of REPO_CANDIDATES[name] ?? []) {
    if (await exists(path.join(c, '.git'))) { found = c; break }
  }
  repoCache.set(name, found)
  return found
}

const git = (repo: string, args: string[], timeout = 120_000) =>
  runCommandArgs('git', ['-C', repo, ...args], timeout)

/** origin's default branch, not ours — `main` is the fallback, not the assumption. */
async function originRef(repo: string): Promise<string> {
  const head = await git(repo, ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD'])
  return head.trim() || 'origin/main'
}

const fetched = new Set<string>()
async function fetchOnce(repo: string): Promise<boolean> {
  if (fetched.has(repo)) return true
  // --prune keeps deleted remote branches from resolving; 5 min for Nexus.
  const out = await runCommandArgs(
    'git', ['-C', repo, 'fetch', '-q', '--prune', 'origin'], 300_000
  )
  // runCommandArgs returns '' on failure AND on quiet success, so probe the ref.
  const ok = Boolean((await git(repo, ['rev-parse', '--verify', '-q', await originRef(repo)])).trim())
  if (ok) fetched.add(repo)
  void out
  return ok
}

/** Field separator for git --format: a byte no commit subject or name contains. */
const SEP = '\x1f'

interface HumanCommit { at: string; author: string; subject: string }

/**
 * The last commit on `ref` touching `paths` that a person actually made.
 *
 * Scans a window rather than asking git to filter: the exclusion is by author
 * AND subject, and `--invert-grep` cannot express both cleanly. 300 is far
 * beyond any real bot run on these paths.
 */
async function lastHumanCommit(repo: string, ref: string, paths: string[]): Promise<HumanCommit | null> {
  const out = await git(repo, [
    'log', '-n', '300', '--no-merges', `--format=%aI${SEP}%an${SEP}%s`, ref, '--', ...paths,
  ])
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const [at, author, subject = ''] = line.split(SEP)
    if (!at || !author) continue
    if (BOT_AUTHORS.has(author) || BOT_SUBJECTS.test(subject)) continue
    return { at, author: canonAuthor(author), subject }
  }
  return null
}

/**
 * Does `needle` appear anywhere in the tree at `ref`? Returns the file count.
 *
 * Not `runCommandArgs`: `git grep` exits 1 for "no matches", which that helper
 * treats as a failed command and logs. Here a zero count is the single most
 * important answer the check can give — it is what proves contract-management's
 * endpoint is unconsumed — so it must return quietly, not as an error. Any
 * exit code above 1 is a real failure and still throws.
 */
async function grepAtRef(repo: string, ref: string, needle: string, sub?: string): Promise<number> {
  const args = ['-C', repo, 'grep', '-l', '--fixed-strings', needle, ref]
  if (sub) args.push('--', sub)
  return new Promise((resolve, reject) => {
    execFile('git', args, { timeout: 120_000 }, (err, stdout) => {
      const code = (err as { code?: number } | null)?.code
      if (err && code !== 1) return reject(err)
      resolve(stdout.split('\n').filter(Boolean).length)
    })
  })
}

/** When did `needle` first land on `ref`? Pickaxe over the whole history. */
async function whenLanded(repo: string, ref: string, needle: string): Promise<string | null> {
  const out = await git(repo, [
    'log', '--reverse', '--format=%aI', '-S', needle, ref,
  ], 180_000)
  return out.split('\n').filter(Boolean)[0]?.trim() ?? null
}

interface Authored {
  slug: string; name: string; group: string; kind: string
  target?: string; done?: string
  repos: string[]
  evidence: { repo: string; path: string }[]
  handoff: { spec?: string; landed?: string; consumed_by?: string; pr?: string }
}

interface Checked {
  slug: string
  evidence_age_days?: number | null
  last_evidence_at?: string | null
  last_evidence_author?: string | null
  handoff_state?: HandoffState
  handoff_age_days?: number | null
  handoff_at?: string | null
  error?: string
}

/** One line per run, outside git — the page reads the last `ok` for freshness. */
async function logRun(line: string): Promise<void> {
  if (DRY) return
  try {
    await fs.mkdir(path.dirname(PATHS.roadmapCheckLog), { recursive: true })
    await fs.appendFile(PATHS.roadmapCheckLog, `${new Date().toISOString()} ${line}\n`)
  } catch { /* a logging failure must not fail a check */ }
}

function ymd(v: unknown): string | undefined {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : undefined
}

async function readAuthored(): Promise<Authored[]> {
  const names = await fs.readdir(PATHS.roadmap).catch(() => [] as string[])
  const out: Authored[] = []
  for (const n of names) {
    if (!n.endsWith('.md') || n.startsWith('_') || n.startsWith('.') || n === 'README.md') continue
    const raw = await fs.readFile(path.join(PATHS.roadmap, n), 'utf-8')
    const { data } = matter(raw)
    const h = (data.handoff ?? {}) as Record<string, string>
    out.push({
      slug: String(data.slug ?? n.replace(/\.md$/, '')),
      name: String(data.name ?? data.slug ?? n),
      group: String(data.group ?? 'internal'),
      kind: String(data.kind ?? 'build'),
      target: ymd(data.target),
      done: ymd(data.done),
      repos: Array.isArray(data.repos) ? data.repos.map(String) : [],
      evidence: Array.isArray(data.evidence)
        ? data.evidence.filter(e => e?.repo && e?.path).map(e => ({ repo: String(e.repo), path: String(e.path) }))
        : [],
      handoff: {
        spec: h.spec, landed: h.landed, consumed_by: h.consumed_by, pr: h.pr,
      },
    })
  }
  return out
}

async function checkBuild(a: Authored): Promise<Checked> {
  if (a.evidence.length === 0) return { slug: a.slug, error: 'No evidence path declared' }

  const byRepo = new Map<string, string[]>()
  for (const e of a.evidence) {
    byRepo.set(e.repo, [...(byRepo.get(e.repo) ?? []), e.path])
  }

  let newest: HumanCommit | null = null
  const errors: string[] = []
  for (const [repoName, paths] of byRepo) {
    const repo = await resolveRepo(repoName)
    if (!repo) { errors.push(`${repoName} ${NOT_CLONED}`); continue }
    if (!await fetchOnce(repo)) { errors.push(`${repoName} could not fetch origin`); continue }
    const ref = await originRef(repo)
    // A path that matches nothing at the ref is a stale evidence pointer, which
    // is a defect in the roadmap file — not an initiative with no activity.
    const present = (await git(repo, ['ls-tree', '-r', '--name-only', ref, '--', ...paths]))
      .split('\n').filter(Boolean).length
    if (present === 0) { errors.push(`${repoName}: evidence path matches nothing at ${ref}`); continue }
    const c = await lastHumanCommit(repo, ref, paths)
    if (c && (!newest || c.at > newest.at)) newest = c
  }

  if (!newest) {
    return { slug: a.slug, error: errors.join('; ') || 'No human commit found in the last 300 commits' }
  }
  return {
    slug: a.slug,
    evidence_age_days: days(newest.at),
    last_evidence_at: newest.at,
    last_evidence_author: newest.author,
    ...(errors.length ? { error: undefined } : {}),
  }
}

/**
 * Handoff state, mechanically. `landed` must be a literal string that appears
 * in their code (a route, an export), not prose — this is the verify-claims
 * mechanic: a claim that cites evidence can be checked.
 */
async function checkHandoff(a: Authored): Promise<Checked> {
  const { spec, landed, consumed_by, pr } = a.handoff
  const repoName = a.repos[0]
  if (!repoName) return { slug: a.slug, error: 'No repo declared' }

  if (landed) {
    // Consumed? Ask OUR repo whether it actually references what they shipped.
    if (consumed_by) {
      const cc = await resolveRepo('command-center')
      if (cc && await fetchOnce(cc)) {
        const ref = await originRef(cc)
        if (await grepAtRef(cc, ref, landed, consumed_by) > 0) {
          return { slug: a.slug, handoff_state: 'consumed' }
        }
      }
    }
    const repo = await resolveRepo(repoName)
    if (!repo) return { slug: a.slug, error: `${repoName} ${NOT_CLONED}` }
    if (!await fetchOnce(repo)) return { slug: a.slug, error: `${repoName} could not fetch origin` }
    const ref = await originRef(repo)
    if (await grepAtRef(repo, ref, landed) > 0) {
      const at = await whenLanded(repo, ref, landed)
      return {
        slug: a.slug,
        handoff_state: 'merged',
        handoff_age_days: at ? days(at) : null,
        handoff_at: at,
      }
    }
  }

  if (pr) return { slug: a.slug, handoff_state: 'pr-opened' }

  if (spec) {
    const abs = path.join(PATHS.operationsRoot, spec.replace(/^operations\//, ''))
    if (await exists(abs)) {
      const at = (await git(PATHS.operationsRoot, [
        'log', '-1', '--format=%aI', 'HEAD', '--', path.relative(PATHS.operationsRoot, abs),
      ])).trim()
      return { slug: a.slug, handoff_state: 'spec-sent', handoff_age_days: at ? days(at) : null, handoff_at: at || null }
    }
    return { slug: a.slug, error: `Spec ${spec} not found` }
  }

  return { slug: a.slug, handoff_state: 'unknown' }
}

const STATE_MARK: Record<string, string> = {
  slipped: '🔴', stranded: '🔴', 'at-risk': '🟠', unknown: '⚪',
  idle: '🟡', 'no-target': '🟡', 'on-track': '🟢', active: '🟢', done: '✅',
}

async function main() {
  const authored = await readAuthored()
  if (authored.length === 0) {
    console.error(`No roadmap files in ${PATHS.roadmap}`)
    process.exit(1)
  }

  const checked: Checked[] = []
  for (const a of authored) {
    checked.push(a.kind === 'handoff' ? await checkHandoff(a) : await checkBuild(a))
  }
  const byslug = new Map(checked.map(c => [c.slug, c]))

  const rows = authored.map(a => {
    const d = byslug.get(a.slug)!
    const { state, reason } = deriveState(
      { kind: a.kind as 'build' | 'handoff', target: a.target, done: a.done },
      {
        slug: a.slug,
        evidenceAgeDays: d.evidence_age_days,
        lastEvidenceAt: d.last_evidence_at,
        handoffState: d.handoff_state,
        handoffAgeDays: d.handoff_age_days,
        error: d.error,
      },
      true
    )
    return { a, d, state, reason }
  })

  const order = ['slipped', 'stranded', 'at-risk', 'unknown', 'idle', 'no-target', 'on-track', 'active', 'done']
  rows.sort((x, y) =>
    order.indexOf(x.state) - order.indexOf(y.state) ||
    (x.a.target ?? '9999').localeCompare(y.a.target ?? '9999') ||
    x.a.name.localeCompare(y.a.name)
  )

  // What counts as a change: a fact, not a day. The page recomputes ages from
  // the stored timestamps, so this file only needs rewriting when a human
  // commit landed, a handoff moved, a repo stopped resolving, a target was
  // edited, or a state crossed a threshold. Without this, a daily cron commits
  // every day as every age ticks — and the Telegram announce becomes noise.
  const fingerprint = crypto.createHash('sha1').update(JSON.stringify(
    [...rows].sort((x, y) => x.a.slug.localeCompare(y.a.slug)).map(r => [
      r.a.slug, r.a.target ?? null, r.a.done ?? null, r.state,
      r.d.last_evidence_at ?? null, r.d.handoff_state ?? null, r.d.handoff_at ?? null, r.d.error ?? null,
    ])
  )).digest('hex').slice(0, 12)

  const fm = [
    '---',
    `generated_at: '${new Date().toISOString()}'`,
    `fingerprint: ${fingerprint}`,
    'checked:',
    ...checked.flatMap(c => [
      `  - slug: ${c.slug}`,
      ...(c.evidence_age_days != null ? [`    evidence_age_days: ${c.evidence_age_days}`] : []),
      ...(c.last_evidence_at ? [`    last_evidence_at: '${c.last_evidence_at}'`] : []),
      ...(c.last_evidence_author ? [`    last_evidence_author: ${JSON.stringify(c.last_evidence_author)}`] : []),
      ...(c.handoff_state ? [`    handoff_state: ${c.handoff_state}`] : []),
      ...(c.handoff_age_days != null ? [`    handoff_age_days: ${c.handoff_age_days}`] : []),
      ...(c.handoff_at ? [`    handoff_at: '${c.handoff_at}'`] : []),
      ...(c.error ? [`    error: ${JSON.stringify(c.error)}`] : []),
    ]),
    '---',
  ].join('\n')

  const body = [
    '',
    '# Roadmap status — DERIVED. DO NOT HAND-EDIT.',
    '',
    '<!-- Generated by command-center scripts/roadmap-check.ts, weekly on the mini.',
    '     Authored commitments (target, evidence, definition of done) live in the',
    '     per-initiative files beside this one; they are never written here. -->',
    '',
    '| | initiative | group | target | state | why |',
    '|---|---|---|---|---|---|',
    ...rows.map(r =>
      `| ${STATE_MARK[r.state] ?? '⚪'} | **${r.a.name}** | ${r.a.group} | ${r.a.target ?? '—'} | ${r.state} | ${r.reason} |`
    ),
    '',
    `_${rows.length} initiatives. Evidence age counts only human commits on \`origin\` —`,
    'bot and janitor commits are excluded, because a path a machine writes to is',
    'green forever and tells you nothing._',
    '',
  ].join('\n')

  const next = `${fm}\n${body}`
  const prev = await fs.readFile(PATHS.roadmapStatus, 'utf-8').catch(() => '')

  /**
   * A machine that cannot see every repo must not publish a board.
   *
   * `_status.md` is one file written by two machines. The mini holds all the
   * clones; the MacBook is missing contract-management and both websites, so a
   * run there resolves them to `unknown` and — via the janitor's `git add -A` —
   * quietly replaces the mini's correct board with a degraded one. That already
   * happened once on 2026-09-08 during development.
   *
   * A partial board is worse than a stale board: it renders as current health.
   * So refuse, name the repos, and leave what is there alone. `--dry` still
   * prints, which is all a developer on the wrong machine actually needs.
   */
  const missing = checked.filter(c => c.error?.includes(NOT_CLONED))
  if (missing.length > 0 && !DRY) {
    console.error(
      `roadmap-check: refusing to write — ${missing.length} of ${checked.length} initiatives ` +
      `reference repos this machine does not have:`
    )
    for (const m of missing) console.error(`  ${m.slug}: ${m.error}`)
    console.error('Run this on the mini, which holds every clone. (--dry prints anyway.)')
    await logRun(`refused missing=${missing.length}`)
    process.exit(2)
  }

  // A file without a fingerprint is the pre-fingerprint format: rewrite once.
  const prevFingerprint = /^fingerprint: (\w+)$/m.exec(prev)?.[1]
  if (prevFingerprint === fingerprint) {
    console.log('roadmap-check: no change')
    await logRun('ok unchanged')
    return
  }

  if (DRY) {
    console.log(next)
    return
  }
  await fs.mkdir(PATHS.roadmap, { recursive: true })
  await fs.writeFile(PATHS.roadmapStatus, next, 'utf-8')
  await logRun(`ok changed rows=${rows.length}`)
  console.log(`roadmap-check: wrote ${rows.length} rows`)
  for (const r of rows) console.log(`  ${STATE_MARK[r.state]} ${r.a.name}: ${r.state} — ${r.reason}`)
}

await main().catch(async (e: unknown) => {
  await logRun(`fail ${String(e).replace(/\s+/g, ' ').slice(0, 160)}`)
  console.error(e)
  process.exit(1)
})
