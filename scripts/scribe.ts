/**
 * Scribe, the deterministic half — files staged email into the CRM.
 *
 * Layer 2 of the M3.5 intake design, restricted to what an exact email-address
 * match PROVES; everything needing judgment goes to the review queue instead of
 * being guessed at. Per the design's core rule, the LLM never owns the
 * mechanical half — and filing on an exact match is mechanical:
 *
 *   from = a CRM contact          → inbound touch: appendLog with the real date,
 *                                   via 'email-in'. Bumps last_touched (they are
 *                                   demonstrably not cold) but does NOT advance
 *                                   stage or count toward momentum — an inbound
 *                                   email is the contact touching us. If the
 *                                   subject matches something we sent them in
 *                                   the last 45 days, the line reads `replied:`
 *                                   and the next action becomes "respond, today".
 *   from = one of us              → outbound touch on each CRM recipient, via
 *                                   'email-out <account>'. This IS human selling:
 *                                   a person wrote it; Scribe only records it —
 *                                   and a stale due date is reset to send+10d,
 *                                   because the follow-up just happened.
 *   anything else                 → review queue row (sender, subject, date,
 *                                   reason — never the body) for the dashboard.
 *                                   Rows nobody resolves in 30 days go stale.
 *
 * "One of us" is OWN_DOMAINS plus TEAM_ADDRESSES, mirrored from
 * scripts/sync-email.py: team members write from @dmv.ca.gov and personal
 * gmails, and were being queued as correspondents to add.
 *
 * Idempotent by staged-file stem, tracked in `.ledger` inside the staging dir.
 * Staged files are never moved or deleted: the connector's own dedupe is "which
 * files exist in this dir", so moving one would re-stage the message.
 *
 * Run:  node --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/scribe.ts [--dry]
 */
import fs from 'fs/promises'
import path from 'path'
import { PATHS } from '../src/lib/paths.ts'
import { localToday } from '../src/lib/dates.ts'
import { appendLog, listContacts, updateContact } from '../src/lib/crm.ts'
import { readDraft } from '../src/lib/followup.ts'
import { expireStale, upsertPending } from '../src/lib/intake-review.ts'
import {
  emailOutVia, findRepliedTo, replyNextAction, resetDueAfterSend, senderFirstName,
} from '../src/lib/scribe-rules.ts'
import type { IntakeReviewItem } from '../src/types/index.ts'

// Keep in sync with OWN_DOMAINS / DEFAULT_TEAM_ADDRESSES in scripts/sync-email.py —
// mail from these is us writing, not a counterparty writing in.
const OWN_DOMAINS = new Set([
  '4infinitesolutions.com', 'infinitellm.ai', 'infiniteai.com',
  'mybedrock.app', 'novaerasol.com',
])
const TEAM_ADDRESSES = new Set(
  (process.env.TEAM_ADDRESSES
    ?? 'ganapathy.murugesh@dmv.ca.gov,rani.murugesh@dmv.ca.gov,pavanmurugesh2002@gmail.com,ganamuru@gmail.com')
    .split(',').map(a => a.trim().toLowerCase()).filter(Boolean),
)
/** Review-queue rows older than this are a question nobody is going to answer. */
const REVIEW_STALE_DAYS = 30

const LEDGER_PATH = path.join(PATHS.crmIntakeEmail, '.ledger')
// Staged files are named by the connector's hex message hash; anything else in
// the dir (the ledger, editor droppings) is not a message.
const STAGED_NAME = /^[0-9a-f]{16,}\.json$/

interface StagedEmail {
  message_id: string
  date: string
  subject: string
  from: string
  addresses: string[]
  matched: string
  /** The IMAP user the connector read this from. Absent on files staged before 2026-09-14. */
  account?: string
}

interface LedgerEntry {
  action: 'touch-in' | 'touch-out' | 'review' | 'internal' | 'auto-reply'
  slugs?: string[]
  at: string
}

// An autoresponder is a robot answering, not a person engaging: logging it as a
// touch would bump last_touched (and, from a known contact, fake thread
// activity), and queueing an unknown sender's OOO robot would ask "add this
// person?" about someone who never wrote to us. Ledgered, never filed.
const AUTO_REPLY_SUBJECT =
  /^\s*(re:\s*)?(automatic reply|auto[- ]?reply|out of (the )?office|autosvar|abwesenheit)/i

