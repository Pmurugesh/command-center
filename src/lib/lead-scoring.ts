/**
 * The PRODUCT lens: scoring a California solicitation for whether InfiniteAI
 * could sell a product into it.
 *
 * WHY THIS EXISTS SEPARATELY. The Cal eProcure pipeline in
 * `Pmurugesh/qual_table_automations` already fetches, parses, and stores every
 * open state solicitation (~311 per refresh). Its `eprocure_relevance.py` scores
 * them for INFINITE SOLUTIONS — a consulting and advisory firm selling IV&V,
 * PMO, assessments, and staff augmentation. This module scores the SAME rows for
 * INFINITEAI — a software company selling Candor, GovHire, Reporting, Steward,
 * Proc, and Milestone.
 *
 * Two lenses over one dataset, not two scrapers. A solicitation can legitimately
 * score on both (an agency buying a records system AND needing people to run it),
 * which two separate pipelines would never notice.
 *
 * THE INVERSION THAT MATTERS: the staffing lens weights `4323` (software) at 35
 * because it advises on software it does not sell. We sell software, so `4323` is
 * our strongest code. Symmetrically, `8011` (temporary personnel) is their
 * bread-and-butter and an explicit EXCLUSION here: staff augmentation is not a
 * product sale, and pretending otherwise would fill this shortlist with their work.
 *
 * RULES INHERITED FROM THEIR MEASURED EXPERIENCE, not re-derived:
 *   1. Commodity-code prefixes are FOUR digits minimum. A two-digit "81" scores
 *      civil engineering (81101508) as IT work.
 *   2. Titles are unreliable alone. Measured on a real 311-event capture,
 *      searching titles for "information technology" returned ZERO. Codes are
 *      primary; phrases supplement, never replace.
 *   3. One bucketing rule at both tiers, so a row cannot silently leave the
 *      shortlist between a list-level score and an enriched score.
 */
import { listContacts } from './crm'
import { PATHS } from './paths'

/**
 * Bump when weights or rules below change. Stored on each scored lead so a rules
 * change can be detected and affected rows re-scored — pure CPU, no refetch.
 */
/** Fallback only; the authored file's rules_version wins. */
export const LEAD_RULES_VERSION = 2

export type ProductSlug = string   // slugs come from the authored rules file

export type LeadBucket = 'likely' | 'possible' | 'unlikely'

export interface ScoredReason {
  weight: number
  reason: string
  product?: ProductSlug
  tier?: Tier
}

export interface LeadVerdict {
  score: number
  bucket: LeadBucket
  reasons: ScoredReason[]
  products: ProductSlug[]     // which of our products this could be sold into
  tiers: Tier[]               // have / adjacent / could-build
  provisional: boolean        // true when scored without description/commodity codes
  rulesVersion: number
}

export interface ScorableEvent {
  eventName: string
  departmentName?: string
  businessUnit?: string
  description?: string
  unspscCodes?: string[]
  eventType?: string
  endDate?: string
}

// ── authored rules ──────────────────────────────────────────────────────────
// The WEIGHTS AND PHRASES are business judgment and live in
// `operations/gtm/lead-rules.md`, which Pavan edits. Only the ENGINE is here:
// the 4-digit prefix rule, the two shortlist guards, and the bucketing math,
// all learned from measurement rather than preference.
//
// Falls back to an empty ruleset rather than throwing, so a malformed edit
// degrades to "nothing shortlisted" instead of breaking the dashboard — and the
// health panel shows it.

export type Tier = 'have' | 'adjacent' | 'could-build'

interface Signal { weight: number; label: string; phrases: string[] }
interface ProductRule { slug: string; name: string; tier: Tier; note?: string; signals: Signal[] }

interface RuleSet {
  rulesVersion: number
  codeWeights: Record<string, [number, string]>
  excludeCodes: Record<string, string>
  negatives: { weight: number; label: string; phrases: string[] }[]
  disqualifiers: { label: string; phrases: string[] }[]
  products: ProductRule[]
}

const EMPTY: RuleSet = {
  rulesVersion: 0, codeWeights: {}, excludeCodes: {},
  negatives: [], disqualifiers: [], products: [],
}

let cached: RuleSet | null = null

/** Word-boundary, case-insensitive match so authors write phrases, never regex. */
function phraseHit(haystack: string, phrases: string[]): boolean {
  const lower = haystack.toLowerCase()
  return phrases.some(p => {
    const needle = p.toLowerCase().trim()
    if (!needle) return false
    const i = lower.indexOf(needle)
    if (i === -1) return false
    const before = i === 0 ? ' ' : lower[i - 1]
    const after = i + needle.length >= lower.length ? ' ' : lower[i + needle.length]
    return !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)
  })
}

