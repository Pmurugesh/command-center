"use client"

import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/shared/status-badge'
import { TimeAgo } from '@/components/shared/time-ago'
import { Play, Bot } from 'lucide-react'
import { isFailing, type NormalizedCronJob } from '@/lib/cron'

// Display order: orchestrator first, then the specialists, then anything new.
const AGENT_ORDER = ['main', 'intel', 'sales', 'product', 'voice']

function agentLabel(agentId: string): string {
  if (!agentId) return 'Unassigned'
  return agentId.charAt(0).toUpperCase() + agentId.slice(1)
}

export function CronJobList({ jobs }: { jobs: NormalizedCronJob[] }) {
  const [runningJobs, setRunningJobs] = useState<Set<string>>(new Set())
  const [runResults, setRunResults] = useState<Record<string, { success: boolean; message: string }>>({})

  // Group by owning agent — that's how the jobs are actually organized.
  const grouped: Record<string, NormalizedCronJob[]> = {}
  for (const job of jobs) {
    const key = job.agentId || 'other'
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(job)
  }
  const groupKeys = Object.keys(grouped).sort((a, b) => {
    const ai = AGENT_ORDER.indexOf(a), bi = AGENT_ORDER.indexOf(b)
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
  // Failing jobs float to the top of each group.
  for (const key of groupKeys) {
    grouped[key].sort((a, b) => Number(isFailing(b)) - Number(isFailing(a)) || a.name.localeCompare(b.name))
  }

  const handleRunJob = async (jobName: string) => {
    setRunningJobs(prev => new Set(prev).add(jobName))
    setRunResults(prev => ({ ...prev, [jobName]: { success: true, message: 'Running...' } }))

    try {
      const res = await fetch(`/api/system/cron/${encodeURIComponent(jobName)}/run`, { method: 'POST' })
      const data = await res.json()
      setRunResults(prev => ({
        ...prev,
        [jobName]: { success: data.success, message: data.success ? 'Completed' : data.error || 'Failed' },
      }))
    } catch {
      setRunResults(prev => ({ ...prev, [jobName]: { success: false, message: 'Request failed' } }))
    } finally {
      setRunningJobs(prev => {
        const next = new Set(prev)
        next.delete(jobName)
        return next
      })
    }
  }

  return (
    <div className="space-y-6">
      {groupKeys.map(key => (
        <Card key={key}>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Bot className="h-5 w-5" />
              {agentLabel(key)}
              <Badge variant="secondary" className="text-xs">{grouped[key].length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {grouped[key].map((job) => {
                const isRunning = runningJobs.has(job.name)
                const result = runResults[job.name]

                return (
                  <div key={job.id} className="flex items-center justify-between rounded-md border border-border p-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{job.name}</p>
                        <StatusBadge status={isRunning ? 'running' : (job.lastRunStatus || 'pending')} />
                        {!job.enabled && <StatusBadge status="disabled" />}
                        {job.consecutiveErrors > 1 && (
                          <Badge variant="destructive" className="text-[10px] font-mono tabular-nums">
                            failing ×{job.consecutiveErrors}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
                        <span className="font-mono">{job.scheduleExpr}{job.timezone ? ` (${job.timezone})` : ''}</span>
                        {job.lastRunAt && (
                          <span>Last run: <TimeAgo date={job.lastRunAt} /></span>
                        )}
                        {job.lastDurationMs != null && (
                          <span>Duration: {Math.round(job.lastDurationMs / 1000)}s</span>
                        )}
                        {job.nextRunAt && (
                          <span>Next: <TimeAgo date={job.nextRunAt} /></span>
                        )}
                      </div>
                      {isFailing(job) && job.lastError && (
                        <p className="text-xs text-status-danger mt-1 truncate">{job.lastError}</p>
                      )}
                      {result && !isRunning && (
                        <p className={`text-xs mt-1 ${result.success ? 'text-emerald-400' : 'text-red-400'}`}>
                          {result.message}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => handleRunJob(job.name)}
                      disabled={isRunning}
                      className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ml-4 flex-shrink-0"
                    >
                      <Play className="h-3.5 w-3.5" />
                      {isRunning ? 'Running...' : 'Run Now'}
                    </button>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
