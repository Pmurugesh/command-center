import type { BidStatus, Entity } from '@/lib/config'

export interface Bid {
  name: string
  displayName: string
  files: string[]
  fileCount: number
  status?: BidStatus
  entity?: Entity
  hasDocuments?: boolean
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
