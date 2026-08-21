/**
 * Daily insights for the Today page.
 *
 * Everything here is DERIVED — from the contact store and from git history.
 * Nothing is stored, so no insight can go stale or disagree with the records
 * it summarises.
 *
 * Git as the activity source is the payoff from M0: since operations became a
 * repo, every change is dated, attributed, and attached to a file, so "what
 * changed since Tuesday" is an exact query rather than the mtime guesswork the
 * original Phase 4.3 plan called for.
 *
 * The organising bias: this page exists to answer "am I actually selling?" The
 * GTM diagnosis was 0 logged outbound touches in 12 weeks. Momentum is the
 * north-star metric and it is deliberately hard to flatter — seeded records and
 * automated edits are excluded, so the number only moves when a human really
 * talks to someone.
 */
import { PATHS } from './paths'
import { runCommandArgs } from './shell'
import { listContacts, today, addDays } from './crm'
import { CRM_TERMINAL_STAGES } from './config'
import type { CrmContact } from '@/types'

// Log entries written by machinery rather than by a person talking to someone.
// Counting these as "touches" would let the momentum number rise while zero
// selling happened, which is the exact failure this metric exists to catch.
const NON_HUMAN_VIA = new Set(['seed', 'rederive', 'slug-reconcile', 'verify', 'roundtrip-test', 'api-test'])

export interface MomentumMetric {
  label: string
  value: number
  previous: number
  hint: string
}

export interface Momentum {
  metrics: MomentumMetric[]
  daysSinceLastTouch: number | null
  quiet: boolean            // true when nothing human has happened in the window
}

export interface ChangeEntry {
  area: 'contacts' | 'bids' | 'intel' | 'products' | 'reports' | 'other'
  summary: string
  at: string                // ISO
  author: string
}

export interface Blocker {
  reason: string
  contacts: { slug: string; name: string; agencyName?: string }[]
}

export interface ShapeBucket { key: string; count: number }

export interface PipelineShape {
  stages: ShapeBucket[]
  owners: ShapeBucket[]
  products: ShapeBucket[]
  liveTotal: number
}

export interface HealthItem {
  label: string
  status: 'ok' | 'warn' | 'bad'
  detail: string
}

export interface Insights {
  momentum: Momentum
  blockers: Blocker[]
  shape: PipelineShape
  health: HealthItem[]
  generatedAt: string
}

// ── git helpers ─────────────────────────────────────────────────────────────

async function gitLog(args: string[]): Promise<string[]> {
  const out = await runCommandArgs('git', ['-C', PATHS.operationsRoot, ...args], 15_000)
  return out ? out.split('\n').filter(Boolean) : []
}

function daysBetween(from: string, to: string): number {
  const [ay, am, ad] = from.split('-').map(Number)
  const [by, bm, bd] = to.split('-').map(Number)
  return Math.round((new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime()) / 86_400_000)
}

// ── momentum ────────────────────────────────────────────────────────────────

/**
 * Touches are counted from the contacts' own log entries, not from commit
 * messages: the log is the record, and commit-message formats are free to
 * change without silently breaking the metric.
 */
function countTouches(contacts: CrmContact[], fromDate: string, toDate: string): number {
  let n = 0
  for (const c of contacts) {
    for (const e of c.log) {
      if (e.via && NON_HUMAN_VIA.has(e.via)) continue
      if (e.date >= fromDate && e.date <= toDate) n++
    }
  }
  return n
}

function lastHumanTouch(contacts: CrmContact[]): string | null {
  let latest: string | null = null
  for (const c of contacts) {
    for (const e of c.log) {
      if (e.via && NON_HUMAN_VIA.has(e.via)) continue
      if (!latest || e.date > latest) latest = e.date
    }
  }
  return latest
}

