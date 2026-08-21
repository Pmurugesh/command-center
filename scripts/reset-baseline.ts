/**
 * One-time migration: clear seeded history that was never real.
 *
 * WHY: the seed set `last_touched` from the CIO Academy scan date and gave the 8
 * priority-outreach rows a due date of 2026-05-28. Neither was a commitment
 * anyone made. Scanning a badge is not a touch, and a plan that never started is
 * not a deadline that lapsed. Presenting them as "85 days overdue" and "88 days
 * cold" showed three months of debt that was never owed, and a board like that is
 * one you stop opening.
 *
 * WHY IT EDITS FILES DIRECTLY rather than going through updateContact: clearing
 * `last_touched` is deliberately NOT in the update API, because only a real
 * touch should ever set it and no surface should be able to fabricate one. A
 * one-time migration is the honest place for that, rather than widening the
 * library's API forever to serve a job that runs once. It still takes the store
 * lock and commits as one batch.
 *
 * KEPT: contacts, next_action text (a useful suggested play), owners, tiers,
 * agencies, and the seed log entry recording provenance. `created` already
 * records when each lead entered the pipeline, so nothing is lost.
 * NOT TOUCHED: blocked_on — still a true, current fact about a missing artifact.
 *
 * Run: node --experimental-strip-types --no-warnings scripts/run-ts.mjs \
 *        scripts/reset-baseline.ts [--dry]
 */
import fs from 'fs/promises'
import path from 'path'
import { PATHS } from '../src/lib/paths.ts'
import { listContacts, commitBatch, today } from '../src/lib/crm.ts'
import { acquireLock } from '../src/lib/store.ts'

const DRY = process.argv.includes('--dry')
const SEEDED_DATES = new Set(['2026-05-25', '2026-05-28'])
const MACHINE_VIA = ['seed', 'rederive', 'slug-reconcile', 'verify', 'roundtrip-test',
  'api-test', 'pavan-correction', 'lead-sync', 'baseline']

const contacts = await listContacts()
const targets = contacts.filter(c => {
  const worked = c.log.some(e => e.via && !MACHINE_VIA.includes(e.via))
  if (worked) return false                                   // real activity — leave alone
  const staleTouch = c.lastTouched && SEEDED_DATES.has(c.lastTouched)
  const staleDue = c.nextActionDue && SEEDED_DATES.has(c.nextActionDue)
  return Boolean(staleTouch || staleDue)
})

console.log(`${targets.length} contacts carry seeded dates`)
console.log(`  ${targets.filter(c => c.nextActionDue).length} with a fabricated due date`)
console.log(`  ${targets.filter(c => c.status === 'blocked').length} blocked (blocked_on preserved)`)

if (DRY) {
  for (const c of targets.slice(0, 5)) {
    console.log(`  e.g. ${c.name}: last_touched=${c.lastTouched} due=${c.nextActionDue ?? '-'}`)
  }
  process.exit(0)
}

const release = await acquireLock(PATHS.crm, PATHS.crmContacts)
let n = 0
try {
  for (const c of targets) {
    const file = path.join(PATHS.crmContacts, `${c.slug}.md`)
    let raw = await fs.readFile(file, 'utf-8')
    raw = raw.split('\n').filter(l =>
      !/^last_touched:/.test(l) && !/^next_action_due:/.test(l)).join('\n')
    const tmp = `${file}.${process.pid}.tmp`
    await fs.writeFile(tmp, raw, 'utf-8')
    await fs.rename(tmp, file)
    n++
  }
  await commitBatch(
    `baseline reset ${today()} — clear seeded touch dates and due dates on ${n} contacts\n\n` +
    'A badge scan is not a touch and a plan that never started is not a lapsed\n' +
    'deadline. These leads now report as "never contacted" rather than months\n' +
    'overdue. Provenance is preserved in each seed log entry and in `created`.',
    'baseline')
} finally {
  await release()
}
console.log(`cleared ${n} contacts`)
