import type {
  Bid,
  BidDetail,
  BidStatusData,
  ScanReport,
  IntelAlert,
  SystemStatus,
  SystemHealth,
  LibraryFile,
  DataSourceInfo,
  ScriptInfo,
  CronJob,
  Agency,
  Partnership,
} from '@/types'

const BASE = ''

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`API ${path} failed (${res.status}): ${body}`)
  }
  return res.json()
}

// Bids
export const api = {
  bids: {
    list: () => fetchApi<Bid[]>('/api/bids'),
    detail: (name: string) => fetchApi<BidDetail>(`/api/bids/${encodeURIComponent(name)}`),
    getStatus: (name: string) => fetchApi<BidStatusData>(`/api/bids/${encodeURIComponent(name)}/status`),
    setStatus: (name: string, data: Partial<BidStatusData>) =>
      fetchApi<BidStatusData>(`/api/bids/${encodeURIComponent(name)}/status`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
  },

  health: {
    reports: () => fetchApi<ScanReport[]>('/api/health'),
  },

  intel: {
    alerts: () => fetchApi<IntelAlert[]>('/api/intel'),
  },

  system: {
    status: () => fetchApi<SystemStatus>('/api/system'),
    health: () => fetchApi<SystemHealth>('/api/system/health'),
    cronRun: (jobName: string) =>
      fetchApi<{ success: boolean; output: string }>(`/api/system/cron/${encodeURIComponent(jobName)}/run`, {
        method: 'POST',
      }),
  },

  library: {
    list: () => fetchApi<LibraryFile[]>('/api/library'),
  },

  agencies: {
    list: () => fetchApi<Agency[]>('/api/agencies'),
    detail: (slug: string) => fetchApi<Agency>(`/api/agencies/${encodeURIComponent(slug)}`),
  },

  partnerships: {
    list: () => fetchApi<Partnership[]>('/api/partnerships'),
  },

  systemInfo: {
    dataSources: () => fetchApi<DataSourceInfo[]>('/api/system/info/data-sources'),
    scripts: () => fetchApi<ScriptInfo[]>('/api/system/info/scripts'),
  },
}
