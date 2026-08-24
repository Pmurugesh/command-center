/**
 * Weekly drift check — mechanizes what 2026-08-24 caught by hand three times.
 *
 * That day surfaced, manually: dead citations in bid docs (some masking FALSE
 * claims), two agency slugs for one agency (contacts silently unjoined from
 * their agency page), and agent context files three months stale. Each is the
 * same disease — a fact and its evidence drifting apart with nothing watching.
 * This script is the watcher (M2.5's "weekly drift report").
 *
 * Runs weekly on the MacBook (the machine with the platform clone), via the
 * launchd job in scripts/macbook/. Findings land as a dated intel alert in
 * operations — the dashboard's /intel feed IS the panel — but only when the
 * findings CHANGED since last run: a known, unfixed issue does not get
 * re-announced weekly into noise. State: ~/.local/state/drift-check.json.
 *
 * Run:  node --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/drift-check.ts
 */
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { PATHS } from '../src/lib/paths.ts'
import { listContacts, today } from '../src/lib/crm.ts'
import { runCommandArgs } from '../src/lib/shell.ts'

const STATE = path.join(os.homedir(), '.local/state/drift-check.json')
const STALE_CONTEXT_DAYS = 60

async function citationDrift(): Promise<string[]> {
  // Authored docs only: machine-generated codebase-reports regenerate on the
  // next scan and are not claims anyone made to a customer.
  const out = await runCommandArgs('node', [
    '--experimental-strip-types', '--no-warnings',
    'scripts/run-ts.mjs', 'scripts/verify-claims.ts',
  ], 300_000)
  // A run that produced no summary did not run — wrong cwd, missing platform
  // clone, script error. Failing loudly here is the whole point: a drift
  // checker that silently reports clean on its own failure is the exact bug
  // class it exists to catch (it did precisely that on 2026-08-24).
  if (!out.includes('resolved:')) {
    throw new Error('verify-claims produced no summary — run from the command-center repo root')
  }
  const findings: string[] = []
  for (const line of out.split('\n')) {
    const m = line.match(/^((?:bids|gtm|intelligence|workflows)\/\S+)\s+\((\d+) dead\)/)
    if (m) findings.push(`- \`${m[1]}\` — ${m[2]} dead citation(s)`)
  }
  return findings
}

async function agencySlugDrift(): Promise<string[]> {
  const slugs = new Set(
    (await fs.readdir(PATHS.agencies).catch(() => [] as string[]))
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace(/\.md$/, '')),
  )
  const findings: string[] = []
  for (const c of await listContacts()) {
    if (c.agency && !slugs.has(c.agency)) {
      findings.push(`- **${c.name}** (\`${c.slug}\`) — agency \`${c.agency}\` matches no file in intelligence/agencies/`)
    }
  }
  return findings
}

async function staleAgentContext(): Promise<string[]> {
  // Last COMMIT touching the file, not fs mtime — clones reset mtimes on
  // checkout, so mtime on a synced machine measures the sync, not the edit.
  // Limitation: history starts at the 2026-08-24 adoption, so pre-adoption
  // staleness (the May-era context) is a known, separately-tracked item; this
  // check catches the NEXT rot cycle.
  const findings: string[] = []
  const root = path.join(PATHS.operationsRoot, 'agents')
  const agents = await fs.readdir(root).catch(() => [] as string[])
  for (const a of agents) {
    for (const f of ['CONTEXT.md', 'USER.md']) {
      try {
        const out = await runCommandArgs('git', [
          '-C', PATHS.operationsRoot, 'log', '-1', '--format=%ct', '--', `agents/${a}/${f}`,
        ], 15_000)
        const ts = Number(out.trim()) * 1000
        if (!ts) continue
        const days = Math.floor((Date.now() - ts) / 86_400_000)
        if (days > STALE_CONTEXT_DAYS) findings.push(`- \`agents/${a}/${f}\` — ${days} days since last edit`)
      } catch { /* file absent — fine */ }
    }
  }
  return findings
}

async function main() {
  const [citations, slugs, stale] = [
    await citationDrift(), await agencySlugDrift(), await staleAgentContext(),
  ]
  const total = citations.length + slugs.length + stale.length

  const fingerprint = crypto.createHash('sha1')
    .update(JSON.stringify({ citations, slugs, stale })).digest('hex')
  let prev = ''
  try { prev = JSON.parse(await fs.readFile(STATE, 'utf8')).fingerprint } catch { /* first run */ }

  if (total === 0) {
    await fs.mkdir(path.dirname(STATE), { recursive: true })
    await fs.writeFile(STATE, JSON.stringify({ fingerprint, at: new Date().toISOString() }))
    console.log('drift-check: clean')
    return
  }
  if (fingerprint === prev) {
    console.log(`drift-check: ${total} known finding(s), unchanged since last run — not re-announcing`)
    return
  }

  const s: string[] = [
    `# Drift report — ${today()}`,
    '',
    'Facts and their evidence drifting apart. Each line is a claim somewhere',
    'that its source no longer backs. Generated weekly by `scripts/drift-check.ts`;',
    're-announced only when findings change.',
    '',
  ]
  const section = (title: string, rows: string[]) => {
    if (rows.length) s.push(`## ${title} (${rows.length})`, '', ...rows, '')
  }
  section('Dead citations in authored docs', citations)
  section('Agency slugs matching no agency profile', slugs)
  section(`Agent context older than ${STALE_CONTEXT_DAYS} days`, stale)

  const alertPath = path.join(PATHS.intelligence, `${today()}-drift-report.md`)
  await fs.mkdir(PATHS.intelligence, { recursive: true })
  await fs.writeFile(alertPath, `${s.join('\n')}\n`)
  const rel = path.relative(PATHS.operationsRoot, alertPath)
  try {
    await runCommandArgs('git', ['-C', PATHS.operationsRoot, 'add', '--', rel], 15_000)
    await runCommandArgs('git', [
      '-C', PATHS.operationsRoot, 'commit', '-q',
      '-m', `intel: drift report — ${total} finding(s)`,
      '-m', 'via: drift-check', '--', rel,
    ], 15_000)
  } catch { /* janitor sweeps */ }
  await fs.mkdir(path.dirname(STATE), { recursive: true })
  await fs.writeFile(STATE, JSON.stringify({ fingerprint, at: new Date().toISOString() }))
  console.log(`drift-check: ${total} finding(s) → ${rel}`)
}

main().catch(err => { console.error('drift-check failed:', err); process.exit(1) })
