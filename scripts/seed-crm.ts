/**
 * One-time (idempotent) seed of the CRM contact store.
 *
 * Sources, in precedence order:
 *   1. intelligence/priority-outreach.md   — 8 hand-picked targets with owner + action
 *   2. intelligence/agencies/*.md          — 94 CIO Academy contacts, tiered, with
 *                                            per-agency product fit and next step
 * Deduped by lowercased email. Never overwrites an existing contact file, so
 * re-running after real CRM use is safe.
 *
 * Seeding decisions worth knowing:
 *   - last_touched = 2026-05-25 (CIO Academy triage date). That is genuinely the
 *     last contact event, and it makes the "days cold" counters true rather than
 *     flattering.
 *   - Priority-outreach targets get next_action_due = 2026-05-28, the date their
 *     action was set. They therefore seed as ~3 months OVERDUE, which is the
 *     accurate state and the whole point of building this.
 *   - Only the 8 priority targets get a next_action. The other 86 are researched
 *     LEADS, not commitments — giving them all an action would invent a 94-item
 *     to-do list out of thin air. They carry the agency's recommended next step
 *     as notes and surface as "going cold", which is their true state.
 *   - A priority action that requires a product one-pager seeds as `blocked`,
 *     because we verified no one-pagers exist in either repo. The block is
 *     recorded in the log with its basis rather than asserted silently. This is
 *     scoped to the 8 owned actions; the agency-level "recommended next step" is
 *     a suggestion for the agency, not a per-contact commitment, and inheriting
 *     it would block ~60 contacts on an artifact nobody promised them.
 *
 * Run:  node --experimental-strip-types --no-warnings scripts/seed-crm.ts [--dry]
 */
import fs from 'fs/promises'
import path from 'path'
import { PATHS, OUTREACH_PATH } from '../src/lib/paths.ts'
import { commitBatch, createContact, getContact, listContacts, slugify } from '../src/lib/crm.ts'

const DRY = process.argv.includes('--dry')

const CIO_ACADEMY_DATE = '2026-05-25'   // followup plan generation date
const OUTREACH_DATE = '2026-05-28'      // priority-outreach.md last edit

// Products whose collateral does not exist (verified 2026-08-21 across both
// repos: zero one-pagers, datasheets, or case studies). An action that requires
// one cannot proceed, so it seeds blocked.
const MISSING_COLLATERAL = /one-pager|onepager|one pager/i

// Operations-side product slugs. NOTE: these differ from the platform's module
// slugs (prr / recruitment / ad-hoc-reporting) — see the drift finding in
// tasks/todo.md M2.5. Kept as-is here so this seeder does not unilaterally
// re-vocabulary the CRM; reconciliation is a tracked decision.
const PRODUCT_SLUGS: Array<[RegExp, string]> = [
  [/\bai\s?hire\b|\bhireca\b|recruitment/i, 'aihire'],
  [/\bprrai\b|\bcandor\b|public records/i, 'prrai'],
  [/ad[- ]hoc reporting|\breporting\b/i, 'reporting'],
  [/procurement/i, 'procurement'],
  [/\becho\b/i, 'echo'],
]

/**
 * Pick the PRIMARY product for an agency.
 *
 * The naive version (first match in dictionary order) tagged 93 of 94 contacts
 * `prrai`, because PRRAI is named in almost every agency profile as the
 * secondary fit and it happened to be checked first. Product concentration is a
 * real GTM signal, so it has to reflect the profile's actual emphasis:
 *   1. an explicit "(primary)" marker wins
 *   2. otherwise the product mentioned EARLIEST in the line wins, since these
 *      lines are written best-fit-first
 */
function productSlug(text?: string): string | undefined {
  if (!text) return undefined

  // "**AIHire (primary)** -- ..." — the profile already told us the answer.
  const primary = text.match(/([A-Za-z][A-Za-z\s-]*?)\s*\(primary\)/i)
  if (primary) {
    for (const [re, slug] of PRODUCT_SLUGS) if (re.test(primary[1])) return slug
  }

  let best: { slug: string; at: number } | undefined
  for (const [re, slug] of PRODUCT_SLUGS) {
    const m = text.match(re)
    if (m && m.index !== undefined && (!best || m.index < best.at)) {
      best = { slug, at: m.index }
    }
  }
  return best?.slug
}

interface Seed {
  name: string
  title?: string
  email?: string
  phone?: string
  agency?: string
  agencyName?: string
  product?: string
  owner?: string
  tier?: string
  nextAction?: string
  nextActionDue?: string
  suggestion?: string     // agency-level recommended play (context, not an owed action)
  source: string
  origin: string          // human-readable provenance for the seeded log entry
}

/** Split a markdown table row into trimmed cells. */
function cells(line: string): string[] {
  return line.split('|').map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1)
}

