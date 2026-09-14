/**
 * The pure half of Scribe's filing rules — what the deterministic filer
 * (scripts/scribe.ts) decides about a message once it knows who sent it.
 * Kept free of I/O so scripts/intake-test.ts can exercise every branch with
 * literal dates.
 *
 * Three rules live here, all born from the same audit (2026-09-14):
 *
 *   - A reply is a fact the store must notice. Robert Payne's Sep 1 follow-up
 *     was marked sent and his `next_action_due` stayed at 2026-07-29, so the
 *     board read "43 days overdue" while the thread was alive. An inbound
 *     whose subject matches something we sent in the last 45 days is a reply,
 *     and a reply means "respond", due today.
 *   - Sending resets the follow-up window. An outbound touch to a contact
 *     whose due date is older than the send is a follow-up already made; the
 *     next chase is ten days out, not overdue since July.
 *   - `via` names the mailbox. Outbound touches carry the account they were
 *     sent from (`email-out pavanm@…`), so a log line says WHO wrote, not just
 *     that someone did. Readers must therefore match `email-out` by prefix.
 */
import { addDays } from './crm'
import { isoToLocalDate } from './dates'
import type { CrmContactUpdate, CrmLogEntry } from '@/types'

/** How long after we email someone an inbound on the same subject counts as a reply. */
export const REPLY_WINDOW_DAYS = 45
/** How far out an outbound email pushes a stale follow-up due date. */
export const FOLLOWUP_WINDOW_DAYS = 10
export const REPLY_NEXT_ACTION = 'Reply received, respond'
export const SENT_NEXT_ACTION = 'Await reply; chase if silent'

/**
 * `Re: RE: Fwd: FW:  Prep agenda` → `prep agenda`. Mail clients disagree on
 * the prefix, its case, and how many they stack; the thread underneath is the
 * same, and that thread is what the match is about.
 */
export function normalizeSubject(subject: string): string {
  let s = (subject ?? '').trim()
  const prefix = /^(re|fwd?|fw)\s*:\s*/i
  while (prefix.test(s)) s = s.replace(prefix, '')
  return s.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** `email-out` or `email-out <account>`; the account says which mailbox sent it. */
export function emailOutVia(account?: string): string {
  const a = (account ?? '').trim()
  return a ? `email-out ${a}` : 'email-out'
}

/** True for the bare kind and for the kind carrying an account suffix. */
export function isVia(via: string | undefined, kind: 'email-in' | 'email-out'): boolean {
  return via === kind || (via?.startsWith(`${kind} `) ?? false)
}

/** Whole days from `from` to `to`, both YYYY-MM-DD. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const ms = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10))
    - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))
  return Math.round(ms / 86_400_000)
}

/** Whoever wrote the outbound, as the log names them: first name or mailbox local part. */
export function senderFirstName(name?: string, email?: string): string {
  let n = (name ?? '').trim()
  // Outlook writes "Last, First M.@ORG": the first name is after the comma.
  if (n.includes(',')) n = n.split(',')[1] ?? ''
  const first = n.trim().split(/\s+/)[0]?.replace(/[,"'@].*$/, '')
  if (first) return first
  return (email ?? '').split('@')[0] || 'us'
}

/**
 * The subject a log line says we sent, or undefined when the line is not an
 * outbound. Two writers produce outbound lines: Scribe (`email … to X: "subj"`,
 * via email-out) and the drafts mark-sent route (`Sent follow-up email: subj`,
 * via outreach).
 */
export function outboundSubjectOf(entry: Pick<CrmLogEntry, 'text' | 'via'>): string | undefined {
  if (isVia(entry.via, 'email-out')) return entry.text.match(/"([^"]+)"/)?.[1]
  if (entry.via === 'outreach') return entry.text.match(/^Sent follow-up email:\s*(.+)$/)?.[1]?.trim()
  return undefined
}

export interface ReplyMatch {
  /** The day we sent the email this one answers. */
  sentDate: string
  /** Whole days between our send and their reply. */
  days: number
}

/**
 * Is this inbound a reply to something we sent? Matches the normalised subject
 * against the contact's sent draft and every outbound log line within the
 * window; the most recent send at or before the inbound wins.
 */
export function findRepliedTo(
  subject: string,
  date: string,
  opts: {
    log: readonly Pick<CrmLogEntry, 'date' | 'text' | 'via'>[]
    sentDraft?: { subject: string; sentAt?: string; status?: string } | null
    windowDays?: number
  },
): ReplyMatch | null {
  const target = normalizeSubject(subject)
  if (!target) return null
  const window = opts.windowDays ?? REPLY_WINDOW_DAYS

  const sends: string[] = []
  for (const e of opts.log) {
    const s = outboundSubjectOf(e)
    if (s !== undefined && normalizeSubject(s) === target) sends.push(e.date)
  }
  const d = opts.sentDraft
  if (d && d.status === 'sent' && d.sentAt && normalizeSubject(d.subject) === target) {
    sends.push(isoToLocalDate(d.sentAt))
  }

  let best: ReplyMatch | null = null
  for (const sentDate of sends) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sentDate)) continue
    const days = daysBetween(sentDate, date)
    if (days < 0 || days > window) continue
    if (!best || sentDate > best.sentDate) best = { sentDate, days }
  }
  return best
}

/**
 * What a detected reply does to the contact's next action: nothing if a human
 * has set something since the send; otherwise "respond", due today.
 */
export function replyNextAction(
  contact: { nextAction?: string; nextActionDue?: string },
  sentDate: string,
  today: string,
): CrmContactUpdate | null {
  const stale = !contact.nextAction?.trim()
    || !contact.nextActionDue
    || contact.nextActionDue < sentDate
  if (!stale) return null
  return { nextAction: REPLY_NEXT_ACTION, nextActionDue: today }
}

/**
 * The due date an outbound email leaves behind, or null when it changes
 * nothing. Only a due date OLDER than the send is reset: a future date is a
 * plan someone made, and a contact with no date has no follow-up to move.
 */
export function resetDueAfterSend(
  nextActionDue: string | undefined,
  sendDate: string,
  windowDays = FOLLOWUP_WINDOW_DAYS,
): string | null {
  if (!nextActionDue || nextActionDue >= sendDate) return null
  return addDays(sendDate, windowDays)
}
