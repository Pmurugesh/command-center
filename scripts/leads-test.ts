/**
 * Lead store tests — expiry, and the Infinite Solutions lens.
 *
 * Run:  node --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/leads-test.ts
 *
 * A solicitation that closed is not a lead, and the store used to keep it in
 * the queue forever: 0531-0000039878 closed 2026-08-29 and was still `new` on
 * 2026-09-14. Two rules under test: a closed event is never ingested, and a
 * stored lead flips to `expired` exactly once (so a --on-change run announces
 * the flip and is quiet afterwards). Nothing is ever deleted.
 *
 * The consulting lens arrives as the scan's JSON sidecar (the qual_table rules
 * only run on the mini). The EDD Salesforce M&O RFP scored 75 consulting and 0
 * product, so it never became a lead until this path existed; the fixture below
 * is that event, beside a product-only one and one that has already closed.
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

const { syncLeads, syncConsultingLeads, readLatestSidecar, leadEventKey, listLeads, getLeadQueue } = await import('../src/lib/leads.ts')
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

// ── Infinite Solutions lens ─────────────────────────────────────────────────

const procurementsDir = path.join(opsDir, 'intelligence/procurements')
const lens = (score: number, reasons: string[] = []) =>
  ({ score, bucket: score >= 40 ? 'likely' : score >= 20 ? 'possible' : 'unlikely', reasons })
const sidecar = (events: object[]) => fs.writeFile(
  path.join(procurementsDir, `${today()}-caleprocure.json`), JSON.stringify(events, null, 1))

test('the newest sidecar is the one read, and none is not an error', async () => {
  assert.equal(await readLatestSidecar(), null)
  await fs.mkdir(procurementsDir, { recursive: true })
  await fs.writeFile(path.join(procurementsDir, '2026-09-01-caleprocure.json'), '[]')
  await fs.writeFile(path.join(procurementsDir, '2026-09-02-caleprocure.md'), '# not the sidecar')
  await sidecar([])
  const latest = await readLatestSidecar()
  assert.equal(latest?.file, `${today()}-caleprocure.json`)
  assert.deepEqual(latest?.events, [])
})

test('a consulting-lens shortlist event becomes an Infinite Solutions lead; product-only and closed ones do not', async () => {
  const edd = {
    event_id: '0000039456', business_unit: '7100', name: 'EDD RFP 3475 for Salesforce M&O',
    department: 'Employment Development Dept', end_date: addDays(today(), 7), url: null, rules_version: 3,
    lenses: { consulting: lens(75, ['title: enterprise platform', 'buyer we know: EDD']), product: lens(0) },
  }
  const workiva = {
    event_id: 'ESAR70126Z', business_unit: '0840', name: 'Workiva SaaS', department: 'State Controller',
    end_date: addDays(today(), 7), rules_version: 3, lenses: { consulting: lens(10), product: lens(60) },
  }
  const closed = {
    event_id: '0000039000', business_unit: '7730', name: 'Closed consulting event', department: 'FTB',
    end_date: addDays(today(), -2), rules_version: 3, lenses: { consulting: lens(55), product: lens(0) },
  }
  await sidecar([edd, workiva, closed])
  const before = (await listLeads()).map(l => `${l.slug}:${l.triage}:${l.lastScored}`).sort()

  const out = await syncConsultingLeads((await readLatestSidecar())!.events, 'test')
  assert.equal(out.created, 1)
  assert.equal(out.expired, 1)
  assert.equal(out.unchanged, 1)
  assert.deepEqual(out.reasons, [{ slug: '7100-0000039456-is', why: 'new' }])

  const lead = (await listLeads()).find(l => l.slug === '7100-0000039456-is')
  assert.ok(lead)
  assert.equal(lead.entity, 'Infinite Solutions')
  assert.equal(lead.lens, 'consulting')
  assert.equal(lead.score, 75)
  assert.equal(lead.bucket, 'likely')
  assert.deepEqual(lead.products, [])
  assert.deepEqual(lead.reasons, ['title: enterprise platform', 'buyer we know: EDD'])
  assert.equal(lead.rulesVersion, 3)
  assert.equal(lead.provisional, true)
  assert.equal(lead.triage, 'new')
  assert.equal(lead.endDate, addDays(today(), 7))
  assert.equal(leadEventKey(lead), '7100-0000039456')

  // Every product-lens lead is exactly as it was, and reads as InfiniteAI/product.
  const after = (await listLeads()).filter(l => l.lens === 'product')
  assert.deepEqual(after.map(l => `${l.slug}:${l.triage}:${l.lastScored}`).sort(), before)
  assert.ok(after.every(l => l.entity === 'InfiniteAI'))
  assert.ok(!(await listLeads()).some(l => l.slug.startsWith('0840-') || l.slug.startsWith('7730-')))

  const log = execFileSync('git', ['-C', opsDir, 'log', '-1', '--format=%s%n%b'], { encoding: 'utf-8' })
  assert.match(log, /^leads: 1 new, 0 updated$/m)
  assert.match(log, /^7100-0000039456-is: new$/m)

  // The same sidecar again says nothing: --on-change stays silent.
  const again = await syncConsultingLeads((await readLatestSidecar())!.events, 'test')
  assert.equal(again.created + again.updated, 0)
})

test('a product-lens lead for the same event coexists with the -is lead', async () => {
  const out = await syncLeads([{ ...event('0000039456', addDays(today(), 7)), businessUnit: '7100' }], 'test')
  assert.equal(out.created + out.updated, 0)   // no rules file here: unlikely, never stored
  await seed('7100-0000039456', addDays(today(), 7))
  const pair = (await listLeads()).filter(l => leadEventKey(l) === '7100-0000039456')
  assert.deepEqual(pair.map(l => [l.slug, l.entity]).sort(), [
    ['7100-0000039456', 'InfiniteAI'], ['7100-0000039456-is', 'Infinite Solutions'],
  ])
})

test('an -is lead expires like any other, and a moved deadline rewrites it', async () => {
  const closed = {
    event_id: '0000039456', business_unit: '7100', name: 'EDD RFP 3475 for Salesforce M&O',
    end_date: addDays(today(), 21), rules_version: 3, lenses: { consulting: lens(75), product: lens(0) },
  }
  const moved = await syncConsultingLeads([closed], 'test')
  assert.equal(moved.updated, 1)
  assert.match(moved.reasons[0].why, /^deadline: /)
  assert.equal((await listLeads()).find(l => l.slug === '7100-0000039456-is')?.endDate, addDays(today(), 21))
  // A lead whose score falls under the line is left alone, never deleted.
  const dropped = await syncConsultingLeads([{ ...closed, lenses: { consulting: lens(15), product: lens(0) } }], 'test')
  assert.equal(dropped.created + dropped.updated, 0)
  assert.ok((await listLeads()).some(l => l.slug === '7100-0000039456-is'))
})
