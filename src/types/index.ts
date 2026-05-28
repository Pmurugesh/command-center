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
