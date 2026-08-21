/**
 * Opportunity extraction from procurement scan reports.
 *
 * The caleprocure-scan cron writes intelligence/procurements/YYYY-MM-DD-*.md
 * with a stable shape (the format is pinned in the cron prompt):
 *
 *   ## 🔴 High Relevance (score 7-10)
 *   ### 0000039456 — EDD RFP 3475 for Salesforce M&O
 *   - **Department:** Employment Development Department
 *   - **Deadline:** 07/21/2026 12:00PM PDT
 *   - **Score:** 9/10
 *   - **Recommended entity:** Infinite Solutions
 *   - **Action:** Review solicitation docs immediately...
 *
 * The same event reappears in every daily scan while it's open, so we dedupe
 * by event id keeping the most recent mention.
 */
import fs from 'fs/promises'
import path from 'path'
import { PATHS } from './paths'

export interface Opportunity {
  eventId: string
  title: string
  department?: string
  deadlineAt?: string    // ISO, parsed from the Deadline field (server-local tz)
  deadlineRaw?: string
  score?: number         // 0–10
  entity?: string
  action?: string
  relevance: 'high' | 'medium'
  sourceFile: string
  sourceDate: string     // YYYY-MM-DD from the filename
}

const FIELD = (label: string, body: string): string | undefined => {
  const m = body.match(new RegExp(`\\*\\*${label}:?\\*\\*:?\\s*(.+)`, 'i'))
  return m ? m[1].trim() : undefined
}

// "07/21/2026 12:00PM PDT" / "09/14/2026 5:00PM" / "07/21/2026" → ISO (server tz).
function parseDeadline(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const dm = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (!dm) return undefined
  let hours = 17, minutes = 0 // assume end of business when no time given
  const tm = raw.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i)
  if (tm) {
    hours = parseInt(tm[1], 10) % 12
    minutes = parseInt(tm[2], 10)
    if (tm[3]?.toUpperCase() === 'PM') hours += 12
  }
  const d = new Date(parseInt(dm[3], 10), parseInt(dm[1], 10) - 1, parseInt(dm[2], 10), hours, minutes)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

export function parseOpportunities(content: string, sourceFile: string, sourceDate: string): Opportunity[] {
  const out: Opportunity[] = []
  const sections = content.split(/\n(?=## )/)

  for (const section of sections) {
    const heading = section.split('\n', 1)[0] ?? ''
    let relevance: Opportunity['relevance'] | null = null
    if (/🔴|high relevance/i.test(heading)) relevance = 'high'
    else if (/🟡|medium relevance/i.test(heading)) relevance = 'medium'
    if (!relevance) continue

    for (const block of section.split(/\n(?=### )/).slice(1)) {
      const titleLine = (block.split('\n', 1)[0] ?? '').replace(/^###\s*/, '').trim()
      if (!titleLine) continue
      // "0000039456 — EDD RFP 3475 ..." — id is optional
      const idMatch = titleLine.match(/^(\S+)\s+[—–-]\s+(.+)$/)
      const eventId = idMatch ? idMatch[1] : titleLine
      const title = idMatch ? idMatch[2].trim() : titleLine

      const deadlineRaw = FIELD('Deadline', block)
      const scoreRaw = FIELD('Score', block)
      const scoreMatch = scoreRaw?.match(/(\d+(?:\.\d+)?)\s*\/\s*10/)

      out.push({
        eventId,
        title,
        department: FIELD('Department', block),
        deadlineRaw,
        deadlineAt: parseDeadline(deadlineRaw),
        score: scoreMatch ? parseFloat(scoreMatch[1]) : undefined,
        entity: FIELD('Recommended entity', block),
        action: FIELD('Action', block),
        relevance,
        sourceFile,
        sourceDate,
      })
    }
  }
  return out
}

/**
 * Open opportunities across recent procurement scans: newest mention wins,
 * expired deadlines drop out, soonest deadline first (undated sink to the end).
 */
export async function getOpenOpportunities(maxAgeDays = 21): Promise<Opportunity[]> {
  const dir = path.join(PATHS.intelligenceBase, 'procurements')
  let files: string[]
  try {
    files = await fs.readdir(dir)
  } catch {
    return []
  }

  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
  const dated = files
    .map(f => ({ file: f, date: f.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] }))
    .filter((x): x is { file: string; date: string } =>
      Boolean(x.date && x.file.endsWith('.md') && new Date(x.date).getTime() >= cutoff))
    .sort((a, b) => b.date.localeCompare(a.date))

  const byId = new Map<string, Opportunity>()
  for (const { file, date } of dated) {
    let content: string
    try {
      content = await fs.readFile(path.join(dir, file), 'utf-8')
    } catch {
      continue
    }
    for (const opp of parseOpportunities(content, file, date)) {
      // Files are processed newest-first; first sighting of an id is the freshest.
      if (!byId.has(opp.eventId)) byId.set(opp.eventId, opp)
    }
  }

  const now = Date.now()
  return Array.from(byId.values())
    .filter(o => !o.deadlineAt || new Date(o.deadlineAt).getTime() >= now)
    .sort((a, b) => {
      if (a.deadlineAt && b.deadlineAt) return a.deadlineAt.localeCompare(b.deadlineAt)
      if (a.deadlineAt) return -1
      if (b.deadlineAt) return 1
      return (b.score ?? 0) - (a.score ?? 0)
    })
}
