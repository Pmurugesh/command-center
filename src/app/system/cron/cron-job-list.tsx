"use client"

import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/shared/status-badge'
import { TimeAgo } from '@/components/shared/time-ago'
import { getCronCategory } from '@/lib/config'
import { Play, Clock } from 'lucide-react'
import type { CronJob } from '@/types'

export function CronJobList({ jobs }: { jobs: CronJob[] }) {
  const [runningJobs, setRunningJobs] = useState<Set<string>>(new Set())
  const [runResults, setRunResults] = useState<Record<string, { success: boolean; message: string }>>({})

  // Group by category
  const grouped: Record<string, CronJob[]> = {}
  for (const job of jobs) {
    const category = getCronCategory(job.name)
    if (!grouped[category]) grouped[category] = []
    grouped[category].push(job)
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
      {Object.entries(grouped).map(([category, categoryJobs]) => (
        <Card key={category}>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="h-5 w-5" />
              {category}
              <Badge variant="secondary" className="text-xs">{categoryJobs.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {categoryJobs.map((job) => {
                const status = (job as any).state?.lastRunStatus || 'pending'
                const schedule = typeof job.schedule === 'object' ? job.schedule.expr : job.schedule
                const lastRunAt = (job as any).state?.lastRunAt || job.last_run?.started_at
                const isRunning = runningJobs.has(job.name)
                const result = runResults[job.name]

                return (
                  <div key={job.name} className="flex items-center justify-between rounded-md border border-border p-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{job.name}</p>
                        <StatusBadge status={isRunning ? 'running' : status} />
                        {job.enabled === false && <StatusBadge status="disabled" />}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                        <span>Schedule: {schedule}</span>
                        {lastRunAt && (
                          <span>Last run: <TimeAgo date={lastRunAt} /></span>
                        )}
                        {job.last_run?.duration_seconds != null && (
                          <span>Duration: {job.last_run.duration_seconds}s</span>
                        )}
                        {job.next_run && (
                          <span>Next: <TimeAgo date={job.next_run} /></span>
                        )}
                      </div>
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
