/**
 * CRM board tests — bucketize and the by-agency grouping.
 *
 * Run:  node --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/crm-test.ts
 *
 * The agency is the client and the people inside it are touchpoints
 * (2026-09-10). Two cases below are the reason the grouping exists and the
 * reason it is careful:
 *
 *   `a quiet person at a warm agency is not going cold` — Shafi's 2025 OEIS
 *   demo raised its own alarm while the same work moved forward through Pindy.
 *
 *   `a warm agency never hides a dated commitment` — Robert Payne's CDT proposal
 *   was 43 days overdue while CDT itself read warm. Softening cold must never
 *   soften overdue.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { addDays, bucketize, today } from '../src/lib/crm.ts'
import type { CrmContact } from '../src/types/index.ts'

const ago = (days: number) => addDays(today(), -days)

function contact(slug: string, agency: string | undefined, over: Partial<CrmContact> = {}): CrmContact {
  return {
    slug, name: slug, agency, agencyName: agency?.toUpperCase(),
    stage: 'demo-given', status: 'active', notes: '',
    log: [{ date: ago(30), text: 'met', via: 'recall' }],
    ...over,
  }
}

test('a quiet person at a warm agency is not going cold', () => {
  const b = bucketize([
    contact('pindy', 'oeis', { lastTouched: ago(10) }),
    contact('shafi', 'oeis', { lastTouched: ago(359) }),
    contact('christine', 'lci', { lastTouched: ago(197) }),
  ])
  assert.deepEqual(b.goingCold.map(c => c.slug), ['christine'])
})

test('a warm agency never hides a dated commitment', () => {
  const b = bucketize([
    contact('robert', 'cdt', { lastTouched: ago(10), nextAction: 'proposal', nextActionDue: ago(43) }),
    contact('scott', 'cdt', { lastTouched: ago(50) }),
  ])
  assert.deepEqual(b.overdue.map(c => c.slug), ['robert'])
  assert.deepEqual(b.goingCold, [])
  assert.deepEqual(b.byAgency.map(g => g.items.map(i => [i.bucket, i.contact.slug])), [[['overdue', 'robert']]])
})

test('an import is not a touch: an unworked record does not warm its agency', () => {
  const b = bucketize([
    contact('seeded', 'dwr', { lastTouched: ago(1), log: [{ date: ago(1), text: 'seeded', via: 'seed' }] }),
    contact('jim', 'dwr', { lastTouched: ago(37) }),
  ])
  assert.deepEqual(b.goingCold.map(c => c.slug), ['jim'])
})

test('agencies rank by their most urgent row, and every row lands in exactly one agency', () => {
  const b = bucketize([
    contact('cold', 'ctc', { lastTouched: ago(300) }),
    contact('blocked', 'edd', { status: 'blocked', blockedOn: 'one-pager', lastTouched: ago(40) }),
    contact('robert', 'cdt', { lastTouched: ago(10), nextAction: 'proposal', nextActionDue: ago(43) }),
    contact('pindy', 'cdt', { lastTouched: ago(3) }),   // nothing due, still the freshest touch
    contact('andrew', 'cdt', { stage: 'identified', nextAction: 'intro', log: [] }),
  ])
  assert.deepEqual(b.byAgency.map(g => g.agency), ['edd', 'cdt', 'ctc'])
  assert.deepEqual(b.byAgency[1].items.map(i => i.bucket), ['overdue', 'notStarted'])
  assert.deepEqual(b.byAgency[1].lastTouch, { date: ago(3), days: 3, name: 'pindy' })

  const flat = b.blocked.length + b.overdue.length + b.dueToday.length + b.goingCold.length + b.notStarted.length
  assert.equal(b.byAgency.reduce((n, g) => n + g.items.length, 0), flat)
})