export async function loadRules(force = false): Promise<RuleSet> {
  if (cached && !force) return cached
  try {
    const fs = await import('fs/promises')
    const path = await import('path')
    const matter = (await import('gray-matter')).default
    const raw = await fs.readFile(path.join(PATHS.operationsRoot, 'gtm/lead-rules.md'), 'utf-8')
    const d = matter(raw).data as Record<string, unknown>

    const triple = (rows: unknown): { weight: number; label: string; phrases: string[] }[] =>
      Array.isArray(rows)
        ? rows.map(r => Array.isArray(r)
            ? { weight: Number(r[0]), label: String(r[1]), phrases: (r[2] as string[]) ?? [] }
            : { weight: 0, label: '', phrases: [] }).filter(x => x.label)
        : []

    cached = {
      rulesVersion: Number(d.rules_version ?? 0),
      codeWeights: (d.code_weights as RuleSet['codeWeights']) ?? {},
      excludeCodes: (d.exclude_codes as Record<string, string>) ?? {},
      negatives: triple(d.negatives),
      disqualifiers: Array.isArray(d.disqualifiers)
        ? (d.disqualifiers as unknown[]).map(r => Array.isArray(r)
            ? { label: String(r[0]), phrases: (r[1] as string[]) ?? [] }
            : { label: '', phrases: [] }).filter(x => x.label)
        : [],
      products: Array.isArray(d.products)
        ? (d.products as Record<string, unknown>[]).map(pr => ({
            slug: String(pr.slug), name: String(pr.name),
            tier: (pr.tier ?? 'have') as Tier,
            note: pr.note ? String(pr.note) : undefined,
            signals: triple(pr.signals).map(s => ({ weight: s.weight, label: s.label, phrases: s.phrases })),
          }))
        : [],
    }
    return cached
  } catch {
    cached = EMPTY
    return cached
  }
}

// ── thresholds ──────────────────────────────────────────────────────────────
// One bucketing rule at both tiers (inherited lesson 3): a provisional list-level
// score and an enriched score go through the SAME thresholds, so a row cannot
// silently leave the shortlist between refreshes.
const LIKELY_AT = 70
const POSSIBLE_AT = 35

function bucketFor(score: number): LeadBucket {
  if (score >= LIKELY_AT) return 'likely'
  if (score >= POSSIBLE_AT) return 'possible'
  return 'unlikely'
}

// ── department affinity ─────────────────────────────────────────────────────

/**
 * Agencies where we already know someone, built from the CRM contact store.
 *
 * This is the signal the staffing lens structurally cannot have: 94 contacts
 * across 39 agencies, tiered from CIO Academy. A solicitation from an agency
 * where we know the CIO is a materially warmer lead than the same solicitation
 * from a stranger.
 *
 * Deliberately WEAK, for the same reason their department prior is: a familiar
 * agency also buys furniture. It lifts a lead within a bucket; it must never
 * place one on the shortlist by itself. Enforced in score(), not by weight.
 */
export async function getAgencyAffinity(): Promise<Map<string, { count: number; tier1: boolean }>> {
  const affinity = new Map<string, { count: number; tier1: boolean }>()
  try {
    for (const c of await listContacts()) {
      const key = (c.agencyName ?? c.agency ?? '').toLowerCase().trim()
      if (!key) continue
      const cur = affinity.get(key) ?? { count: 0, tier1: false }
      cur.count += 1
      if ((c.tier ?? '').toUpperCase() === 'T1') cur.tier1 = true
      affinity.set(key, cur)
    }
  } catch { /* no store yet — affinity is optional by design */ }
  return affinity
}

function affinityFor(
  event: ScorableEvent,
  affinity: Map<string, { count: number; tier1: boolean }>,
): ScoredReason | null {
  const dept = (event.departmentName ?? '').toLowerCase().trim()
  if (!dept) return null
  for (const [known, info] of Array.from(affinity.entries())) {
    // Substring either way: "CalHR" vs "CA Dept of Human Resources (CalHR)".
    if (!known || (!dept.includes(known) && !known.includes(dept))) continue
    if (known.length < 4) continue      // avoid absurd short-token matches
    return info.tier1
      ? { weight: 20, reason: `known agency with a tier-1 contact (${info.count} contacts)` }
      : { weight: 10, reason: `known agency (${info.count} contacts)` }
  }
  return null
}

