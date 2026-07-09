/**
 * Normalized view over `openclaw cron list --json`.
 *
 * The real schema (openclaw 2026.x) carries run state in `state` as epoch-ms
 * numbers (`lastRunAtMs`, `nextRunAtMs`, `lastDurationMs`) and puts the owning
 * agent directly on the job as `agentId`. Consumers should only ever touch
 * this normalized shape — reading the raw JSON is how the Today page ended up
 * showing "0 runs" while a job was failing.
 *
 * This module is pure (client-safe). The server-side fetch lives in
 * shell.ts → getNormalizedCronJobs().
 */

export interface NormalizedCronJob {
  id: string
  name: string
  agentId: string          // '' when the CLI didn't report one
  description?: string
  enabled: boolean
  scheduleExpr: string
  timezone?: string
  lastRunAt?: string       // ISO
  lastRunStatus?: string   // 'ok' | 'error' | 'failed' | ...
  lastDurationMs?: number
  lastError?: string
  consecutiveErrors: number
  nextRunAt?: string       // ISO
}

function msToIso(ms: unknown): string | undefined {
  return typeof ms === 'number' && ms > 0 ? new Date(ms).toISOString() : undefined
}

function strToIso(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  const t = new Date(value).getTime()
  return Number.isNaN(t) ? undefined : new Date(t).toISOString()
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function normalizeCronJob(raw: any): NormalizedCronJob {
  const state = raw?.state ?? {}
  const schedule = raw?.schedule
  return {
    id: String(raw?.id ?? raw?.name ?? ''),
    name: String(raw?.name ?? ''),
    agentId: typeof raw?.agentId === 'string' ? raw.agentId : '',
    description: typeof raw?.description === 'string' ? raw.description : undefined,
    enabled: raw?.enabled !== false,
    scheduleExpr: typeof schedule === 'string' ? schedule : String(schedule?.expr ?? ''),
    timezone: typeof schedule === 'object' && schedule ? schedule.tz : undefined,
    lastRunAt:
      msToIso(state.lastRunAtMs) ??
      strToIso(state.lastRunAt) ??
      strToIso(raw?.last_run?.completed_at) ??
      strToIso(raw?.last_run?.started_at),
    lastRunStatus: state.lastRunStatus ?? state.lastStatus ?? raw?.last_run?.status,
    lastDurationMs:
      typeof state.lastDurationMs === 'number' ? state.lastDurationMs :
      typeof raw?.last_run?.duration_seconds === 'number' ? raw.last_run.duration_seconds * 1000 :
      undefined,
    lastError: typeof state.lastError === 'string' && state.lastError ? state.lastError : undefined,
    consecutiveErrors: typeof state.consecutiveErrors === 'number' ? state.consecutiveErrors : 0,
    nextRunAt: msToIso(state.nextRunAtMs) ?? strToIso(raw?.next_run),
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function isFailing(job: NormalizedCronJob): boolean {
  return job.lastRunStatus === 'error' || job.lastRunStatus === 'failed'
}
