/**
 * Lead store tests — expiry.
 *
 * Run:  node --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/leads-test.ts
 *
 * A solicitation that closed is not a lead, and the store used to keep it in
 * the queue forever: 0531-0000039878 closed 2026-08-29 and was still `new` on
 * 2026-09-14. Two rules under test: a closed event is never ingested, and a
 * stored lead flips to `expired` exactly once (so a --on-change run announces
 * the flip and is quiet afterwards). Nothing is ever deleted.
 *
 * The store reads its root from HOME at import time, so HOME is pointed at a
 * scratch directory before the module loads. No rules file exists there, so
 * every event scores `unlikely`; the cases below pre-write lead files rather
 * than depending on scoring.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'leads-test-'))
process.env.HOME = home
const opsDir = path.join(home, 'repos/operations')
const leadsDir = path.join(opsDir, 'crm/leads')
await fs.mkdir(leadsDir, { recursive: true })
// A real repo, so the store's per-batch commit is exercised rather than swallowed.
execFileSync('git', ['-C', opsDir, 'init', '-q'])
execFileSync('git', ['-C', opsDir, 'config', 'user.email', 'leads-test@example.invalid'])
execFileSync('git', ['-C', opsDir, 'config', 'user.name', 'leads-test'])

const { syncLeads, listLeads, getLeadQueue } = await import('../src/lib/leads.ts')
const { addDays, today } = await import('../src/lib/crm.ts')

function seed(slug: string, endDate: string, triage = 'new'): Promise<void> {
  return fs.writeFile(path.join(leadsDir, `${slug}.md`), [
    '---', 'source: caleprocure', `business_unit: '${slug.slice(0, 4)}'`, `event_id: ${slug.slice(5)}`,
    `event_name: Lead ${slug}`, `end_date: '${endDate}'`, 'score: 45', 'bucket: possible',
    'rules_version: 0', `triage: ${triage}`, `first_seen: '${today()}'`, `last_seen: '${today()}'`,
    `last_scored: '${today()}'`, '---', `# Lead ${slug}`, '',
  ].join('\n'))
}

const event = (id: string, endDate: string) =>
  ({ businessUnit: '0531', eventId: id, eventName: `Event ${id}`, endDate, source: 'caleprocure' })

test('an event that already closed is never ingested', async () => {
  const out = await syncLeads([event('closed-1', addDays(today(), -1))], 'test')
  assert.equal(out.created, 0)
  assert.equal(out.expired, 1)
  assert.equal((await listLeads()).length, 0)
})

test('a stored lead whose deadline passed flips to expired once, and stays', async () => {
  await seed('0531-past-1', addDays(today(), -3))
  await seed('0531-open-1', addDays(today(), 10))

  const first = await syncLeads([], 'test')
  assert.equal(first.updated, 1)
  assert.deepEqual(first.reasons, [{ slug: '0531-past-1', why: `expired: closed ${addDays(today(), -3)}` }])
  const byslug = Object.fromEntries((await listLeads()).map(l => [l.slug, l.triage]))
  assert.deepEqual(byslug, { '0531-past-1': 'expired', '0531-open-1': 'new' })

  const log = execFileSync('git', ['-C', opsDir, 'log', '--format=%s%n%b'], { encoding: 'utf-8' })
  assert.match(log, /^leads: 0 new, 1 updated$/m)
  assert.match(log, /^via: test$/m)

  // The second pass has nothing to say: --on-change must stay silent.
  const second = await syncLeads([], 'test')
  assert.equal(second.updated, 0)
  assert.equal(second.created, 0)
})

test('expired leads leave the queue but never the store', async () => {
  const queue = (await getLeadQueue()).map(l => l.slug)
  assert.deepEqual(queue, ['0531-open-1'])
  assert.ok((await listLeads()).some(l => l.slug === '0531-past-1'))
})

test('a deadline that moved forward reopens an expired lead', async () => {
  const later = addDays(today(), 14)
  const out = await syncLeads([event('past-1', later)], 'test')
  assert.equal(out.updated, 1)
  assert.match(out.reasons[0].why, /^deadline: /)
  const lead = (await listLeads()).find(l => l.slug === '0531-past-1')
  assert.equal(lead?.triage, 'new')
  assert.equal(lead?.endDate, later)
})