function parseAddr(header: string): { email: string; name?: string } {
  const angle = header.match(/<([^>]+)>/)
  const email = (angle?.[1] ?? header.match(/[\w.+-]+@[\w.-]+/)?.[0] ?? '').toLowerCase()
  const name = header.split('<')[0].replace(/["']/g, '').trim() || undefined
  return { email, name }
}

const domainOf = (email: string) => email.split('@')[1] ?? ''
const isUs = (email: string) => TEAM_ADDRESSES.has(email) || OWN_DOMAINS.has(domainOf(email))

async function main() {
  const dry = process.argv.includes('--dry')

  const contacts = await listContacts()
  // Primary and alt addresses resolve identically: linking an address to a
  // contact once (alt_emails frontmatter) files every future message from it.
  const byEmail = new Map(
    contacts.flatMap(c =>
      [c.email, ...(c.altEmails ?? [])]
        .filter((e): e is string => Boolean(e))
        .map(e => [e.toLowerCase(), c] as const),
    ),
  )
  // Guards duplicate log entries: same contact + date + text is one fact,
  // whether the duplicate comes from a double-delivered message in this run or
  // a lost ledger causing a re-sweep.
  const written = new Set<string>()
  const alreadyLogged = (c: { slug: string; log: { date: string; text: string }[] },
    date: string, text: string) =>
    written.has(`${c.slug}|${date}|${text}`) ||
    c.log.some(e => e.date === date && e.text === text)

  let ledger: Record<string, LedgerEntry> = {}
  try { ledger = JSON.parse(await fs.readFile(LEDGER_PATH, 'utf8')) } catch { /* first run */ }

  let names: string[] = []
  try { names = await fs.readdir(PATHS.crmIntakeEmail) } catch { /* no staging dir on this machine */ }
  const pendingFiles = names.filter(n => STAGED_NAME.test(n) && !ledger[n.replace('.json', '')])

  const counts = { in: 0, replies: 0, out: 0, reset: 0, review: 0, internal: 0, autoReply: 0, skipped: 0 }
  const today = localToday()

  // The review queue is per correspondent, not per message: five emails from
  // one unknown person are one question, asked once.
  const reviewByEmail = new Map<string, IntakeReviewItem>()
  function noteReview(
    email: string, direction: 'in' | 'out', date: string,
    from: string, fromName: string | undefined, subject: string, matched: string,
  ) {
    counts.review++
    const existing = reviewByEmail.get(email)
    if (!existing) {
      reviewByEmail.set(email, {
        id: email, date, from, email, fromName, subject, matched,
        direction, count: 1, status: 'pending', notedAt: today,
      })
      return
    }
    existing.count++
    if (date >= existing.date) {
      existing.date = date
      existing.subject = subject
      existing.from = from
      existing.fromName = fromName ?? existing.fromName
      existing.direction = direction
    }
  }

  for (const name of pendingFiles.sort()) {
    const stem = name.replace('.json', '')
    let msg: StagedEmail
    try { msg = JSON.parse(await fs.readFile(path.join(PATHS.crmIntakeEmail, name), 'utf8')) } catch {
      counts.skipped++
      continue
    }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(msg.date) ? msg.date : today
    const sender = parseAddr(msg.from)
    const subject = (msg.subject || '(no subject)').trim()

    if (AUTO_REPLY_SUBJECT.test(subject)) {
      counts.autoReply++
      if (dry) console.log(`auto-reply ${sender.email}  ${date}  "${subject}"`)
      else ledger[stem] = { action: 'auto-reply', at: today }
      continue
    }

    const fromContact = byEmail.get(sender.email)
    if (fromContact) {
      counts.in++
      // A reply to something we sent is a different fact from "they wrote":
      // it closes the follow-up loop the send opened. The sent draft and the
      // outbound log lines are the two records of what we sent.
      const draft = await readDraft(fromContact.slug).catch(() => null)
      const reply = findRepliedTo(subject, date, { log: fromContact.log, sentDraft: draft })
      const text = reply
        ? `replied: "${subject}" (${reply.days} days after our ${reply.sentDate} email)`
        : `email from ${fromContact.name}: "${subject}"`
      if (reply) {
        counts.replies++
        // One stdout line per reply so the tick's log carries it.
        console.log(`reply      ${fromContact.slug}  ${date}  "${subject}"  (${reply.days}d after ${reply.sentDate})`)
      } else if (dry) {
        console.log(`touch-in   ${fromContact.slug}  ${date}  "${subject}"`)
      }
      if (!dry) {
        if (!alreadyLogged(fromContact, date, text)) {
          await appendLog(fromContact.slug, text, { via: 'email-in', date, advanceStage: false })
          written.add(`${fromContact.slug}|${date}|${text}`)
        }
        if (reply) {
          const patch = replyNextAction(fromContact, reply.sentDate, today)
          if (patch) {
            await updateContact(fromContact.slug, patch, 'email-in')
            Object.assign(fromContact, patch)
          }
        }
        ledger[stem] = { action: 'touch-in', slugs: [fromContact.slug], at: today }
      }
      continue
    }

    if (isUs(sender.email)) {
      const recipients = [...new Set(
        (msg.addresses || [])
          .map(a => a.toLowerCase())
          .filter(a => a !== sender.email && !isUs(a)),
      )]
      const known = recipients.map(a => byEmail.get(a)).filter(Boolean)
      if (known.length) {
        counts.out++
        const who = senderFirstName(sender.name, sender.email)
        const via = emailOutVia(msg.account)
        for (const c of known) {
          // The send itself is the follow-up: a due date older than it is a
          // chase that just happened, so the next one is ten days out.
          const resetTo = resetDueAfterSend(c!.nextActionDue, date)
          const text = `email from ${who} to ${c!.name}: "${subject}"`
            + (resetTo ? ' (follow-up window reset by email-out)' : '')
          if (dry) {
            console.log(`touch-out  ${c!.slug}  ${date}  "${subject}"${resetTo ? `  due → ${resetTo}` : ''}`)
          } else if (!alreadyLogged(c!, date, text)) {
            await appendLog(c!.slug, text, { via, date })
            written.add(`${c!.slug}|${date}|${text}`)
            if (resetTo) {
              counts.reset++
              await updateContact(c!.slug, { nextActionDue: resetTo }, via)
              c!.nextActionDue = resetTo
            }
          }
        }
        if (!dry) ledger[stem] = { action: 'touch-out', slugs: known.map(c => c!.slug), at: today }
        continue
      }
      if (!recipients.length) {
        // Us writing to us — an internal forward the connector staged because
        // its body quotes a client thread. Not CRM relationship material;
        // listed in the ledger (no silent drops) but never queued as a person
        // to add.
        counts.internal++
        if (dry) console.log(`internal   ${sender.email}  ${date}  "${subject}"`)
        else ledger[stem] = { action: 'internal', at: today }
        continue
      }
      // We wrote to someone the CRM does not know — that is exactly the kind of
      // relationship the store exists to capture. Review, direction 'out'.
      noteReview(recipients[0], 'out', date, msg.from, undefined, subject, msg.matched || '')
      if (dry) console.log(`review-out ${recipients[0]}  ${date}  "${subject}"`)
      else ledger[stem] = { action: 'review', at: today }
      continue
    }

    noteReview(sender.email, 'in', date, msg.from, sender.name, subject, msg.matched || '')
    if (dry) console.log(`review-in  ${sender.email}  ${date}  "${subject}"`)
    else ledger[stem] = { action: 'review', at: today }
  }

  let stale = 0
  if (!dry) {
    if (reviewByEmail.size) await upsertPending(Array.from(reviewByEmail.values()), 'scribe')
    stale = await expireStale(REVIEW_STALE_DAYS, 'scribe')
    if (Object.keys(ledger).length) {
      await fs.writeFile(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`)
    }
  }

  console.log(
    `scribe${dry ? ' (dry)' : ''}: ${pendingFiles.length} new — ` +
    `touches in ${counts.in} (${counts.replies} replies) / out ${counts.out} (${counts.reset} due reset), ` +
    `review ${counts.review} msg → ${reviewByEmail.size} correspondent(s), ` +
    `internal ${counts.internal}, auto-replies ${counts.autoReply}, unreadable ${counts.skipped}` +
    (stale ? `, ${stale} review row(s) went stale` : ''),
  )
}

main().catch(err => { console.error('scribe failed:', err); process.exit(1) })