function buildMomentum(contacts: CrmContact[]): Momentum {
  const t = today()
  const weekStart = addDays(t, -6)          // last 7 days inclusive
  const prevStart = addDays(t, -13)
  const prevEnd = addDays(t, -7)

  const touches = countTouches(contacts, weekStart, t)
  const touchesPrev = countTouches(contacts, prevStart, prevEnd)

  const engaged = contacts.filter(c => c.stage !== 'identified').length
  const meetings = contacts.filter(c =>
    c.stage === 'meeting-booked' || c.stage === 'demo-given' || c.stage === 'pilot-discussion').length

  const last = lastHumanTouch(contacts)
  const daysSinceLastTouch = last ? daysBetween(last, t) : null

  return {
    metrics: [
      { label: 'Touches', value: touches, previous: touchesPrev, hint: 'logged in the last 7 days' },
      { label: 'Engaged', value: engaged, previous: engaged, hint: 'contacts past "identified"' },
      { label: 'In play', value: meetings, previous: meetings, hint: 'meeting, demo, or pilot stage' },
    ],
    daysSinceLastTouch,
    quiet: touches === 0,
  }
}

// ── what changed ────────────────────────────────────────────────────────────

function areaOf(files: string): ChangeEntry['area'] {
  if (files.includes('crm/')) return 'contacts'
  if (files.includes('bids/')) return 'bids'
  if (files.includes('intelligence/')) return 'intel'
  if (files.includes('products/')) return 'products'
  if (files.includes('codebase-reports/')) return 'reports'
  return 'other'
}

/**
 * Commits touching operations since `sinceIso`. Janitor auto-commits are
 * dropped: "auto: <file>" says a file moved, not that anything happened, and
 * they would bury the meaningful entries.
 */
export async function getChanges(sinceIso: string, limit = 25): Promise<ChangeEntry[]> {
  const lines = await gitLog([
    'log', `--since=${sinceIso}`, '--no-merges',
    '--pretty=format:%aI%an%s', '--name-only',
  ])

  const entries: ChangeEntry[] = []
  let current: { at: string; author: string; summary: string } | null = null
  let files = ''

  const flush = () => {
    if (!current) return
    if (!current.summary.startsWith('auto:')) {
      entries.push({ ...current, area: areaOf(files) })
    }
    current = null
    files = ''
  }

  for (const line of lines) {
    if (line.includes('')) {
      flush()
      const [at, author, summary] = line.split('')
      current = { at, author, summary }
    } else {
      files += line + '\n'
    }
  }
  flush()

  return entries.slice(0, limit)
}

// ── leverage ────────────────────────────────────────────────────────────────

/**
 * Blockers grouped by reason, most-unblocking first.
 *
 * This is the most actionable view in the CRM: it converts a list of stuck
 * PEOPLE into a ranked list of THINGS TO MAKE. "One artifact unblocks four
 * contacts" is a build decision; "four blocked contacts" is just bad news.
 */
function buildBlockers(contacts: CrmContact[]): Blocker[] {
  const byReason = new Map<string, Blocker['contacts']>()
  for (const c of contacts) {
    if (c.status !== 'blocked' || !c.blockedOn) continue
    const key = c.blockedOn.trim()
    if (!byReason.has(key)) byReason.set(key, [])
    byReason.get(key)!.push({ slug: c.slug, name: c.name, agencyName: c.agencyName })
  }
  return Array.from(byReason.entries())
    .map(([reason, list]) => ({ reason, contacts: list }))
    .sort((a, b) => b.contacts.length - a.contacts.length)
}

// ── shape ───────────────────────────────────────────────────────────────────

function tally(values: (string | undefined)[]): ShapeBucket[] {
  const m = new Map<string, number>()
  for (const v of values) {
    if (!v) continue
    // Owner fields carry multiple people ("Ganapathy, Rani") — split so load is
    // attributed to each person rather than to the pair as a phantom third owner.
    for (const part of v.split(',').map(s => s.trim()).filter(Boolean)) {
      m.set(part, (m.get(part) ?? 0) + 1)
    }
  }
  return Array.from(m.entries()).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count)
}

function buildShape(contacts: CrmContact[]): PipelineShape {
  const live = contacts.filter(c => !CRM_TERMINAL_STAGES.includes(c.stage))
  return {
    stages: tally(contacts.map(c => c.stage)),
    owners: tally(live.map(c => c.owner)),
    products: tally(live.map(c => c.product)),
    liveTotal: live.length,
  }
}

// ── health ──────────────────────────────────────────────────────────────────


