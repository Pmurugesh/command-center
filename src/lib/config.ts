import {
  Calendar,
  FileText,
  Shield,
  Radio,
  Settings,
  Clock,
  Building2,
  Handshake,
  TrendingUp,
  DollarSign,
  PenTool,
  Bot,
  Inbox,
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
export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Now',
    items: [
      { href: '/', label: 'Today', icon: Calendar, section: 'Now' },
      { href: '/intake', label: 'Intake', icon: Inbox, section: 'Now' },
    ],
  },
  {
    label: 'Work',
    items: [
      { href: '/bids', label: 'Bids', icon: FileText, section: 'Work' },
      { href: '/agencies', label: 'Agencies', icon: Building2, section: 'Work' },
      { href: '/partnerships', label: 'Partnerships', icon: Handshake, section: 'Work' },
    ],
  },
  {
    label: 'Workforce',
    items: [
      { href: '/system/agents', label: 'Agents', icon: Bot, section: 'Workforce' },
    ],
  },
  {
    label: 'Intel',
    items: [
      { href: '/intel', label: 'Intelligence', icon: Radio, section: 'Intel' },
      { href: '/health', label: 'Codebase Health', icon: Shield, section: 'Intel' },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/system/cron', label: 'Cron Jobs', icon: Clock, section: 'System' },
      { href: '/system', label: 'Settings', icon: Settings, section: 'System' },
    ],
  },
  // "Not built yet" pages live behind a collapsed section — visible ambition,
  // but they shouldn't dilute the working nav.
  {
    label: 'Planned',
    collapsedByDefault: true,
    items: [
      { href: '/content', label: 'Content', icon: PenTool, section: 'Planned' },
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
