import {
  LayoutDashboard,
  FileText,
  Shield,
  Radio,
  Library,
  Settings,
  Clock,
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
    label: 'Operations',
    items: [
      { href: '/', label: 'Overview', icon: LayoutDashboard, section: 'Operations' },
      { href: '/bids', label: 'Bid Pipeline', icon: FileText, section: 'Operations' },
      { href: '/library', label: 'Response Library', icon: Library, section: 'Operations' },
    ],
  },
  {
    label: 'Engineering',
    items: [
      { href: '/health', label: 'Codebase Health', icon: Shield, section: 'Engineering' },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { href: '/intel', label: 'Intelligence', icon: Radio, section: 'Intelligence' },
    ],
  },
  {
    label: 'System',
    items: [
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
