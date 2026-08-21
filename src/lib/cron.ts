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

/**
 * Coerce one raw cron record into the normalized shape.
 *
 * Takes `unknown` rather than `any`: this parses output from an external CLI
 * whose schema has already drifted once (the reason this module exists), so the
 * compiler should force every field access to be checked rather than trusting a
 * shape that was wrong before. It also avoids an eslint-disable for a rule this
 * project's config does not define, which broke the production build.
 */
type Bag = Record<string, unknown>
const bag = (v: unknown): Bag => (typeof v === 'object' && v !== null ? v as Bag : {})
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)

export function normalizeCronJob(raw: unknown): NormalizedCronJob {
  const r = bag(raw)
  const state = bag(r.state)
  const schedule = r.schedule
  const lastRun = bag(r.last_run)
  const durationSeconds = num(lastRun.duration_seconds)

  return {
    id: String(r.id ?? r.name ?? ''),
    name: String(r.name ?? ''),
    agentId: str(r.agentId) ?? '',
    description: str(r.description),
    enabled: r.enabled !== false,
    scheduleExpr: typeof schedule === 'string' ? schedule : String(bag(schedule).expr ?? ''),
    timezone: typeof schedule === 'object' && schedule ? str(bag(schedule).tz) : undefined,
    lastRunAt:
      msToIso(num(state.lastRunAtMs)) ??
      strToIso(str(state.lastRunAt)) ??
      strToIso(str(lastRun.completed_at)) ??
      strToIso(str(lastRun.started_at)),
    lastRunStatus: str(state.lastRunStatus) ?? str(state.lastStatus) ?? str(lastRun.status),
    lastDurationMs:
      num(state.lastDurationMs) ??
      (durationSeconds !== undefined ? durationSeconds * 1000 : undefined),
    lastError: str(state.lastError),
    consecutiveErrors: num(state.consecutiveErrors) ?? 0,
    nextRunAt: msToIso(num(state.nextRunAtMs)) ?? strToIso(str(r.next_run)),
  }
}

export function isFailing(job: NormalizedCronJob): boolean {
  return job.lastRunStatus === 'error' || job.lastRunStatus === 'failed'
}