/**
 * The machine's own vital signs, on the page rather than in a separate console.
 * The CaleProcure scanner died on 2026-06-15 and went unnoticed for two months
 * precisely because nothing surfaced its silence where anyone would look.
 */
async function buildHealth(): Promise<HealthItem[]> {
  const items: HealthItem[] = []

  // IS THE RUNNING BUILD THE CURRENT ONE?
  //
  // Added after a near-miss: PR #5 merged cleanly, the deploy script then failed
  // at the lint step, and launchd simply kept serving the previous build. The
  // dashboard stayed up and answered 200 the entire time, so nothing looked
  // wrong — the failure was discovered only by reading a deploy log by hand.
  //
  // That is the same shape as the scanner that died in June and the outreach
  // file that went stale in May: silence that reads as health. A panel whose job
  // is breaking that silence has to check itself too.
  items.push(await deployFreshness())

  // Intel/scan freshness deliberately lives in FreshnessCard (per-pipeline, with
  // each source's own cron cadence). Duplicating it here would give one fact two
  // homes that could disagree — the thing being fixed everywhere else.

  const lastCommit = (await gitLog(['log', '-1', '--pretty=format:%aI']))[0]
  const commitAgeH = lastCommit
    ? Math.floor((Date.now() - new Date(lastCommit).getTime()) / 3_600_000)
    : null
  items.push({
    label: 'Data sync',
    status: commitAgeH === null ? 'bad' : commitAgeH > 48 ? 'warn' : 'ok',
    detail: commitAgeH === null ? 'no commits found' : `last commit ${commitAgeH}h ago`,
  })

  const unpushed = await gitLog(['log', '--oneline', 'origin/main..HEAD'])
  items.push({
    label: 'Pushed to GitHub',
    status: unpushed.length === 0 ? 'ok' : unpushed.length > 5 ? 'bad' : 'warn',
    detail: unpushed.length === 0 ? 'everything pushed' : `${unpushed.length} commit(s) unpushed`,
  })

  const contacts = await listContacts()
  items.push({
    label: 'Contact store',
    status: contacts.length ? 'ok' : 'bad',
    detail: `${contacts.length} contacts`,
  })

  return items
}

/**
 * Compare the checked-out dashboard commit against origin/main.
 *
 * Deliberately compares against the REMOTE ref rather than a local branch: the
 * question is "is what I am serving what was merged", and a stale local checkout
 * is exactly the failure being looked for.
 */
async function deployFreshness(): Promise<HealthItem> {
  const repo = process.env.DASHBOARD_REPO || process.cwd()
  const run = async (args: string[]) => {
    const out = await runCommandArgs('git', ['-C', repo, ...args], 15_000)
    return out.trim()
  }
  try {
    const local = await run(['rev-parse', 'HEAD'])
    if (!local) return { label: 'Deployed build', status: 'warn', detail: 'not a git checkout' }

    // Read the already-fetched remote ref. Deliberately does NOT fetch: a health
    // panel must not make network calls on every page render.
    const remote = await run(['rev-parse', 'origin/main'])
    if (!remote) return { label: 'Deployed build', status: 'warn', detail: 'no origin/main ref' }

    if (local === remote) {
      return { label: 'Deployed build', status: 'ok', detail: `current (${local.slice(0, 7)})` }
    }
    const behind = await run(['rev-list', '--count', `${local}..${remote}`])
    const n = Number(behind || 0)
    return {
      label: 'Deployed build',
      status: n > 0 ? 'bad' : 'warn',
      detail: n > 0
        ? `${n} commit(s) behind origin/main — a deploy failed or did not run`
        : `diverged from origin/main (${local.slice(0, 7)})`,
    }
  } catch {
    return { label: 'Deployed build', status: 'warn', detail: 'could not determine' }
  }
}

// ── entry point ─────────────────────────────────────────────────────────────

export async function getInsights(): Promise<Insights> {
  const contacts = await listContacts()
  return {
    momentum: buildMomentum(contacts),
    blockers: buildBlockers(contacts),
    shape: buildShape(contacts),
    health: await buildHealth(),
    generatedAt: new Date().toISOString(),
  }
}