function stripMd(s: string): string {
  return s.replace(/\*\*/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim()
}

async function readOutreach(): Promise<Seed[]> {
  let raw: string
  try { raw = await fs.readFile(OUTREACH_PATH, 'utf-8') } catch { return [] }

  const out: Seed[] = []
  for (const line of raw.split('\n')) {
    if (!line.startsWith('|') || line.includes('---') || /\|\s*Priority\s*\|/.test(line)) continue
    const c = cells(line)
    if (c.length < 8 || !c[1]) continue
    const [, contact, title, agency, product, owner, action] = c
    out.push({
      name: stripMd(contact),
      title: stripMd(title) || undefined,
      agencyName: stripMd(agency) || undefined,
      agency: agency ? slugify(stripMd(agency)) : undefined,
      product: productSlug(product),
      owner: stripMd(owner) || undefined,
      tier: 'T1',
      nextAction: stripMd(action) || undefined,
      nextActionDue: OUTREACH_DATE,
      source: 'priority-outreach',
      origin: 'priority outreach list',
    })
  }
  return out
}

async function readAgencies(): Promise<Seed[]> {
  let files: string[]
  try {
    files = (await fs.readdir(PATHS.agencies)).filter(f => f.endsWith('.md') && !f.startsWith('.'))
  } catch { return [] }

  const out: Seed[] = []
  for (const file of files) {
    const slug = file.replace(/\.md$/, '')
    const raw = await fs.readFile(path.join(PATHS.agencies, file), 'utf-8')
    const lines = raw.split('\n')

    const agencyName = (lines.find(l => l.startsWith('# ')) ?? `# ${slug}`).slice(2).trim()

    // Agency-level context applies to every contact in the file.
    const productLine = lines.find(l => /Relevant products/i.test(l))
    const nextStepLine = lines.find(l => /Recommended next step/i.test(l))
    // Context, not a commitment: recorded as notes so the operator sees the
    // suggested play without the CRM claiming it is an owed action.
    const suggestion = nextStepLine
      ? stripMd(nextStepLine.replace(/^-\s*Recommended next step:\s*/i, ''))
      : undefined
    const product = productSlug(productLine)

    let inContacts = false
    for (const line of lines) {
      if (line.startsWith('## ')) { inContacts = /contacts/i.test(line); continue }
      if (!inContacts || !line.startsWith('|')) continue
      if (line.includes('---') || /\|\s*Name\s*\|/i.test(line)) continue

      const c = cells(line)
      if (c.length < 3) continue
      const [name, title, email, phone, scannedBy, tier] = c
      const cleanEmail = stripMd(email ?? '')
      if (!name || !cleanEmail.includes('@')) continue

      out.push({
        name: stripMd(name),
        title: stripMd(title ?? '') || undefined,
        email: cleanEmail.toLowerCase(),
        phone: stripMd(phone ?? '') || undefined,
        agency: slug,
        agencyName,
        product,
        owner: stripMd(scannedBy ?? '') || undefined,
        tier: stripMd(tier ?? '') || undefined,
        suggestion,
        source: 'cio-academy-2026',
        origin: `CIO Academy 2026 badge scan, ${agencyName}`,
      })
    }
  }
  return out
}

/** Merge b into a, preferring existing non-empty values on a. */
function enrich(a: Seed, b: Seed): Seed {
  const merged = { ...b, ...a } as Seed
  for (const k of Object.keys(b) as (keyof Seed)[]) {
    if (!merged[k] && b[k]) (merged as unknown as Record<string, unknown>)[k] = b[k]
  }
  return merged
}

async function main() {
  const outreach = await readOutreach()
  const agencies = await readAgencies()
  console.log(`sources: ${outreach.length} priority-outreach, ${agencies.length} agency contacts`)

  // Dedupe. Priority-outreach wins on conflict (it has owner + explicit action),
  // but is enriched with the agency record's email/phone/tier, which it lacks.
  const byKey = new Map<string, Seed>()
  const keyOf = (s: Seed) => (s.email?.toLowerCase() ?? `name:${slugify(s.name)}`)

  for (const s of agencies) byKey.set(keyOf(s), s)
  for (const s of outreach) {
    // Priority-outreach rows carry no email, so match on name against agency records.
    const existing = Array.from(byKey.values()).find(e => slugify(e.name) === slugify(s.name))
    if (existing) byKey.set(keyOf(existing), enrich(s, existing))
    else byKey.set(keyOf(s), s)
  }

  const seeds = Array.from(byKey.values())
  console.log(`deduped: ${seeds.length} unique contacts`)

  const existingBefore = await listContacts()
  const existingNames = new Set(existingBefore.map(c => slugify(c.name)))

  let created = 0, skipped = 0, blocked = 0
  for (const s of seeds) {
    if (existingNames.has(slugify(s.name)) || await getContact(slugify(s.name))) { skipped++; continue }

    const isBlocked = s.source === 'priority-outreach'
      && Boolean(s.nextAction && MISSING_COLLATERAL.test(s.nextAction))
    const logText = isBlocked
      ? `Seeded from ${s.origin}. Action requires a product one-pager; none exists in either repo (verified 2026-08-21), so this is blocked, not merely late.`
      : `Seeded from ${s.origin}.`

    if (DRY) {
      console.log(`  + ${s.name} (${s.agencyName ?? '?'})${isBlocked ? '  [BLOCKED]' : ''}${s.nextActionDue ? `  due ${s.nextActionDue}` : '  [lead]'}`)
      created++; if (isBlocked) blocked++
      continue
    }

    await createContact({
      ...s,
      stage: 'identified',
      status: isBlocked ? 'blocked' : 'active',
      blockedOn: isBlocked ? 'product one-pager does not exist' : undefined,
      lastTouched: s.source === 'priority-outreach' ? OUTREACH_DATE : CIO_ACADEMY_DATE,
      created: CIO_ACADEMY_DATE,
      notes: s.suggestion ? `Suggested play (from the agency profile): ${s.suggestion}` : '',
      log: [{ date: CIO_ACADEMY_DATE, text: logText, via: 'seed' }],
    }, 'seed', false)   // batch: one commit at the end, not 94

    created++; if (isBlocked) blocked++
  }

  if (!DRY && created > 0) {
    await commitBatch(
      `seed ${created} contacts from priority-outreach + CIO Academy agency profiles`,
      'seed')
  }
  console.log(`\n${DRY ? '[dry run] would create' : 'created'}: ${created}  (blocked: ${blocked})   skipped existing: ${skipped}`)
}

main().catch(e => { console.error(e); process.exit(1) })
