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

/**
 * Bump when weights or rules below change. Stored on each scored lead so a rules
 * change can be detected and affected rows re-scored — pure CPU, no refetch.
 */
export const LEAD_RULES_VERSION = 1

export type ProductSlug = 'prr' | 'recruitment' | 'ad-hoc-reporting' | 'assistants' | 'procurement' | 'delivery-management' | 'platform'

export type LeadBucket = 'likely' | 'possible' | 'unlikely'

export interface ScoredReason {
  weight: number
  reason: string
  product?: ProductSlug
}

export interface LeadVerdict {
  score: number
  bucket: LeadBucket
  reasons: ScoredReason[]
  products: ProductSlug[]     // which of our products this could be sold into
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

// ── commodity codes ─────────────────────────────────────────────────────────
// Four digits minimum. Weighted for a company that SELLS SOFTWARE, which is the
// core divergence from the staffing lens.

const UNSPSC_WEIGHTS: Record<string, [number, string]> = {
  '4323': [55, 'software'],                      // our product category, their 35
  '8111': [50, 'computer services'],             // implementation, integration, hosting
  '8116': [45, 'IT service delivery'],           // managed/SaaS delivery
  '4322': [20, 'communications software/services'], // only via the software side; see exclusions
  '8010': [15, 'management consulting'],         // weak: an advisory wrapper may precede a buy
  '8013': [15, 'business administration services'],
}

// Named explicitly so a future widening of prefixes cannot quietly readmit them,
// and so the reason line can say WHY a technical-sounding bid was skipped.
const UNSPSC_EXCLUDED: Record<string, string> = {
  '4321': 'computer hardware — we sell no equipment',
  '3211': 'electronic components, not software',
  '8110': 'professional engineering, not software',
  '7215': 'trade construction and maintenance',
  '7210': 'building maintenance',
  '9212': 'physical security and guard services',
  // Deliberate: this is the OTHER lens's core business, not ours.
  '8011': 'temporary personnel — staff augmentation is a services sale, and that is the qual-table lens',
}

// ── product vocabulary ──────────────────────────────────────────────────────
// What an agency writes in a solicitation when it wants each of our products.
// Grouped by product so a lead can say "this is a Candor opportunity" rather
// than only "this is relevant", which is what makes the row actionable.

interface PhraseRule { weight: number; re: RegExp; reason: string; product: ProductSlug }

const PRODUCT_PHRASES: PhraseRule[] = [
  // ── Candor (prr): public records. The strongest vocabulary we have — agencies
  // solicit these by statute name and almost nothing else uses the words.
  { weight: 60, re: /\bCPRA\b|california public records act|public records act/i, reason: 'California Public Records Act', product: 'prr' },
  { weight: 60, re: /public records request|records request (management|system|tracking)/i, reason: 'public records request system', product: 'prr' },
  { weight: 50, re: /\bFOIA\b|freedom of information/i, reason: 'FOIA / freedom of information', product: 'prr' },
  { weight: 45, re: /\bredaction\b|redact\w*/i, reason: 'redaction', product: 'prr' },
  { weight: 35, re: /records (retention|management|disclosure)|legal hold/i, reason: 'records management', product: 'prr' },

  // ── GovHire (recruitment). "examination" is the California civil-service term
  // and is a much stronger signal here than the generic "hiring".
  { weight: 55, re: /applicant tracking|\bATS\b\b|recruitment (system|platform|software)/i, reason: 'applicant tracking / recruitment system', product: 'recruitment' },
  { weight: 50, re: /civil service exam|examination (services|administration|development)/i, reason: 'civil service examination', product: 'recruitment' },
  { weight: 45, re: /candidate (screening|evaluation)|interview (panel|scoring)/i, reason: 'candidate screening', product: 'recruitment' },
  { weight: 40, re: /\bNEOGOV\b|\bCalCareers\b|\bECOS\b/i, reason: 'incumbent hiring platform named', product: 'recruitment' },
  { weight: 30, re: /(hiring|recruit\w*) (process|modernization|services)/i, reason: 'hiring modernization', product: 'recruitment' },

  // ── Reporting (ad-hoc-reporting). Naming a legacy BI tool is the buying signal:
  // it usually means a migration is funded.
  { weight: 55, re: /business objects|crystal reports|\bcognos\b|\bmicrostrategy\b/i, reason: 'legacy BI incumbent named — migration signal', product: 'ad-hoc-reporting' },
  { weight: 50, re: /business intelligence|\bBI\b (platform|solution|tool)/i, reason: 'business intelligence platform', product: 'ad-hoc-reporting' },
  { weight: 45, re: /ad ?hoc report|self-?service report|reporting (platform|solution|system)/i, reason: 'ad hoc / self-service reporting', product: 'ad-hoc-reporting' },
  { weight: 40, re: /\bdashboard(s|ing)?\b|data visuali[sz]ation/i, reason: 'dashboards', product: 'ad-hoc-reporting' },
  { weight: 35, re: /data warehouse|\bETL\b|analytics platform/i, reason: 'data warehouse / analytics', product: 'ad-hoc-reporting' },
  { weight: 30, re: /\bTableau\b|\bPower ?BI\b|\bLooker\b/i, reason: 'modern BI tool named', product: 'ad-hoc-reporting' },

  // ── Steward (assistants). This is the San Jose RFP shape.
  { weight: 55, re: /chat ?bot|conversational (AI|agent)|virtual (assistant|agent)/i, reason: 'chatbot / virtual assistant', product: 'assistants' },
  { weight: 50, re: /generative (AI|artificial intelligence)|\bGenAI\b|\bLLM\b/i, reason: 'generative AI', product: 'assistants' },
  { weight: 40, re: /\bartificial intelligence\b|\bmachine learning\b/i, reason: 'artificial intelligence', product: 'platform' },
  { weight: 45, re: /knowledge (base|management) (system|platform)|self-?service portal/i, reason: 'knowledge base / self-service', product: 'assistants' },
  { weight: 35, re: /natural language (processing|search|query)|\bNLP\b/i, reason: 'natural language', product: 'assistants' },

  // ── Proc (procurement).
  { weight: 50, re: /\beProcurement\b|procurement (system|platform|modernization)/i, reason: 'procurement platform', product: 'procurement' },
  { weight: 45, re: /solicitation (management|development)|bid evaluation/i, reason: 'solicitation / bid evaluation', product: 'procurement' },
  { weight: 35, re: /vendor management (system|platform)|supplier portal/i, reason: 'vendor management', product: 'procurement' },

  // ── Milestone (delivery-management).
  { weight: 45, re: /contract (management|lifecycle) (system|software|platform)|\bCLM\b/i, reason: 'contract management system', product: 'delivery-management' },
  { weight: 35, re: /project portfolio management|\bPPM\b|deliverable tracking/i, reason: 'project portfolio / deliverables', product: 'delivery-management' },

  // ── Platform-wide. AI governance is the EO N-5-26 tailwind and maps to Steward's
  // Govern Hub, which is the differentiator the GTM playbook leads with.
  { weight: 45, re: /AI (governance|policy|oversight|risk management)|responsible AI/i, reason: 'AI governance', product: 'platform' },
  { weight: 35, re: /(case|workflow) management (system|platform)/i, reason: 'case/workflow management', product: 'platform' },
  { weight: 30, re: /\bSaaS\b|software as a service|cloud-?based (system|solution|platform)/i, reason: 'SaaS delivery', product: 'platform' },
  { weight: 25, re: /workflow automation|business process automation/i, reason: 'process automation', product: 'platform' },
  { weight: 20, re: /\bsoftware\b (solution|system|platform|license|subscription)/i, reason: 'software purchase', product: 'platform' },
]

// Somebody is buying THINGS or BODIES, not a product licence. Negative rather
// than disqualifying, because a software bid can mention equipment in passing and
// the commodity codes should still be able to outweigh it.
const TITLE_NEGATIVE: { weight: number; re: RegExp; reason: string }[] = [
  { weight: -45, re: /\bstaff augmentation\b|temporary (staffing|personnel)|\bcontractor placement\b/i, reason: 'staff augmentation, not a product sale' },
  { weight: -40, re: /\b(purchase|procurement) of\b|\bsupply (and delivery|of)\b/i, reason: 'a goods purchase' },
  { weight: -35, re: /\bequipment\b|\bhardware\b|\bappliance/i, reason: 'equipment rather than software' },
  { weight: -30, re: /\binstallation\b|\bfurnish and install\b|\breplacement of\b/i, reason: 'install or replace work' },
  { weight: -30, re: /\bvehicle|\bfuel\b|\bfood\b|\bfurniture\b|\buniform/i, reason: 'a commodity purchase' },
  { weight: -25, re: /\bconstruction\b|\broofing\b|\bpaving\b|\bjanitorial\b|\blandscap/i, reason: 'facilities work' },
  { weight: -25, re: /\bIV ?& ?V\b|independent verification|\bIPOC\b/i, reason: 'oversight services — the Infinite Solutions lens, not a product' },
]

// Not an opportunity at all, regardless of subject.
const DISQUALIFIERS: { re: RegExp; reason: string }[] = [
  { re: /intent to award/i, reason: 'an award notice, not an open opportunity' },
  { re: /notice of (public )?(meeting|hearing)/i, reason: 'a meeting notice, not a solicitation' },
  { re: /request for information/i, reason: 'an RFI — no award, tracked separately' },
]

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
export function scoreEvent(
  event: ScorableEvent,
  affinity: Map<string, { count: number; tier1: boolean }> = new Map(),
): LeadVerdict {
  const reasons: ScoredReason[] = []
  const products = new Set<ProductSlug>()

  // A row with no description AND no commodity codes was scored on the list view
  // alone. Marked provisional so the UI can offer enrichment rather than implying
  // the verdict is final.
  const provisional = !event.description && !(event.unspscCodes && event.unspscCodes.length)

  const haystack = [event.eventName, event.description ?? ''].join(' ')

  for (const d of DISQUALIFIERS) {
    if (d.re.test(event.eventName)) {
      return {
        score: 0, bucket: 'unlikely',
        reasons: [{ weight: 0, reason: d.reason }],
        products: [], provisional, rulesVersion: LEAD_RULES_VERSION,
      }
    }
  }

  let score = 0

  for (const code of event.unspscCodes ?? []) {
    const prefix = String(code).replace(/\D/g, '').slice(0, 4)
    if (prefix.length < 4) continue
    const excluded = UNSPSC_EXCLUDED[prefix]
    if (excluded) {
      score -= 30
      reasons.push({ weight: -30, reason: `commodity ${prefix}: ${excluded}` })
      continue
    }
    const hit = UNSPSC_WEIGHTS[prefix]
    if (hit) {
      score += hit[0]
      reasons.push({ weight: hit[0], reason: `commodity ${prefix}: ${hit[1]}` })
    }
  }

  // Only the highest-weight phrase per product counts, so a solicitation that
  // says "records request" five ways does not outscore one that genuinely spans
  // two products.
  const bestPerProduct = new Map<ProductSlug, PhraseRule>()
  for (const p of PRODUCT_PHRASES) {
    if (!p.re.test(haystack)) continue
    const cur = bestPerProduct.get(p.product)
    if (!cur || p.weight > cur.weight) bestPerProduct.set(p.product, p)
  }
  for (const p of Array.from(bestPerProduct.values())) {
    score += p.weight
    products.add(p.product)
    reasons.push({ weight: p.weight, reason: p.reason, product: p.product })
  }

  for (const n of TITLE_NEGATIVE) {
    if (!n.re.test(haystack)) continue
    score += n.weight
    reasons.push({ weight: n.weight, reason: n.reason })
  }

  // Affinity is applied last and cannot promote on its own (see doc above).
  const aff = affinityFor(event, affinity)
  const bucketBeforeAffinity = bucketFor(score)
  if (aff) {
    score += aff.weight
    reasons.push(aff)
  }
  let bucket = bucketFor(score)
  if (bucketBeforeAffinity === 'unlikely' && bucket !== 'unlikely') {
    bucket = 'unlikely'
    reasons.push({ weight: 0, reason: 'agency affinity alone cannot shortlist a lead' })
  }

  // A COMMODITY CODE MEANS "SOFTWARE-ISH", NOT "OUR SOFTWARE". Without a product
  // phrase we know an agency is buying technology but not that it is buying
  // anything we sell — "Salesforce M&O" carries 8111 and is somebody else's
  // maintenance contract. Codes and affinity can rank a lead; only product
  // vocabulary can shortlist one. Same shape as the affinity guard above.
  if (products.size === 0 && bucket === 'likely') {
    bucket = 'possible'
    reasons.push({ weight: 0, reason: 'technology buy with no product match — codes alone cannot shortlist' })
  }

  reasons.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))

  return {
    score: Math.max(0, score),
    bucket,
    reasons,
    products: Array.from(products),
    provisional,
    rulesVersion: LEAD_RULES_VERSION,
  }
}

/** Score a batch, reading the contact store once. Sorted best-first. */
export async function scoreEvents(events: ScorableEvent[]): Promise<(ScorableEvent & { verdict: LeadVerdict })[]> {
  const affinity = await getAgencyAffinity()
  return events
    .map(e => ({ ...e, verdict: scoreEvent(e, affinity) }))
    .sort((a, b) => b.verdict.score - a.verdict.score)
}
