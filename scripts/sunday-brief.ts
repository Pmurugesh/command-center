/**
 * Sunday brief — what is owed, what is closing, what is broken. Zero LLM.
 *
 * The `weekly-strategic-briefing` cron was an agentTurn wrapped around a
 * research script that had been SIGKILL'd four Sundays running (audit
 * 2026-09-14): a model narrating a dead pipeline. Every number Pavan actually
 * needs on a Sunday night already sits in a file this dashboard reads — CRM
 * contacts and drafts, leads, bid sidecars, the procurement scan, `[DECISION]`
 * lines, `gtm/targets.md`, the cron store. So this assembles them and stops.
 *
 * Two outputs from one run, because the job is a command job and its stdout IS
 * the Telegram message (OpenClaw announces what a command prints and skips the
 * announce when it prints nothing):
 *   - stdout: a phone-sized digest, about 18 lines, numbers and paths, no
 *     headers. Sections with nothing in them are dropped.
 *   - intelligence/weekly/<date>-brief.md: every list in full, committed, which
 *     the /intel Weekly tab already lists.
 *
 * Run: node --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/sunday-brief.ts [--dry]
 */
import fs from 'fs/promises'
import path from 'path'
import matter from 'gray-matter'
import { PATHS } from '../src/lib/paths.ts'
import { runCommandArgs, getNormalizedCronJobs } from '../src/lib/shell.ts'
import { isFailing } from '../src/lib/cron.ts'
import { localToday, isoToLocalDate } from '../src/lib/dates.ts'
import { listContacts, hasBeenWorked, addDays } from '../src/lib/crm.ts'
import { CRM_STAGE_ORDER, CRM_TERMINAL_STAGES } from '../src/lib/config.ts'
import { listDrafts } from '../src/lib/followup.ts'
import { listLeads } from '../src/lib/leads.ts'
import { listBids } from '../src/lib/files.ts'
import { parseOpportunities } from '../src/lib/procurements.ts'
import { getStrategicDecisions, getCampaignScore } from '../src/lib/gtm.ts'

const DRY = process.argv.includes('--dry')
const HORIZON_DAYS = 21
const TELEGRAM_LINES = 18

// ── dates ───────────────────────────────────────────────────────────────────

/**
 * One line of a digest: CRM text is written for a screen, not a phone, so it
 * is cut to a clause and its dashes become commas (a Telegram line is short
 * and has no typography).
 */
