"use client"

import { usePolling } from './use-polling'
import { POLLING } from '@/lib/config'
import type { SystemHealth } from '@/types'

export function useSystemHealth() {
  return usePolling<SystemHealth>('/api/system/health', POLLING.system)
}
