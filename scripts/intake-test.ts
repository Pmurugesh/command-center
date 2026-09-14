/**
 * Intake rules tests — the pure half of Scribe's filing and the drafts PATCH.
 *
 * Run:  node --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/intake-test.ts
 *
 * The reply case is Robert Payne (2026-09-14 audit): a follow-up marked sent
 * on Sep 1 with `next_action_due` still 2026-07-29. When he answers, the board
 * must say "respond today", not "48 days overdue". The reset case is the same
 * contact seen from the send side: the Sep 1 email IS the chase, so the next
 * one is due Sep 11, not July.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { addDays } from '../src/lib/crm.ts'
import {
  FOLLOWUP_WINDOW_DAYS, REPLY_NEXT_ACTION, daysBetween, emailOutVia, findRepliedTo, isVia,
  normalizeSubject, outboundSubjectOf, replyNextAction, resetDueAfterSend, senderFirstName,
} from '../src/lib/scribe-rules.ts'
import { parseDraftPatch } from '../src/lib/followup.ts'
import { isoToLocalDate } from '../src/lib/dates.ts'

test('subject normalisation strips stacked reply prefixes, case and whitespace', () => {
  const want = 'prep agenda for july 22 cdt demo - round 2'
  for (const s of [
    'Re: Prep agenda for July 22 CDT demo - Round 2',
    'RE: re: Prep agenda for July 22 CDT demo - Round 2',
    'Fwd: FW:   Prep   agenda for July 22 CDT demo - Round 2  ',
    'Fw:Re:Prep agenda for July 22 CDT demo - Round 2',
  ]) assert.equal(normalizeSubject(s), want, s)
  assert.equal(normalizeSubject('Reply requested'), 'reply requested', 'a word starting with "re" is not a prefix')
  assert.equal(normalizeSubject(''), '')
})

test('email-out via carries the account and is matched by prefix', () => {
  assert.equal(emailOutVia('pavanm@4infinitesolutions.com'), 'email-out pavanm@4infinitesolutions.com')
  assert.equal(emailOutVia(undefined), 'email-out')
  assert.equal(isVia('email-out pavanm@4infinitesolutions.com', 'email-out'), true)
  assert.equal(isVia('email-out', 'email-out'), true)
  assert.equal(isVia('email-outreach', 'email-out'), false)
  assert.equal(isVia(undefined, 'email-in'), false)
})

test('outbound subject is read from both writers of outbound lines', () => {
  assert.equal(outboundSubjectOf({ text: 'email from Pavan to Robert Payne: "Re: Prep agenda"', via: 'email-out pavanm@x.com' }), 'Re: Prep agenda')
  assert.equal(outboundSubjectOf({ text: 'Sent follow-up email: Re: Prep agenda', via: 'outreach' }), 'Re: Prep agenda')
  assert.equal(outboundSubjectOf({ text: 'email from Robert Payne: "Re: Prep agenda"', via: 'email-in' }), undefined)
})

test('an inbound matching a sent draft within 45 days is a reply to that send', () => {
  const m = findRepliedTo('RE: Prep agenda for July 22 CDT demo - Round 2', '2026-09-14', {
    log: [
      { date: '2026-07-20', text: 'email to Robert Payne: "Re: Prep agenda for July 22 CDT demo - Round 2"', via: 'email-out' },
      { date: '2026-08-31', text: 'Sent follow-up email: Re: Prep agenda for July 22 CDT demo - Round 2', via: 'outreach' },
    ],
    sentDraft: { subject: 'Re: Prep agenda for July 22 CDT demo - Round 2', status: 'sent', sentAt: '2026-09-01T01:49:42.804Z' },
  })
  assert.ok(m)
  // The Jul 20 send is outside the window; of the two in-window sends the most recent wins.
  // The draft's sent_at is an instant (01:49Z); the CRM works in local dates, so the
  // expected day is whatever isoToLocalDate says on this machine (Aug 31 in Pacific,
  // Sep 1 on a UTC runner), and the log line's own date must not out-rank it.
  const sentLocal = isoToLocalDate('2026-09-01T01:49:42.804Z')
  assert.equal(m.sentDate, sentLocal >= '2026-08-31' ? sentLocal : '2026-08-31')
  assert.equal(m.days, daysBetween(m.sentDate, '2026-09-14'))
})

test('a reply is not a reply when nothing was sent on that thread recently', () => {
  const log = [{ date: '2026-06-01', text: 'email from Pavan to X: "Old thread"', via: 'email-out' }]
  assert.equal(findRepliedTo('Re: Old thread', '2026-09-14', { log }), null, '105 days is outside the window')
  assert.equal(findRepliedTo('Re: Something else', '2026-09-14', { log }), null, 'different subject')
  assert.equal(findRepliedTo('Re: Old thread', '2026-05-30', { log }), null, 'an inbound before the send is not a reply to it')
  assert.deepEqual(findRepliedTo('Re: Old thread', '2026-06-20', { log, sentDraft: { subject: 'Old thread', status: 'draft' } }), {
    sentDate: '2026-06-01', days: 19,
  }, 'an unsent draft is not a send, the log line is')
})

test('a reply makes the next action "respond, today" unless a human set something newer', () => {
  const today = '2026-09-14'
  assert.deepEqual(
    replyNextAction({ nextAction: 'Deliver the POC proposal', nextActionDue: '2026-07-29' }, '2026-08-31', today),
    { nextAction: REPLY_NEXT_ACTION, nextActionDue: today }, 'due date older than the send')
  assert.deepEqual(
    replyNextAction({}, '2026-08-31', today),
    { nextAction: REPLY_NEXT_ACTION, nextActionDue: today }, 'no action at all')
  assert.equal(
    replyNextAction({ nextAction: 'Call after their board meeting', nextActionDue: '2026-09-20' }, '2026-08-31', today),
    null, 'a plan made after the send stands')
})

test('an outbound resets a stale due date to send + 10 days, and nothing else', () => {
  assert.equal(resetDueAfterSend('2026-07-29', '2026-09-01'), addDays('2026-09-01', FOLLOWUP_WINDOW_DAYS))
  assert.equal(resetDueAfterSend('2026-07-29', '2026-09-01'), '2026-09-11')
  assert.equal(resetDueAfterSend('2026-09-20', '2026-09-01'), null, 'a future date is a plan')
  assert.equal(resetDueAfterSend('2026-09-01', '2026-09-01'), null, 'due the same day is not stale')
  assert.equal(resetDueAfterSend(undefined, '2026-09-01'), null, 'no follow-up to move')
  // Month and year boundaries go through addDays, not string arithmetic.
  assert.equal(resetDueAfterSend('2026-01-01', '2026-12-28'), '2027-01-07')
})

test('daysBetween and senderFirstName', () => {
  assert.equal(daysBetween('2026-08-31', '2026-09-14'), 14)
  assert.equal(daysBetween('2026-09-14', '2026-08-31'), -14)
  assert.equal(senderFirstName('Pavan Murugesh', 'pavanm@x.com'), 'Pavan')
  assert.equal(senderFirstName('Murugesh, Rani D.@DMV', 'rani@x.com'), 'Rani')
  assert.equal(senderFirstName('Pavan@ISI', 'p@x.com'), 'Pavan')
  assert.equal(senderFirstName(undefined, 'pavanm@x.com'), 'pavanm')
})

test('drafts PATCH accepts ready/checks/why_now, rejects wrong types, ignores unknown keys', () => {
  assert.deepEqual(parseDraftPatch({ ready: true, checks: 'dates real; no repo paths', why_now: 'due 09-11', edited: true, bogus: 1 }),
    { ok: true, patch: { ready: true, checks: 'dates real; no repo paths', whyNow: 'due 09-11' } })
  assert.deepEqual(parseDraftPatch({ ready: false }), { ok: true, patch: { ready: false } })
  for (const bad of [
    { ready: 'yes' }, { checks: 3 }, { why_now: ['x'] }, { ready: true, checks: null },
  ]) assert.equal(parseDraftPatch(bad).ok, false, JSON.stringify(bad))
  assert.equal(parseDraftPatch({ edited: true }).ok, false, 'nothing recognised is a 400, not a silent no-op')
  assert.equal(parseDraftPatch(null).ok, false)
  assert.equal(parseDraftPatch([]).ok, false)
})
