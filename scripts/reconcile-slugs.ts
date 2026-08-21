/**
 * Adopt the platform's canonical module slugs across operations.
 *
 * Two repos independently declared their slug "stable": the platform uses
 * prr / recruitment / ad-hoc-reporting (load-bearing in license gating, the
 * module registry, and DB rows), operations uses prrai / aihire / reporting
 * (tags on docs and a CRM seeded today). Platform slugs cannot move cheaply;
 * operations slugs are nearly free. So operations adopts the platform's, and
 * the old values become aliases for reading historical docs.
 *
 * Run: node --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/reconcile-slugs.ts
 */
import { listContacts, updateContact, commitBatch } from '../src/lib/crm.ts'

// operations slug -> platform canonical slug
export const SLUG_MAP: Record<string, string> = {
  prrai: 'prr',
  aihire: 'recruitment',
  reporting: 'ad-hoc-reporting',
  procurement: 'procurement',   // already aligned
  // echo has no platform module (backend TBD, partner-based) — left as-is and
  // flagged by the drift report rather than silently mapped to something real.
}

const contacts = await listContacts()
let changed = 0
const tally: Record<string, number> = {}

for (const c of contacts) {
  if (!c.product) continue
  const want = SLUG_MAP[c.product]
  tally[want ?? c.product] = (tally[want ?? c.product] ?? 0) + 1
  if (want && want !== c.product) {
    await updateContact(c.slug, { product: want }, 'slug-reconcile', false)
    changed++
  }
}

console.log(`contacts re-slugged: ${changed}`)
console.log('distribution (canonical):', tally)

if (changed) {
  await commitBatch(
    'adopt platform canonical product slugs (prrai->prr, aihire->recruitment, reporting->ad-hoc-reporting)',
    'slug-reconcile')
}
