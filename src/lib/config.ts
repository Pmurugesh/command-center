import {
  Calendar,
  FileText,
  NotebookPen,
  Shield,
  Settings,
  Clock,
  Building2,
  Handshake,
  TrendingUp,
  DollarSign,
  PenTool,
  Bot,
  Inbox,
  Send,
  Map,
  type LucideIcon,
} from 'lucide-react'

// Polling intervals (ms)
export const POLLING = {
  system: 30_000,      // 30s for system status
  cron: 30_000,        // 30s for cron jobs
  bids: 300_000,       // 5min for bid data
  reports: 300_000,    // 5min for scan reports
  intel: 300_000,      // 5min for intel
} as const

// Bid status workflow
export const BID_STATUSES = [
  'Discovered',
  'Analyzing',
  'Draft Ready',
  'Under Review',
  'Submitted',
  'Won',
  'Lost',
  'No-Bid',
] as const

export type BidStatus = typeof BID_STATUSES[number]

// Coerce arbitrary case/whitespace into a canonical BidStatus (or undefined if no match)
export function normalizeBidStatus(input: unknown): BidStatus | undefined {
  if (typeof input !== 'string') return undefined
  const target = input.trim().toLowerCase()
  for (const s of BID_STATUSES) {
    if (s.toLowerCase() === target) return s
  }
  return undefined
}

// Entity options
export const ENTITIES = ['Infinite Solutions', 'NovaEra', 'InfiniteAI'] as const
export type Entity = typeof ENTITIES[number]

// Tab ordering for bid detail files
export const BID_TAB_ORDER = [
  'inventory',
  'requirements',
  'gap-analysis',
  'custom-build-analysis',
  'response-strategy',
  'implementation-roadmap',
  'architecture-decisions',
  'response-draft',
  'response-questions',
  'response-compliance-matrix',
  'response-action-items',
  'submission-checklist',
  'delta-log',
] as const

// Navigation config
export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  section: string
}

export interface NavSection {
  label: string
  items: NavItem[]
  collapsedByDefault?: boolean
}

// Sidebar IA — organized by *urgency*, not function.
// "Now" is the daily home. "Workforce" elevates Agents to peer of Bids — agents are leverage,
// not a system detail. "Intel" groups reading views that are outputs of agents (alerts + reports).
// "System" stays at the bottom as a click-when-broken section.
//
// Library is intentionally NOT in the sidebar: it's only useful from within a bid response,
// where it'll live as a contextual tab. Reachable via /library directly until then.
// Sidebar IA — one section per hat. "Now" is the daily home; "Sell" is the
// founder's revenue surface (Channels absorbed Partnerships); "Machine" is
// everything you click when something needs tending, not daily — agents, cron,
// codebase scans, settings. Codebase Health deliberately lives there: the GTM
// diagnosis is stop-shipping-features, and a nav that showcases scan reports
// daily invites exactly the wrong work.
// /intel and /gtm stay routable but out of the nav (the /library precedent):
// they're deep-link targets from the Clock and Today's Moves.
export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Now',
    items: [
      { href: '/', label: 'Today', icon: Calendar, section: 'Now' },
      { href: '/intake', label: 'Intake', icon: Inbox, section: 'Now' },
    ],
  },
  {
    label: 'Sell',
    items: [
      { href: '/bids', label: 'Bids', icon: FileText, section: 'Sell' },
      { href: '/agencies', label: 'Agencies', icon: Building2, section: 'Sell' },
      { href: '/channels', label: 'Channels', icon: Handshake, section: 'Sell' },
      { href: '/meetings', label: 'Meetings', icon: NotebookPen, section: 'Sell' },
      { href: '/outreach', label: 'Outreach', icon: Send, section: 'Sell' },
      { href: '/content', label: 'Content', icon: PenTool, section: 'Sell' },
    ],
  },
  {
    label: 'Build',
    items: [
      { href: '/roadmap', label: 'Roadmap', icon: Map, section: 'Build' },
    ],
  },
  {
    label: 'Machine',
    items: [
      { href: '/system/agents', label: 'Agents', icon: Bot, section: 'Machine' },
      { href: '/system/cron', label: 'Cron Jobs', icon: Clock, section: 'Machine' },
      { href: '/health', label: 'Codebase Health', icon: Shield, section: 'Machine' },
      { href: '/system', label: 'Settings', icon: Settings, section: 'Machine' },
    ],
  },
  // "Not built yet" pages live behind a collapsed section — visible ambition,
  // but they shouldn't dilute the working nav.
  {
    label: 'Planned',
    collapsedByDefault: true,
    items: [
      { href: '/finance', label: 'Finance', icon: DollarSign, section: 'Planned' },
      { href: '/fundraise', label: 'Fundraise', icon: TrendingUp, section: 'Planned' },
    ],
  },
]

// Cron job categories
export const CRON_CATEGORIES: Record<string, string[]> = {
  'Code Quality': ['vulnerability-scan', 'test-coverage-gaps', 'tech-debt-scan', 'migration-safety-check'],
  'Compliance': ['compliance-backend-security', 'compliance-ui-accessibility', 'rbac-consistency-check'],
  'Documentation': ['doc-freshness-check', 'prompt-quality-audit'],
  'Infrastructure': ['dependency-config-audit', 'audit-log-completeness'],
  'Intelligence': ['improvement-recommendations', 'update-memory'],
}

export function getCronCategory(jobName: string): string {
  for (const [category, jobs] of Object.entries(CRON_CATEGORIES)) {
    if (jobs.some(j => jobName.includes(j))) return category
  }
  return 'Custom'
}

