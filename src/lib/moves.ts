/**
 * Today's Moves — ONE ranked queue instead of five competing cards.
 *
 * The old Today page had Decisions, Opportunities, Action Queue, Morning
 * Actions, and Pipeline Buckets all asking for attention, which meant the merge
 * happened in Pavan's head every morning. This module does the merge: every
 * source becomes a Move with an action-phrased one-liner, a deep link, and a
 * leverage score, and the top of the list is the highest-leverage thing to do
 * right now.
 *
 * Also home to the Waiting On view (delegation): a solo founder's queue must
 * hold only his own moves — work owned by Ganapathy/Rani/Isaiah is tracked, not
 * mixed in.
 */
import type { CrmBuckets, CrmContact } from '@/types'
import type { DecisionItem } from './decisions'
import type { Blocker } from './insights'
import type { Opportunity } from './procurements'
import type { StrategicDecision } from './gtm'
import type { Channel } from './channels'
import { CRM_TERMINAL_STAGES } from './config'

export type MoveKind = 'strategic' | 'blocker' | 'bid-decision' | 'crm-due' | 'deadline' | 'channel'

export interface Move {
  id: string
  kind: MoveKind
  action: string // action-phrased one-liner: "Make: …", "Decide: …", "Touch: …"
  detail?: string
  href: string
  source: string // short chip: 'gtm', 'bid', 'crm', 'scan', 'channel', …
  due?: string // YYYY-MM-DD when there is a hard date
  leverage?: number // contacts unblocked (blocker kind)
  score: number
  // crm-due only: enables the inline log-touch quick action
  contactSlug?: string
  // strategic only: enables the inline Resolve quick action
  file?: string
  lineNumber?: number
}

/** Owner fields carry comma-joined pairs ("Ganapathy, Rani"). Normalize once. */
export function ownersOf(owner?: string): string[] {
  return (owner ?? '').split(',').map(s => s.trim()).filter(Boolean)
}

function isPavans(owner?: string): boolean {
  const owners = ownersOf(owner)
  // Unowned work defaults to the founder — that is what solo means.
  return owners.length === 0 || owners.some(o => o.toLowerCase() === 'pavan')
}

function daysUntil(due: string): number {
  const [y, m, d] = due.split('-').map(Number)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return Math.round((new Date(y, m - 1, d).getTime() - today) / 86_400_000)
}

