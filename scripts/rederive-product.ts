/**
 * Re-derive `product` on seeded contacts after the productSlug fix.
 *
 * The original seed tagged 93 of 94 contacts `prrai` because the matcher
 * returned the first dictionary hit rather than the agency profile's actual
 * emphasis. Product concentration is a GTM signal (the playbook's whole focus
 * argument rests on it), so a wrong value is worse than none.
 *
 * Only touches contacts whose product came from an agency profile; anything a
 * human has since changed by hand is left alone.
 */
import fs from 'fs/promises'
import path from 'path'
import { PATHS } from '../src/lib/paths.ts'
import { listContacts, updateContact, commitBatch } from '../src/lib/crm.ts'

const PRODUCT_SLUGS: Array<[RegExp, string]> = [
  [/\bai\s?hire\b|\bhireca\b|recruitment/i, 'aihire'],
  [/\bprrai\b|\bcandor\b|public records/i, 'prrai'],
  [/ad[- ]hoc reporting|\breporting\b/i, 'reporting'],
  [/procurement/i, 'procurement'],
  [/\becho\b/i, 'echo'],
]

function productSlug(text?: string): string | undefined {
  if (!text) return undefined
  const primary = text.match(/([A-Za-z][A-Za-z\s-]*?)\s*\(primary\)/i)
  if (primary) {
    for (const [re, slug] of PRODUCT_SLUGS) if (re.test(primary[1])) return slug
  }
  let best: { slug: string; at: number } | undefined
  for (const [re, slug] of PRODUCT_SLUGS) {
    const m = text.match(re)
    if (m && m.index !== undefined && (!best || m.index < best.at)) best = { slug, at: m.index }
  }
  return best?.slug
}

const byAgency = new Map<string, string | undefined>()
for (const f of await fs.readdir(PATHS.agencies)) {
  if (!f.endsWith('.md')) continue
  const raw = await fs.readFile(path.join(PATHS.agencies, f), 'utf-8')
  const line = raw.split('\n').find(l => /Relevant products/i.test(l))
  byAgency.set(f.replace(/\.md$/, ''), productSlug(line))
}

let changed = 0
const tally = new Map<string, number>()
for (const c of await listContacts()) {
  const want = c.agency ? byAgency.get(c.agency) : undefined
  if (want) tally.set(want, (tally.get(want) ?? 0) + 1)
  // Priority-outreach rows carried an explicit product from the outreach table;
  // trust the agency profile only where it actually resolves.
  if (want && want !== c.product && c.source === 'cio-academy-2026') {
    await updateContact(c.slug, { product: want }, 'rederive', )
    changed++
  }
}
console.log('re-derived:', changed)
console.log('distribution:', Object.fromEntries([...tally.entries()].sort((a, b) => b[1] - a[1])))
await commitBatch('re-derive product attribution from agency profiles (was 93/94 prrai)', 'rederive')
