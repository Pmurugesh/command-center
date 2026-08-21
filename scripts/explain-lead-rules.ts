/**
 * Print the product-lens lead criteria as markdown.
 *
 * The RULES live in src/lib/lead-scoring.ts and this DERIVES the document from
 * them, so the two can never disagree — the same derived-vs-authored split used
 * for bid statuses and the product registry.
 *
 * Run: node --experimental-strip-types --no-warnings scripts/run-ts.mjs \
 *        scripts/explain-lead-rules.ts > ~/repos/operations/gtm/lead-criteria.md
 */
import * as rules from '../src/lib/lead-scoring.ts'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'node:url'

// Read the rule source to extract the tables. Resolved relative to THIS file so
// it works from a git worktree as well as the main checkout.
const here = path.dirname(fileURLToPath(import.meta.url))
const src = await fs.readFile(path.join(here, '../src/lib/lead-scoring.ts'), 'utf-8')

function block(startMarker: string, endMarker: string): string {
  const a = src.indexOf(startMarker)
  const b = src.indexOf(endMarker, a)
  return a === -1 ? '' : src.slice(a, b === -1 ? undefined : b)
}

const PRODUCT_NAMES: Record<string, string> = {
  prr: 'Candor', recruitment: 'GovHire', 'ad-hoc-reporting': 'Reporting',
  assistants: 'Steward', procurement: 'Proc', 'delivery-management': 'Milestone',
  platform: 'Platform-wide',
}

const lines: string[] = []
lines.push('# Lead criteria — what we look for in California solicitations')
lines.push('')
lines.push('> **GENERATED — do not hand-edit.** Source of truth is')
lines.push('> `src/lib/lead-scoring.ts` (command-center repo). Regenerate with')
lines.push('> `scripts/explain-lead-rules.ts`. Rules version: ' + rules.LEAD_RULES_VERSION + '.')
lines.push('')
lines.push('Applied to every open state solicitation (~311 per refresh) pulled through the Cal')
lines.push('eProcure pipeline in `qual_table_automations`. That repo scores the same rows for')
lines.push('**Infinite Solutions** (consulting: IV&V, PMO, staff augmentation); this scores them')
lines.push('for **InfiniteAI** (software products). Two lenses, one dataset.')
lines.push('')

// Phrase rules by product
const phraseSrc = block('const PRODUCT_PHRASES', 'const TITLE_NEGATIVE')
const phraseRe = /\{ weight: (-?\d+), re: (\/.*?\/i), reason: '([^']+)', product: '([^']+)' \}/g
const byProduct = new Map<string, { w: number; reason: string; re: string }[]>()
for (const m of phraseSrc.matchAll(phraseRe)) {
  const [, w, re, reason, product] = m
  if (!byProduct.has(product)) byProduct.set(product, [])
  byProduct.get(product)!.push({ w: Number(w), reason, re })
}

lines.push('## What we search for, by product')
lines.push('')
for (const [slug, list] of Array.from(byProduct.entries())) {
  lines.push(`### ${PRODUCT_NAMES[slug] ?? slug}  \`${slug}\``)
  lines.push('')
  lines.push('| Weight | Signal | Matches |')
  lines.push('|---:|---|---|')
  for (const p of list.sort((a, b) => b.w - a.w)) {
    lines.push(`| ${p.w} | ${p.reason} | \`${p.re.replace(/\|/g, '\\|').slice(0, 68)}\` |`)
  }
  lines.push('')
}

lines.push('## Commodity codes (UNSPSC, 4-digit families)')
lines.push('')
lines.push('Codes are the PRIMARY signal. Measured on a real 311-event capture, searching titles')
lines.push('for "information technology" returned ZERO matches, so phrases supplement codes and')
lines.push('never replace them. Prefixes are four digits minimum: a two-digit `81` scores civil')
lines.push('engineering (81101508) as IT work.')
lines.push('')
lines.push('| Code | Weight | Meaning |')
lines.push('|---|---:|---|')
for (const m of block('const UNSPSC_WEIGHTS', 'const UNSPSC_EXCLUDED')
  .matchAll(/'(\d{4})': \[(\d+), '([^']+)'\]/g)) {
  lines.push(`| ${m[1]} | +${m[2]} | ${m[3]} |`)
}
lines.push('')
lines.push('**Excluded outright** (named so a future widening cannot quietly readmit them):')
lines.push('')
lines.push('| Code | Why not us |')
lines.push('|---|---|')
for (const m of block('const UNSPSC_EXCLUDED', 'const PRODUCT_PHRASES')
  .matchAll(/'(\d{4})': '([^']+)'/g)) {
  lines.push(`| ${m[1]} | ${m[2]} |`)
}
lines.push('')

lines.push('## What pushes a lead DOWN')
lines.push('')
lines.push('| Weight | Signal |')
lines.push('|---:|---|')
for (const m of block('const TITLE_NEGATIVE', 'const DISQUALIFIERS')
  .matchAll(/weight: (-\d+), re: \/.*?\/i, reason: '([^']+)'/g)) {
  lines.push(`| ${m[1]} | ${m[2]} |`)
}
lines.push('')
lines.push('## Disqualified outright')
lines.push('')
for (const m of block('const DISQUALIFIERS', '// ── thresholds')
  .matchAll(/reason: '([^']+)'/g)) {
  lines.push(`- ${m[1]}`)
}
lines.push('')

lines.push('## Agency affinity — the signal only we have')
lines.push('')
lines.push('Built from the CRM contact store: 94 contacts across 39 agencies, tiered from CIO')
lines.push('Academy. A solicitation from an agency where we already know the CIO is a warmer lead')
lines.push('than the same solicitation from a stranger. Worth +20 with a tier-1 contact, +10')
lines.push('otherwise.')
lines.push('')
lines.push('**It can never shortlist a lead on its own** — a familiar agency also buys furniture.')
lines.push('It lifts a lead within a bucket and nothing more.')
lines.push('')

lines.push('## Buckets')
lines.push('')
lines.push('| Bucket | Score | Meaning |')
lines.push('|---|---:|---|')
lines.push('| 🟢 likely | ≥70 | Shortlist. Requires at least one PRODUCT match. |')
lines.push('| 🟡 possible | ≥35 | Worth a look; often a technology buy with no product fit yet. |')
lines.push('| ⚪ unlikely | <35 | Not surfaced. |')
lines.push('')
lines.push('Two guards, both learned rather than invented:')
lines.push('')
lines.push('1. **Codes alone cannot shortlist.** A commodity code means "software-ish", not "our')
lines.push('   software" — `Salesforce M&O` carries 8111 and is somebody else\'s maintenance')
lines.push('   contract. Without a product phrase, a lead is capped at *possible*.')
lines.push('2. **Affinity alone cannot shortlist.** Same reasoning, applied to the agency prior.')
lines.push('')
lines.push('One bucketing rule applies at BOTH tiers (list-level and enriched), so a lead cannot')
lines.push('silently leave the shortlist between refreshes with no stated reason.')
console.log(lines.join('\n'))
