/**
 * GTM campaign state: targets, the scoreboard, and strategic decisions.
 *
 * The organising principle carried over from insights.ts: everything here is
 * DERIVED from files a human (or agent) already maintains, so no number can
 * disagree with the record it summarises.
 *
 *  - Targets live in operations gtm/targets.md (frontmatter, human-edited).
 *  - Meeting/demo actuals derive from the crm/meetings archive.
 *  - Strategic decisions are parsed straight out of gtm/ and intelligence/
 *    markdown — the Aug-24 failure this fixes: the email synthesis raised 7
 *    questions only Pavan could answer, and the Today page showed "0 decisions"
 *    because the decision queue only read bid folders.
 */
import fs from 'fs/promises'
import path from 'path'
import matter from 'gray-matter'
import { PATHS } from './paths'
import { runCommandArgs } from './shell'
import { acquireLock, atomicWrite } from './store'
import { listMeetings } from './meetings'
import { DEMO_RE } from './calendar'

// ── targets ─────────────────────────────────────────────────────────────────

export interface Phase0Item {
  id: string
  label: string
  done: boolean
}

export interface Targets {
  campaign: string
  start: string // YYYY-MM-DD inclusive
  end: string   // YYYY-MM-DD inclusive
  meetings: number
  demos: number
  loi: number
  loiActual: number
  phase0: Phase0Item[]
}

// js-yaml turns unquoted YAML dates into Date objects; accept both shapes so a
// hand edit that drops the quotes doesn't silently kill the scoreboard.
function toDateStr(v: unknown): string | null {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  return null
}

function toCount(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
}

export async function getTargets(): Promise<Targets | null> {
  let raw: string
  try {
    raw = await fs.readFile(PATHS.gtmTargets, 'utf-8')
  } catch {
    return null // no targets file — the scoreboard degrades to plain counts
  }
  try {
    const { data } = matter(raw)
    const start = toDateStr(data.start)
    const end = toDateStr(data.end)
    const t = (data.targets ?? {}) as Record<string, unknown>
    const meetings = toCount(t.meetings)
    const demos = toCount(t.demos)
    const loi = toCount(t.loi)
    if (!start || !end || meetings === null || demos === null || loi === null) return null

    const a = (data.actuals ?? {}) as Record<string, unknown>
    const phase0: Phase0Item[] = Array.isArray(data.phase0)
      ? data.phase0
          .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
          .map(p => ({
            id: String(p.id ?? ''),
            label: String(p.label ?? p.id ?? ''),
            done: p.done === true,
          }))
          .filter(p => p.label)
      : []

    return {
      campaign: typeof data.campaign === 'string' ? data.campaign : 'campaign',
      start, end, meetings, demos, loi,
      loiActual: toCount(a.loi) ?? 0,
      phase0,
    }
  } catch {
    return null // unparseable frontmatter reads as "no targets", never a crash
  }
}

// ── scoreboard ──────────────────────────────────────────────────────────────

export interface CampaignScore {
  targets: Targets | null
  meetingsHeld: number // agency meetings archived inside the window
  demosGiven: number   // of those, title matches DEMO_RE
  daysLeft: number | null
}

/**
 * Meetings and demos are counted from the crm/meetings archive (Granola sync)
 * rather than the calendar: the archive records meetings that HAPPENED, the
 * calendar records intentions. Only `category: agency` counts — internal,
 * product, and ops meetings are work, not selling.
 */
export async function getCampaignScore(): Promise<CampaignScore> {
  const targets = await getTargets()
  if (!targets) return { targets: null, meetingsHeld: 0, demosGiven: 0, daysLeft: null }

  const meetings = await listMeetings()
  const inWindow = meetings.filter(
    m => m.category === 'agency' && m.date >= targets.start && m.date <= targets.end
  )
  const demosGiven = inWindow.filter(m => DEMO_RE.test(m.title)).length
  const daysLeft = Math.max(
    0,
    Math.ceil((new Date(`${targets.end}T23:59:59`).getTime() - Date.now()) / 86_400_000)
  )
  return { targets, meetingsHeld: inWindow.length, demosGiven, daysLeft }
}

// ── strategic decisions ─────────────────────────────────────────────────────

export interface StrategicDecision {
  id: string         // `${file}:${lineNumber}` — stable across renders
  file: string       // relative to operations root, e.g. "gtm/2026-08-24-email-synthesis.md"
  lineNumber: number // 1-based, the line the resolution marker gets appended to
  text: string       // the question, one line, markdown-stripped
  source: string     // short tag for the UI, e.g. "email-synthesis"
}