// ── scoring ─────────────────────────────────────────────────────────────────

/**
 * Score one event. `affinity` is passed in rather than fetched so a whole refresh
 * reads the contact store once instead of per row.
 */
export async function scoreEvent(
  event: ScorableEvent,
  affinity: Map<string, { count: number; tier1: boolean }> = new Map(),
  rules?: RuleSet,
): Promise<LeadVerdict> {
  const R = rules ?? await loadRules()
  const reasons: ScoredReason[] = []
  const products = new Set<string>()
  const tiers = new Set<Tier>()

  const provisional = !event.description && !(event.unspscCodes && event.unspscCodes.length)
  const haystack = [event.eventName, event.description ?? ''].join(' ')

  for (const d of R.disqualifiers) {
    if (phraseHit(event.eventName, d.phrases)) {
      return {
        score: 0, bucket: 'unlikely', reasons: [{ weight: 0, reason: d.label }],
        products: [], tiers: [], provisional, rulesVersion: R.rulesVersion,
      }
    }
  }

  let score = 0

  for (const code of event.unspscCodes ?? []) {
    const prefix = String(code).replace(/\D/g, '').slice(0, 4)
    if (prefix.length < 4) continue
    const excluded = R.excludeCodes[prefix]
    if (excluded) {
      score -= 30
      reasons.push({ weight: -30, reason: `commodity ${prefix}: ${excluded}` })
      continue
    }
    const hit = R.codeWeights[prefix]
    if (hit) {
      score += hit[0]
      reasons.push({ weight: hit[0], reason: `commodity ${prefix}: ${hit[1]}` })
    }
  }

  // Best signal per product only, so a bid that says "records request" five ways
  // does not outscore one that genuinely spans two products.
  for (const p of R.products) {
    let best: Signal | null = null
    for (const s of p.signals) {
      if (!phraseHit(haystack, s.phrases)) continue
      if (!best || s.weight > best.weight) best = s
    }
    if (!best) continue
    // could-build matches are MARKET EVIDENCE, not bid signals: they contribute a
    // fraction so they surface without competing with shippable work.
    const factor = p.tier === 'could-build' ? 0.4 : p.tier === 'adjacent' ? 0.8 : 1
    const weighted = Math.round(best.weight * factor)
    score += weighted
    products.add(p.slug)
    tiers.add(p.tier)
    reasons.push({
      weight: weighted,
      reason: p.tier === 'have' ? best.label : `${best.label} (${p.name}, ${p.tier})`,
      product: p.slug,
      tier: p.tier,
    })
  }

  for (const n of R.negatives) {
    if (!phraseHit(haystack, n.phrases)) continue
    score += n.weight
    reasons.push({ weight: n.weight, reason: n.label })
  }

  const aff = affinityFor(event, affinity)
  const bucketBeforeAffinity = bucketFor(score)
  if (aff) { score += aff.weight; reasons.push(aff) }
  let bucket = bucketFor(score)
  if (bucketBeforeAffinity === 'unlikely' && bucket !== 'unlikely') {
    bucket = 'unlikely'
    reasons.push({ weight: 0, reason: 'agency affinity alone cannot shortlist a lead' })
  }

  // A commodity code means "software-ish", not "our software".
  const shippable = Array.from(tiers).some(t => t === 'have' || t === 'adjacent')
  if (!products.size && bucket === 'likely') {
    bucket = 'possible'
    reasons.push({ weight: 0, reason: 'technology buy with no product match — codes alone cannot shortlist' })
  }
  // Nothing we ship matched: this is market evidence for the roadmap, not a bid.
  // The playbook's own qualification rule, and the mistake that lost ITN-37485.
  if (products.size && !shippable && bucket === 'likely') {
    bucket = 'possible'
    reasons.push({ weight: 0, reason: 'could-build only — market evidence for the roadmap, not a bid' })
  }

  reasons.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))

  return {
    score: Math.max(0, score), bucket, reasons,
    products: Array.from(products), tiers: Array.from(tiers),
    provisional, rulesVersion: R.rulesVersion,
  }
}

/** Score a batch, reading the contact store once. Sorted best-first. */
export async function scoreEvents(events: ScorableEvent[]): Promise<(ScorableEvent & { verdict: LeadVerdict })[]> {
  const [affinity, rules] = await Promise.all([getAgencyAffinity(), loadRules()])
  const scored = await Promise.all(
    events.map(async e => ({ ...e, verdict: await scoreEvent(e, affinity, rules) })))
  return scored.sort((a, b) => b.verdict.score - a.verdict.score)
}