// ── CRM (Phase 5 / M1) ──────────────────────────────────────────────────────
// Pipeline position. Terminal stages stop the aging clocks: a won/lost/
// disqualified contact is never "overdue" or "going cold".
// `verbal-commitment` sits between pilot-discussion and won: someone has said yes
// and nothing is on paper. It was added 2026-09-08 because the OEIS contact had
// been carrying `stage: verbal-commitment` since August — a value outside this
// list, which `normalizeCrmStage` silently discarded, so the warmest contact in
// the book read back as `identified`. The schema now knows the stage the business
// actually has, rather than the business rounding itself down to the schema.
export const CRM_STAGES = [
  'identified', 'contacted', 'meeting-booked', 'demo-given',
  'pilot-discussion', 'verbal-commitment', 'won', 'lost', 'disqualified',
] as const
export type CrmStage = typeof CRM_STAGES[number]

/** Pipeline order for "at least this warm" comparisons. Terminal stages sit
 *  outside it: `lost` is not a lesser `won`, it is a different fact. */
export const CRM_STAGE_ORDER: readonly CrmStage[] = [
  'identified', 'contacted', 'meeting-booked', 'demo-given',
  'pilot-discussion', 'verbal-commitment', 'won',
]

/** Is `stage` at or past `floor` on the pipeline? False for terminal non-`won`. */
export function stageAtLeast(stage: CrmStage, floor: CrmStage): boolean {
  const a = CRM_STAGE_ORDER.indexOf(stage)
  const b = CRM_STAGE_ORDER.indexOf(floor)
  return a >= 0 && b >= 0 && a >= b
}

export const CRM_TERMINAL_STAGES: readonly CrmStage[] = ['won', 'lost', 'disqualified']

/**
 * Does this contact want `product`?
 *
 * `product:` is the record's PRIMARY attribution and stays single-valued: a
 * contact sits in one owner's pipeline, and the shape charts have to sum to the
 * headcount. But interest is not exclusive, and reading `product` as if it were
 * put two false facts on the board (2026-09-08). The OEIS CIO carries
 * `product: assistants` while her own log records her asking for WMP (Attest)
 * and PRA (Candor). Read strictly, that left Attest structurally unable to
 * score pull — no contact anywhere carried `plan-review` — and made Candor's
 * "165 human commits in 90 days and no recorded pull" callout untrue: there was
 * a warm agency asking, filed under another product.
 *
 * `interested_in` is additive and never replaces `product`. Everything that
 * measures DEMAND — roadmap pull, demand signals, the `contacts_count` proof —
 * reads through here. Everything that measures ATTRIBUTION — pipeline shape,
 * owner load — keeps reading `product` alone, so one person still counts once.
 *
 * Human judgement only. Nothing infers interest from a transcript; somebody has
 * to have asked.
 */
export function wantsProduct(
  c: { product?: string; interestedIn?: string[] },
  product: string,
): boolean {
  return c.product === product || (c.interestedIn?.includes(product) ?? false)
}

// Orthogonal to stage: where a contact sits in the pipeline vs. whether work on
// them can currently proceed. `blocked` exists because the 87-day CalHR miss was
// an action waiting on an artifact nobody had made, with no way to say so.
export const CRM_STATUSES = ['active', 'blocked', 'dormant'] as const
export type CrmStatus = typeof CRM_STATUSES[number]

// A contact untouched for this long is "going cold" — the metric that made the
// GTM gap analysis land. Tuned to ~3 weeks: long enough to not nag, short enough
// that a lead has not gone stale by the time it surfaces.
export const CRM_COLD_DAYS = 21

// Log entries written by machinery rather than by a person talking to someone.
// Counting these as "touches" would let momentum rise while zero selling
// happened. 'email-in' = the contact emailing us: bumps last_touched, never
// momentum. 'email-out' deliberately absent — a sent email is a human selling.
// Single source of truth: this Set was once duplicated in crm.ts and insights.ts
// and drifted, letting lead-sync writes inflate momentum.
export const NON_HUMAN_VIA = new Set(['seed', 'rederive', 'slug-reconcile', 'verify',
  'roundtrip-test', 'api-test', 'pavan-correction', 'lead-sync', 'baseline',
  'email-in'])

export function normalizeCrmStage(input: unknown): CrmStage | undefined {
  if (typeof input !== 'string') return undefined
  const target = input.trim().toLowerCase()
  return CRM_STAGES.find(s => s === target)
}

/** Warn once per unrecognized value, not once per read — these are called on
 *  every render and a per-row warning would bury the signal it exists to give. */
const warnedStatuses = new Set<string>()

/**
 * Unknown statuses normalize to `active` — but say so.
 *
 * The silent version of this is how `status: active-hot` sat in the CRM unnoticed:
 * it fell through to `active`, which was the right answer, so nothing ever
 * surfaced that the file was writing a value the schema did not know. A field
 * that quietly discards input is a field that hides data entry mistakes.
 */
export function normalizeCrmStatus(input: unknown): CrmStatus | undefined {
  if (typeof input !== 'string') return undefined
  const target = input.trim().toLowerCase()
  const hit = CRM_STATUSES.find(s => s === target)
  if (!hit && target && !warnedStatuses.has(target)) {
    warnedStatuses.add(target)
    console.warn(
      `[crm] unknown status ${JSON.stringify(target)} — reading as "active". ` +
      `Known statuses: ${CRM_STATUSES.join(', ')}.`
    )
  }
  return hit
}