// Urgency from a hard date. Overdue work compounds; a due date two weeks out
// barely registers.
function urgency(due?: string): number {
  if (!due) return 0
  const d = daysUntil(due)
  if (d < 0) return 30 + Math.min(-d, 14)
  if (d === 0) return 30
  if (d <= 2) return 22
  if (d <= 7) return 12
  if (d <= 14) return 5
  return 0
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export interface MovesInput {
  strategic: StrategicDecision[]
  bidDecisions: DecisionItem[]
  blockers: Blocker[]
  buckets: CrmBuckets
  opportunities: Opportunity[]
  channels: Channel[] // pre-filtered: channelAlerts() output
}

/**
 * Base scores encode the leverage thesis: an artifact that unblocks four
 * contacts (65) outranks an overdue individual touch (~60) outranks a strategic
 * gate (45) outranks a dated solicitation (≤37). Urgency from real dates is
 * added on top; ties break toward leverage, then the nearer date.
 */
export function buildMoves(input: MovesInput): Move[] {
  const moves: Move[] = []

  for (const b of input.blockers) {
    const n = b.contacts.length
    moves.push({
      id: `blocker:${b.reason}`,
      kind: 'blocker',
      action: `Make: ${b.reason}`,
      detail: `Unblocks ${b.contacts.map(c => c.name).join(', ')}`,
      href: '/#pipeline',
      source: 'crm',
      leverage: n,
      score: 25 + 10 * Math.min(n, 5),
    })
  }

  for (const d of input.strategic) {
    moves.push({
      id: `strategic:${d.id}`,
      kind: 'strategic',
      action: `Decide: ${truncate(d.text, 140)}`,
      href: `/gtm#${d.file.split('/').pop()?.replace(/\.md$/, '')}`,
      source: d.source,
      score: 45,
      file: d.file,
      lineNumber: d.lineNumber,
    })
  }

  for (const d of input.bidDecisions) {
    moves.push({
      id: `bid:${d.bidName}:${d.fileName}:${d.flagIndex}`,
      kind: 'bid-decision',
      action: `Decide: ${d.bidDisplayName} — ${d.fileDisplayName}`,
      detail: truncate(d.snippet.replace(/\[HUMAN DECISION NEEDED\]:?\s*/g, ''), 160),
      href: `/bids/${d.bidName}#${d.fileName}`,
      source: 'bid',
      score: 30,
    })
  }

  for (const c of [...input.buckets.overdue, ...input.buckets.dueToday]) {
    if (!isPavans(c.owner)) continue // delegated work belongs in Waiting On
    moves.push({
      id: `crm:${c.slug}`,
      kind: 'crm-due',
      action: `Touch: ${c.name}${c.agencyName ? ` (${c.agencyName})` : ''}`,
      detail: c.nextAction,
      href: '/#pipeline',
      source: 'crm',
      due: c.nextActionDue,
      score: 20 + urgency(c.nextActionDue),
      contactSlug: c.slug,
    })
  }

  for (const o of input.opportunities) {
    if (!o.deadlineAt) continue
    const due = o.deadlineAt.slice(0, 10)
    const u = urgency(due)
    if (daysUntil(due) > 7) continue // distant solicitations live on the Clock, not here
    moves.push({
      id: `opp:${o.eventId}`,
      kind: 'deadline',
      action: `Respond: ${truncate(o.title, 100)}`,
      detail: o.department,
      href: '/intel',
      source: 'scan',
      due,
      score: 15 + (o.score !== undefined && o.score >= 8 ? 10 : 0) + u,
    })
  }

  for (const c of input.channels) {
    const next = c.nextActions[0] ?? (c.blockedOn ? `unblock: ${c.blockedOn}` : undefined)
    if (!next) continue
    moves.push({
      id: `channel:${c.slug}`,
      kind: 'channel',
      action: `Advance: ${c.name} — ${truncate(next, 100)}`,
      detail: c.blockedOn && c.nextActions[0] ? `Blocked on ${c.blockedOn}` : undefined,
      href: `/channels#${c.slug}`,
      source: 'channel',
      score: 15 + (c.staleness === 'cold' ? 12 : 0) + (c.status === 'blocked' ? 10 : 0),
    })
  }

  return moves.sort((a, b) =>
    b.score - a.score ||
    (b.leverage ?? 0) - (a.leverage ?? 0) ||
    (a.due ?? '9999').localeCompare(b.due ?? '9999')
  )
}

// ── Waiting On ──────────────────────────────────────────────────────────────

export interface WaitingOnItem {
  slug: string
  name: string
  agencyName?: string
  nextAction: string
  nextActionDue?: string
  daysOverdue?: number
}

export interface WaitingOnGroup {
  owner: string
  items: WaitingOnItem[]
  overdueCount: number
}

/**
 * Live contacts with a next action owned by someone other than Pavan, grouped
 * per owner. A comma-pair contact appears under each named owner (the tally()
 * precedent — no phantom "Ganapathy, Rani" third person). Items without a due
 * date are tracked but never "overdue": no date, no debt.
 */
export function buildWaitingOn(contacts: CrmContact[]): WaitingOnGroup[] {
  const groups = new Map<string, WaitingOnGroup>()
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  for (const c of contacts) {
    if (!c.nextAction || c.status === 'dormant' || CRM_TERMINAL_STAGES.includes(c.stage)) continue
    const owners = ownersOf(c.owner).filter(o => o.toLowerCase() !== 'pavan')
    if (owners.length === 0) continue
    if (ownersOf(c.owner).some(o => o.toLowerCase() === 'pavan')) continue // shared with Pavan = his move

    const daysOverdue = c.nextActionDue && c.nextActionDue < todayStr
      ? -daysUntil(c.nextActionDue)
      : undefined

    for (const owner of owners) {
      if (!groups.has(owner)) groups.set(owner, { owner, items: [], overdueCount: 0 })
      const g = groups.get(owner)!
      g.items.push({
        slug: c.slug,
        name: c.name,
        agencyName: c.agencyName,
        nextAction: c.nextAction,
        nextActionDue: c.nextActionDue,
        daysOverdue,
      })
      if (daysOverdue !== undefined) g.overdueCount++
    }
  }

  for (const g of Array.from(groups.values())) {
    g.items.sort((a, b) =>
      (b.daysOverdue ?? -1) - (a.daysOverdue ?? -1) ||
      (a.nextActionDue ?? '9999').localeCompare(b.nextActionDue ?? '9999')
    )
  }
  return Array.from(groups.values()).sort(
    (a, b) => b.overdueCount - a.overdueCount || b.items.length - a.items.length
  )
}