// A decision flag only counts at the START of a line (list markers allowed) —
// a mention of the convention inside prose or backticks is documentation, not a
// decision. First verification run caught exactly that false positive.
const DECISION_LINE_RE = /^\s*(?:[-*]\s+)?\[DECISION\]\s*:?\s*(.+)$/
const RESOLVED_RE = /\[RESOLVED[ :]/
const QUESTIONS_HEADING_RE = /questions only .* can answer/i

// Directories scanned, relative to the operations root. gtm/ plus the two intel
// dirs agents write briefings into — the same set listIntelAlerts reads.
const DECISION_DIRS = ['gtm', 'intelligence/alerts', 'intelligence/weekly']

function stripMd(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim()
}

function sourceTag(relFile: string): string {
  const base = path.basename(relFile, '.md')
  // Drop a leading date prefix so the tag reads as a name, not a timestamp.
  return base.replace(/^\d{4}-\d{2}-\d{2}-?/, '') || base
}

/**
 * Two shapes count as an open decision:
 *  1. a line STARTING with `[DECISION]` (the forward convention agents emit —
 *     one decision per line, its own line), and
 *  2. numbered items under a "Questions only … can answer" heading (the
 *     retroactive shape already present in the email synthesis).
 * A line carrying `[RESOLVED …]` is history, not a decision.
 */
export function parseStrategicDecisions(content: string, relFile: string): StrategicDecision[] {
  const lines = content.split('\n')
  const out: StrategicDecision[] = []
  const seen = new Set<number>()

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(DECISION_LINE_RE)
    if (!m || RESOLVED_RE.test(lines[i])) continue
    const text = stripMd(m[1])
    if (!text) continue
    seen.add(i + 1)
    out.push({
      id: `${relFile}:${i + 1}`,
      file: relFile,
      lineNumber: i + 1,
      text,
      source: sourceTag(relFile),
    })
  }

  // Retroactive shape: walk the section under a matching heading line by line.
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].match(/^##+\s+(.*)$/)
    if (!heading || !QUESTIONS_HEADING_RE.test(heading[1])) continue
    for (let j = i + 1; j < lines.length; j++) {
      if (/^##+\s/.test(lines[j])) break // next section ends the sweep
      const item = lines[j].match(/^\s*\d+\.\s+(.*)$/)
      if (!item) continue
      const lineNumber = j + 1
      if (seen.has(lineNumber) || RESOLVED_RE.test(lines[j])) continue
      // First sentence-ish slice keeps multi-line rationale out of the queue row.
      const text = stripMd(item[1]).slice(0, 200)
      if (!text) continue
      out.push({
        id: `${relFile}:${lineNumber}`,
        file: relFile,
        lineNumber,
        text,
        source: sourceTag(relFile),
      })
    }
  }

  return out
}

export async function getStrategicDecisions(): Promise<StrategicDecision[]> {
  const all: StrategicDecision[] = []
  for (const dir of DECISION_DIRS) {
    const abs = path.join(PATHS.operationsRoot, dir)
    let names: string[]
    try {
      names = await fs.readdir(abs)
    } catch {
      continue
    }
    await Promise.all(
      names
        .filter(n => n.endsWith('.md') && !n.startsWith('.'))
        .map(async n => {
          try {
            const content = await fs.readFile(path.join(abs, n), 'utf-8')
            all.push(...parseStrategicDecisions(content, `${dir}/${n}`))
          } catch { /* unreadable file — skip, never break the queue */ }
        })
    )
  }
  // Newest files first (date-prefixed names sort naturally), then line order.
  return all.sort((a, b) => b.file.localeCompare(a.file) || a.lineNumber - b.lineNumber)
}

/**
 * Append `[RESOLVED YYYY-MM-DD]` to the flagged line. The file keeps its full
 * history — a resolved question stays readable in place, it just leaves the
 * queue. Same swallow-the-commit-failure posture as crm.ts: refusing the edit
 * because git hiccuped is worse than letting the janitor sweep it.
 */
export async function resolveStrategicDecision(relFile: string, lineNumber: number): Promise<boolean> {
  // relFile comes from an API route — accept only the scanned dirs, no traversal.
  if (relFile.includes('..') || !DECISION_DIRS.some(d => relFile.startsWith(`${d}/`))) return false
  const abs = path.join(PATHS.operationsRoot, relFile)

  const release = await acquireLock(PATHS.gtm)
  try {
    const content = await fs.readFile(abs, 'utf-8')
    const lines = content.split('\n')
    const line = lines[lineNumber - 1]
    if (line === undefined || RESOLVED_RE.test(line)) return false
    const today = new Date().toISOString().slice(0, 10)
    lines[lineNumber - 1] = `${line} [RESOLVED ${today}]`
    await atomicWrite(abs, lines.join('\n'))
  } catch {
    return false
  } finally {
    await release()
  }

  try {
    await runCommandArgs('git', ['-C', PATHS.operationsRoot, 'add', '--', relFile], 15_000)
    await runCommandArgs('git', [
      '-C', PATHS.operationsRoot, 'commit', '-q',
      '-m', `gtm: resolve decision — ${relFile}:${lineNumber}`,
      '--', relFile,
    ], 15_000)
  } catch { /* git unavailable — the janitor sweeps */ }
  return true
}
