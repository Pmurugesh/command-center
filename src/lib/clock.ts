/**
 * The Clock — everything with a date in the next 14 days, one list.
 *
 * Meetings (calendar), bid response deadlines, scored procurement deadlines,
 * and lead end-dates used to live on three different cards; assembling "what's
 * due this week" was reader work. buildClock is a pure merge over data the
 * Today page already fetches, so it adds no I/O.
 */
import type { Meeting } from './calendar'
import type { Opportunity } from './procurements'
import type { Lead } from './leads'
import type { Bid } from '@/types'

export type ClockKind = 'meeting' | 'bid' | 'opportunity' | 'lead'

export interface ClockItem {
  id: string
  kind: ClockKind
  at: string // ISO; date-only sources land at 17:00 local (procurements.ts precedent)
  allDay: boolean
  title: string
  subtitle?: string
  href?: string
  isDemo?: boolean // meetings only
  score?: number   // opportunities only
}

export const CLOCK_WINDOW_DAYS = 14

// Same closed-set the Today page uses for "active bids".
const CLOSED_BID_STATUSES = new Set(['won', 'lost', 'no-bid', 'submitted'])

// A date-only deadline means "by end of business that day".
function endOfBusiness(dateStr: string): string {
  return new Date(`${dateStr}T17:00:00`).toISOString()
}

export function buildClock(
  inputs: {
    meetings: Meeting[]
    bids: Bid[]
    opportunities: Opportunity[]
    leads: Lead[]
  },
  now = new Date()
): ClockItem[] {
  const windowStart = now.getTime()
  const windowEnd = windowStart + CLOCK_WINDOW_DAYS * 24 * 60 * 60 * 1000
  const inWindow = (iso: string) => {
    const t = new Date(iso).getTime()
    return !isNaN(t) && t >= windowStart && t <= windowEnd
  }

  const items: ClockItem[] = []

  for (const m of inputs.meetings) {
    if (!inWindow(m.startAt)) continue
    items.push({
      id: `meeting:${m.uid}`,
      kind: 'meeting',
      at: m.startAt,
      allDay: m.allDay,
      title: m.title,
      subtitle: [m.calendar, m.location].filter(Boolean).join(' · '),
      isDemo: m.isDemo,
    })
  }

  for (const b of inputs.bids) {
    if (!b.deadlineAt || CLOSED_BID_STATUSES.has((b.status || '').toLowerCase())) continue
    const at = endOfBusiness(b.deadlineAt)
    if (!inWindow(at)) continue
    items.push({
      id: `bid:${b.name}`,
      kind: 'bid',
      at,
      allDay: false,
      title: `${b.displayName} — response due`,
      subtitle: b.entity,
      href: `/bids/${b.name}`,
    })
  }

  // Leads and opportunities can describe the same solicitation; the
  // opportunity wins — it carries score, entity, and a recommended action.
  // Opportunity eventIds are "<businessUnit>-<eventId>", which is exactly the
  // lead's slug (verified against the live 0531-0000039878 pair).
  const oppEventIds = new Set<string>()

  for (const o of inputs.opportunities) {
    if (!o.deadlineAt || !inWindow(o.deadlineAt)) continue
    oppEventIds.add(o.eventId)
    items.push({
      id: `opp:${o.eventId}`,
      kind: 'opportunity',
      at: o.deadlineAt,
      allDay: false,
      title: o.title,
      subtitle: o.department,
      href: '/intel',
      score: o.score,
    })
  }

  for (const l of inputs.leads) {
    if (l.triage === 'skip' || l.bucket === 'unlikely') continue
    if (!l.endDate || oppEventIds.has(l.slug) || oppEventIds.has(l.eventId)) continue
    const at = endOfBusiness(l.endDate)
    if (!inWindow(at)) continue
    items.push({
      id: `lead:${l.slug}`,
      kind: 'lead',
      at,
      allDay: false,
      title: l.eventName,
      subtitle: l.department,
      href: '/intel',
      score: undefined,
    })
  }

  return items.sort((a, b) => a.at.localeCompare(b.at))
}