function clause(s: string, max = 80): string {
  const flat = s.replace(/\s*[—–]\s*/g, ', ').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}...` : flat
}

/** Whole local days from `date` to today; negative when `date` is ahead. */
function daysAgo(date: string, today: string): number {
  const at = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime() }
  return Math.round((at(today) - at(date)) / 86_400_000)
}

// ── sections ────────────────────────────────────────────────────────────────
//
// Each section is a heading with a count plus one line per item. The file
// prints every line; the Telegram text prints as many as fit.

interface Section {
  key: string
  /** Heading, without the count. */
  title: string
  items: string[]
  /** A one-line qualifier that always prints next to the heading. */
  aside?: string
}

const STAGE_PILOT = CRM_STAGE_ORDER.indexOf('pilot-discussion')

/**
 * Owed to contacts: anyone at pilot-discussion or beyond (a conversation that
 * has reached "what would a pilot look like" is owed a next step, dated or
 * not), plus anyone with a dated commitment that has passed. The overdue half
 * honours the board's rule: only a contact a human has actually worked can be
 * overdue, because seeded records carry due dates nobody promised.
 */
async function owedToContacts(today: string): Promise<Section> {
  const rows: { age: number; line: string }[] = []
  for (const c of await listContacts()) {
    if (c.status === 'dormant' || CRM_TERMINAL_STAGES.includes(c.stage)) continue
    const overdueBy = c.nextActionDue ? daysAgo(c.nextActionDue, today) : undefined
    const overdue = overdueBy !== undefined && overdueBy > 0 && hasBeenWorked(c)
    const warm = CRM_STAGE_ORDER.indexOf(c.stage) >= STAGE_PILOT
    if (!overdue && !warm) continue
    const owed = clause(c.nextAction ?? `next step after ${c.stage}`)
    const age = overdue ? overdueBy! : (c.lastTouched ? daysAgo(c.lastTouched, today) : 0)
    const ageText = overdue ? `${age}d overdue` : `${age}d since touch`
    rows.push({ age, line: `${c.name}, ${c.agency ?? 'no agency'}: ${owed}, ${ageText}, crm/contacts/${c.slug}.md` })
  }
  rows.sort((a, b) => b.age - a.age)
  return { key: 'owed', title: 'Owed to contacts', items: rows.map(r => r.line) }
}

async function unsentDrafts(today: string): Promise<Section> {
  const items: string[] = []
  for (const d of await listDrafts()) {
    if (d.status !== 'draft') continue
    const age = d.agingDays ?? (d.updatedAt ? daysAgo(isoToLocalDate(d.updatedAt), today) : undefined)
    items.push(`${d.contactName ?? d.slug}: ${clause(d.subject || 'no subject')}, ${age ?? '?'}d, crm/drafts/${d.slug}.md`)
  }
  return { key: 'drafts', title: 'Drafts unsent', items }
}

async function leadsClosing(today: string, horizon: string): Promise<Section> {
  const leads = (await listLeads())
    .filter(l => l.triage !== 'expired' && l.triage !== 'skip')
    .filter(l => l.endDate && l.endDate >= today && l.endDate <= horizon)
    .sort((a, b) => a.endDate!.localeCompare(b.endDate!))
  return {
    key: 'leads', title: `Leads closing inside ${HORIZON_DAYS}d`,
    items: leads.map(l => `${clause(l.eventName, 70)}, closes ${l.endDate} (${-daysAgo(l.endDate!, today)}d), score ${l.score}, crm/leads/${l.slug}.md`),
  }
}

const CLOSED_BID_STATUSES = new Set(['submitted', 'won', 'lost', 'no-bid'])
const CLOSED_BID_STAGES = new Set(['submitted', 'awarded', 'lapsed'])

async function bidsDue(today: string, horizon: string): Promise<Section & { undated: number; past: number }> {
  const open = (await listBids()).filter(b =>
    !CLOSED_BID_STATUSES.has(String(b.status ?? '').toLowerCase()) && !CLOSED_BID_STAGES.has(String(b.stage ?? '')))
  const due = open.filter(b => b.deadlineAt && b.deadlineAt >= today && b.deadlineAt <= horizon)
    .sort((a, b) => a.deadlineAt!.localeCompare(b.deadlineAt!))
  const undated = open.filter(b => !b.deadlineAt).length
  const past = open.filter(b => b.deadlineAt && b.deadlineAt < today).length
  const aside = [`${undated} open with no deadline`, past ? `${past} open past deadline` : '']
    .filter(Boolean).join(', ')
  return {
    key: 'bids', title: `Bids due inside ${HORIZON_DAYS}d`, aside, undated, past,
    items: due.map(b => `${b.displayName}, due ${b.deadlineAt} (${-daysAgo(b.deadlineAt!, today)}d), bids/${b.name}/`),
  }
}

/** Only the newest scan: every open row reappears in every daily file. */
async function procurementsClosing(today: string): Promise<Section> {
  const dir = path.join(PATHS.intelligenceBase, 'procurements')
  const names = (await fs.readdir(dir).catch(() => [] as string[]))
    .filter(n => /^\d{4}-\d{2}-\d{2}.*-caleprocure\.md$/.test(n)).sort()
  const latest = names[names.length - 1]
  if (!latest) return { key: 'procurements', title: 'Procurements closing', items: [] }
  const content = await fs.readFile(path.join(dir, latest), 'utf-8')
  const now = Date.now()
  const horizonMs = now + HORIZON_DAYS * 86_400_000
  const rows = parseOpportunities(content, latest, latest.slice(0, 10))
    .filter(o => o.deadlineAt && new Date(o.deadlineAt).getTime() >= now && new Date(o.deadlineAt).getTime() <= horizonMs)
    .sort((a, b) => a.deadlineAt!.localeCompare(b.deadlineAt!))
  return {
    key: 'procurements', title: `Procurements closing inside ${HORIZON_DAYS}d`,
    aside: `from intelligence/procurements/${latest}`,
    items: rows.map(o => {
      const due = isoToLocalDate(o.deadlineAt!)
      const score = o.score !== undefined ? `, ${o.score}/10` : ''
      return `${o.eventId} ${clause(o.title, 60)}, due ${due} (${-daysAgo(due, today)}d)${score}`
    }),
  }
}

async function openDecisions(): Promise<Section> {
  const all = await getStrategicDecisions()
  return { key: 'decisions', title: 'Decisions open', items: all.map(d => `${clause(d.text, 90)}, ${d.file}:${d.lineNumber}`) }
}

async function campaignPace(): Promise<Section> {
  const s = await getCampaignScore()
  const t = s.targets
  if (!t) return { key: 'pace', title: 'Campaign pace', items: [] }
  const parts = [
    `meetings ${s.meetingsHeld}/${t.meetings}`,
    `demos ${s.demosGiven}/${t.demos}`,
    `loi ${t.loiActual}/${t.loi}`,
    t.bidsSubmitted !== null ? `bids ${s.bidsSubmitted}/${t.bidsSubmitted}` : '',
    `${s.daysLeft}d left in ${t.campaign} (ends ${t.end})`,
  ].filter(Boolean)
  return { key: 'pace', title: 'Campaign pace', items: [parts.join(', ')] }
}

async function cronsInError(): Promise<Section & { reachable: boolean }> {
  const { reachable, jobs } = await getNormalizedCronJobs()
  if (!reachable) {
    // "Unreachable" is not "healthy"; say what was and was not checked.
    return { key: 'crons', title: 'Crons in error', reachable, aside: 'cron gateway unreachable, not checked', items: [] }
  }
  const bad = jobs.filter(j => j.enabled && (isFailing(j) || j.consecutiveErrors > 0))
  return {
    key: 'crons', title: 'Crons in error', reachable,
    items: bad.map(j => `${j.name}: ${j.consecutiveErrors} consecutive error(s)${j.lastError ? `, ${j.lastError.replace(/\s+/g, ' ').slice(0, 90)}` : ''}`),
  }
}

// ── rendering ───────────────────────────────────────────────────────────────

function heading(s: Section): string {
  // Pace is one line by construction; its count would read as "(1)" noise.
  const count = s.key === 'pace' ? '' : ` (${s.items.length})`
  return `${s.title}${count}${s.aside ? `, ${s.aside}` : ''}`
}

function hasContent(s: Section): boolean {
  return s.items.length > 0 || Boolean(s.aside)
}

/**
 * The Telegram text. Every section that has anything prints its heading with
 * the true count; item lines are then trimmed, most-populated section first,
 * until the whole message fits. A count on the heading means nothing is hidden
 * silently — the file has the rest.
 */
function telegramText(today: string, sections: Section[], rel: string): string {
  const live = sections.filter(hasContent)
  if (!live.length) return 'Nothing owed this week.'
  const shown = live.map(s => Math.min(s.items.length, 4))
  const total = () => 1 + live.reduce((n, _s, i) => n + 1 + shown[i], 0)
  while (total() > TELEGRAM_LINES) {
    let pick = -1
    for (let i = 0; i < live.length; i++) if (shown[i] > 0 && (pick === -1 || shown[i] >= shown[pick])) pick = i
    if (pick === -1) break
    shown[pick]--
  }
  const out = [`Sunday brief ${today}, full lists in ${rel}`]
  live.forEach((s, i) => {
    out.push(heading(s))
    for (const item of s.items.slice(0, shown[i])) out.push(`  ${item}`)
  })
  return out.join('\n')
}

function fileText(today: string, generatedAt: string, sections: Section[], counts: Record<string, number | string>): string {
  const body: string[] = [
    `# Sunday brief, ${today}`,
    '',
    'Assembled by `scripts/sunday-brief.ts` from files in this repo: CRM contacts',
    'and drafts, leads, bid sidecars, the newest procurement scan, open `[DECISION]`',
    'lines, `gtm/targets.md`, and the cron store. No model involved; every line',
    'names the file it came from.',
    '',
  ]
  for (const s of sections) {
    body.push(`## ${heading(s)}`, '')
    body.push(...(s.items.length ? s.items.map(i => `- ${i}`) : ['_nothing_']), '')
  }
  return matter.stringify(body.join('\n'), { generated_at: generatedAt, counts })
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  const today = localToday()
  const horizon = addDays(today, HORIZON_DAYS)
  const [owed, drafts, leads, bids, procurements, decisions, pace, crons] = await Promise.all([
    owedToContacts(today), unsentDrafts(today), leadsClosing(today, horizon), bidsDue(today, horizon),
    procurementsClosing(today), openDecisions(), campaignPace(), cronsInError(),
  ])
  const sections: Section[] = [owed, drafts, leads, bids, procurements, decisions, pace, crons]
  const counts = {
    owed: owed.items.length, drafts: drafts.items.length, leads: leads.items.length,
    bids_due: bids.items.length, bids_undated: bids.undated, bids_past_deadline: bids.past,
    procurements: procurements.items.length, decisions: decisions.items.length,
    crons_failing: crons.items.length, cron_gateway: crons.reachable ? 'reachable' : 'unreachable',
  }

  const target = path.join(PATHS.intelligenceBase, 'weekly', `${today}-brief.md`)
  const rel = path.relative(PATHS.operationsRoot, target)
  const text = telegramText(today, sections, rel)
  const file = fileText(today, new Date().toISOString(), sections, counts)

  if (DRY) {
    console.log(text)
    console.log(`\n[dry run] would write ${rel}:\n`)
    console.log(file)
    return
  }

  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, file)
  try {
    await runCommandArgs('git', ['-C', PATHS.operationsRoot, 'add', '--', rel], 15_000)
    await runCommandArgs('git', ['-C', PATHS.operationsRoot, 'commit', '-q',
      '-m', 'intel: sunday brief', '-m', 'via: sunday-brief', '--', rel], 15_000)
  } catch { /* the janitor sweeps */ }
  console.log(text)
}

main().catch(err => { console.error('sunday-brief failed:', err); process.exit(1) })
