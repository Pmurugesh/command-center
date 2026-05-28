import {
  LayoutDashboard,
  FileText,
  Shield,
  Radio,
  Library,
  Settings,
  Clock,
  Building2,
  Handshake,
  TrendingUp,
  DollarSign,
  PenTool,
  Target,
  Bot,
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
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Overview',
    items: [
      { href: '/', label: 'Overview', icon: LayoutDashboard, section: 'Overview' },
    ],
  },
  {
    label: 'Growth',
    items: [
      { href: '/agencies', label: 'Agencies', icon: Building2, section: 'Growth' },
      { href: '/partnerships', label: 'Partnerships', icon: Handshake, section: 'Growth' },
    ],
  },
  {
    label: 'Deals',
    items: [
      { href: '/bids', label: 'Bid Pipeline', icon: FileText, section: 'Deals' },
      { href: '/library', label: 'Response Library', icon: Library, section: 'Deals' },
    ],
  },
  {
    label: 'Content',
    items: [
      { href: '/content', label: 'Content', icon: PenTool, section: 'Content' },
    ],
  },
  {
    label: 'Finance',
    items: [
      { href: '/finance', label: 'Finance Alerts', icon: DollarSign, section: 'Finance' },
    ],
  },
  {
    label: 'Product',
    items: [
      { href: '/health', label: 'Codebase Health', icon: Shield, section: 'Product' },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { href: '/intel', label: 'Intel Feed', icon: Radio, section: 'Intelligence' },
    ],
  },
  {
    label: 'Fundraising',
    items: [
      { href: '/fundraise', label: 'Fundraise', icon: TrendingUp, section: 'Fundraising' },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/system/agents', label: 'Agents', icon: Bot, section: 'System' },
      { href: '/system/cron', label: 'Cron Jobs', icon: Clock, section: 'System' },
      { href: '/system', label: 'Settings', icon: Settings, section: 'System' },
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
