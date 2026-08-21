import type { BidStatus, Entity } from '@/lib/config'

export interface Bid {
  name: string
  displayName: string
  files: string[]
  fileCount: number
  status?: BidStatus
  entity?: Entity
  hasDocuments?: boolean
  updatedAt?: string // ISO; from .status.json updatedAt OR bid dir mtime
}

export interface BidFile {
  name: string
  displayName: string
  content: string
  flagCount: number
}

export interface BidDetail {
  name: string
  displayName: string
  files: BidFile[]
  status?: BidStatus
  entity?: Entity
  documents?: DocumentFile[]
  totalFlags: number
}

export interface BidStatusData {
  status: BidStatus
  entity: Entity
  updatedAt: string
}

export interface DocumentFile {
  name: string
  size: number
  type: string
}

export interface ScanReport {
  name: string
  displayName: string
  content: string
  lastModified: string
  size: number
}

export interface ScanReportWithDeltas extends ScanReport {
  deltas: DeltaIndicators
  criticalCount: number
}

export interface DeltaIndicators {
  new: number
  resolved: number
  unchanged: number
}

export interface IntelAlert {
  filename: string
  date: string
  content: string
  type: 'daily' | 'weekly' | 'procurement' | 'competitor' | 'other'
}

export interface CronJob {
  name: string
  schedule: string | { expr: string }
  timezone: string
  last_run?: {
    status: string
    started_at?: string
    completed_at?: string
    duration_seconds?: number
  }
  next_run?: string
  enabled: boolean
  state?: {
    lastRunStatus?: string
    lastRunAt?: string
  }
}

export interface SystemStatus {
  openclaw: string
  cronJobs: CronJob[]
  activeProcesses: number
}

export interface SystemHealth {
  overall: 'green' | 'yellow' | 'red'
  cronOk: boolean
  cronFailed: number
  criticalFindings: number
  activeBids: number
  recentAlerts: number
}

export interface LibraryFile {
  name: string
  displayName: string
  content: string
  path: string
  isDirectory: boolean
  children?: LibraryFile[]
}

export interface DataSourceInfo {
  name: string
  path: string
  exists: boolean
  fileCount: number
  lastModified: string | null
}

export interface ScriptInfo {
  name: string
  path: string
  size: number
  description: string
}

// API response wrapper
export interface ApiResponse<T> {
  data: T
  error?: string
}

// Relationships
export type AgencyPriority = 'high' | 'medium' | 'low'

export interface Contact {
  name?: string
  email: string
}

export interface Agency {
  slug: string
  displayName: string
  filename: string
  priority: AgencyPriority
  contactCount: number
  contacts: Contact[]
  content: string
  lastModified: string  // ISO timestamp from file mtime
}

export type PartnershipStatus = 'active' | 'in-contact' | 'potential' | 'unknown'

// Kept as an alias for backwards compatibility within Partnership shape.
export type PartnershipContact = Contact

export interface Partnership {
  name: string
  status: PartnershipStatus
  contacts: PartnershipContact[]
  nextAction?: string
  content: string
}

// Agents (the AI workforce)
export type AgentStatus = 'running' | 'ok' | 'warning' | 'idle'

// An output an agent produces — a dashboard route. iconKey is a string so the
// shape stays JSON-serializable; the rendering side maps key → LucideIcon.
export interface AgentOutput {
  href: string
  label: string
  iconKey: string
}

export interface Agent {
  id: string
  name: string
  emoji: string
  model: string
  workspace: string       // home-relative path with ~ prefix
  role: string
  owns: string[]          // raw SOUL.md "What You Own" bullets
  outputs: AgentOutput[]  // mapped dashboard routes for this agent
  status: AgentStatus
  lastActivityAt?: string // ISO; max mtime across owned outputs
}

// ── CRM (Phase 5 / M1) ──────────────────────────────────────────────────────
// One file per human at `operations/crm/contacts/<slug>.md`: frontmatter carries
// the structured record, the body carries notes + an append-only `## Log`.
// Named CrmContact (not Contact) so the existing scraped {name,email} shape used
// by Agency/Partnership keeps working untouched.

import type { CrmStage, CrmStatus } from '@/lib/config'

export interface CrmLogEntry {
  date: string            // YYYY-MM-DD
  text: string
  via?: string            // attribution: who/what wrote it (dashboard, telegram, granola…)
}

export interface CrmContact {
  slug: string
  name: string
  title?: string
  email?: string
  phone?: string
  agency?: string         // agency slug, joins to intelligence/agencies/<slug>.md
  agencyName?: string
  product?: string        // product slug (prrai | aihire | reporting | procurement | echo)
  owner?: string          // who on the team owns this relationship
  tier?: string           // T1/T2/T3 from CIO Academy triage
  stage: CrmStage
  status: CrmStatus
  blockedOn?: string      // free text: what has to exist before this can proceed
  lastTouched?: string    // YYYY-MM-DD — drives "going cold"
  nextAction?: string
  nextActionDue?: string  // YYYY-MM-DD — drives "overdue" / "due today"
  source?: string         // provenance of the record (cio-academy-2026, agency-profile…)
  created?: string
  notes: string           // body markdown above the ## Log heading
  log: CrmLogEntry[]
}

// Everything the Today page needs, computed server-side so the client renders
// plain data. daysOverdue/daysSinceTouch are the counters that make staleness
// arguable-with-nobody.
export interface CrmContactView extends CrmContact {
  daysOverdue?: number
  daysSinceTouch?: number
  daysBlocked?: number
}

export interface CrmBuckets {
  overdue: CrmContactView[]
  blocked: CrmContactView[]
  dueToday: CrmContactView[]
  goingCold: CrmContactView[]
  /** Never worked by a human. Seeded research, not a lapsed relationship. */
  neverContacted: CrmContactView[]
  total: number
}

// Partial update accepted by PATCH. Every field optional; `via` is required so
// no write is ever anonymous once the team is on this.
export interface CrmContactUpdate {
  name?: string
  title?: string
  email?: string
  phone?: string
  agency?: string
  agencyName?: string
  product?: string
  owner?: string
  tier?: string
  stage?: CrmStage
  status?: CrmStatus
  blockedOn?: string | null
  nextAction?: string | null
  nextActionDue?: string | null
  notes?: string
}
