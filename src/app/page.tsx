import { listBids, listScanReports, listIntelAlerts } from '@/lib/files'
import { getCronJobs, getOpenClawStatus, getActiveClaudeProcesses } from '@/lib/shell'
import { extractDeltaIndicators, extractCriticalCount } from '@/lib/markdown'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatusBadge, HealthDot } from '@/components/shared/status-badge'
import { DataCard } from '@/components/shared/data-card'
import { PageHeader } from '@/components/shared/page-header'
import Link from 'next/link'
import { FileText, Shield, Radio, Clock, Play, Eye, ArrowRight, AlertTriangle } from 'lucide-react'
import type { CronJob } from '@/types'

export const dynamic = 'force-dynamic'

export default async function OverviewPage() {
  const [bids, reports, alerts, cronJobs, openclawStatus, activeProcesses] = await Promise.all([
    listBids(),
    listScanReports(),
    listIntelAlerts(),
    getCronJobs(),
    getOpenClawStatus(),
    getActiveClaudeProcesses(),
  ])

  const jobs = cronJobs as CronJob[]
  const cronFailed = jobs.filter((j) => {
    const status = (j as any).state?.lastRunStatus
    return status === 'error' || status === 'failed'
  }).length
  const cronOk = cronFailed === 0

  let criticalFindings = 0
  const reportDeltas = reports.map(r => {
    const deltas = extractDeltaIndicators(r.content)
    const critical = extractCriticalCount(r.content)
    criticalFindings += critical
    return { ...r, deltas, critical }
  })

  const overallHealth: 'green' | 'yellow' | 'red' =
    cronFailed > 2 || criticalFindings > 5 ? 'red' :
    cronFailed > 0 || criticalFindings > 0 ? 'yellow' : 'green'

  // Group bids by status for mini-kanban
  const statusGroups: Record<string, typeof bids> = {}
  for (const bid of bids) {
    const status = bid.status || 'Analyzing'
    if (!statusGroups[status]) statusGroups[status] = []
    statusGroups[status].push(bid)
  }

  // Critical alerts from reports
  const criticalReports = reportDeltas.filter(r => r.critical > 0)

  return (
    <div className="space-y-8">
      <PageHeader
        title="Overview"
        description="System status and pipeline summary"
        actions={
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm">
              <HealthDot status={overallHealth} />
              <span className="text-muted-foreground">
                {overallHealth === 'green' ? 'All Systems Healthy' :
                 overallHealth === 'yellow' ? 'Attention Needed' : 'Critical Issues'}
              </span>
            </div>
          </div>
        }
      />

      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <DataCard label="Active Bids" value={bids.length} subtitle="In pipeline" />
        <DataCard
          label="Cron Jobs"
          value={`${jobs.filter(j => j.enabled !== false).length}/${jobs.length}`}
          subtitle={cronOk ? 'All healthy' : `${cronFailed} failed`}
          valueColor={cronOk ? undefined : 'text-yellow-400'}
        />
        <DataCard label="Scan Reports" value={reports.length} subtitle="Available" />
        <DataCard
          label="Critical Findings"
          value={criticalFindings}
          subtitle={criticalFindings === 0 ? 'None found' : 'Need attention'}
          valueColor={criticalFindings > 0 ? 'text-red-400' : 'text-emerald-400'}
        />
        <DataCard label="Claude Processes" value={activeProcesses} subtitle="Active" />
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-3">
        <Link href="/bids" className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm hover:bg-accent/50 transition-colors">
          <FileText className="h-4 w-4" /> View Bid Pipeline
        </Link>
        <Link href="/health" className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm hover:bg-accent/50 transition-colors">
          <Shield className="h-4 w-4" /> View Scan Reports
        </Link>
        <Link href="/intel" className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm hover:bg-accent/50 transition-colors">
          <Eye className="h-4 w-4" /> Latest Briefing
        </Link>
        <Link href="/system/cron" className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm hover:bg-accent/50 transition-colors">
          <Clock className="h-4 w-4" /> Cron Jobs
        </Link>
      </div>

      {/* Critical Alerts */}
      {(criticalReports.length > 0 || alerts.some(a => a.content.toLowerCase().includes('critical'))) && (
        <Card className="border-red-400/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2 text-red-400">
              <AlertTriangle className="h-5 w-5" />
              Critical Alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {criticalReports.map(r => (
              <Link key={r.name} href="/health" className="block">
                <div className="flex items-center justify-between rounded-md border border-red-400/20 p-3 hover:bg-red-400/5 transition-colors">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-red-400" />
                    <span className="text-sm">{r.displayName}</span>
                  </div>
                  <Badge variant="destructive">{r.critical} critical</Badge>
                </div>
              </Link>
            ))}
            {alerts.filter(a => a.content.toLowerCase().includes('critical')).slice(0, 2).map(a => (
              <Link key={a.filename} href="/intel" className="block">
                <div className="flex items-center justify-between rounded-md border border-red-400/20 p-3 hover:bg-red-400/5 transition-colors">
                  <div className="flex items-center gap-2">
                    <Radio className="h-4 w-4 text-red-400" />
                    <span className="text-sm">{a.date} — Intel Alert</span>
                  </div>
                  <Badge variant="destructive">Critical</Badge>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Bid Pipeline Mini-Kanban */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Bid Pipeline
            </CardTitle>
            <Link href="/bids" className="text-sm text-blue-400 hover:underline flex items-center gap-1">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {bids.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bids in pipeline</p>
          ) : (
            <div className="flex gap-4 overflow-x-auto pb-2">
              {Object.entries(statusGroups).map(([status, groupBids]) => (
                <div key={status} className="min-w-[200px] flex-shrink-0">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
                    {status}
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{groupBids.length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {groupBids.map(bid => (
                      <Link key={bid.name} href={`/bids/${bid.name}`}>
                        <div className="rounded-md border border-border p-3 hover:bg-accent/30 transition-colors">
                          <p className="text-sm font-medium truncate">{bid.displayName}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-muted-foreground">{bid.fileCount} docs</span>
                            {bid.entity && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">{bid.entity}</Badge>
                            )}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cron Status Summary */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Cron Jobs
              </CardTitle>
              <Link href="/system/cron" className="text-sm text-blue-400 hover:underline flex items-center gap-1">
                Manage <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <CardDescription>Scheduled task status</CardDescription>
          </CardHeader>
          <CardContent>
            {jobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No cron jobs found</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {jobs.slice(0, 8).map((job) => {
                  const status = (job as any).state?.lastRunStatus || 'pending'
                  const schedule = typeof job.schedule === 'object' ? job.schedule.expr : job.schedule
                  return (
                    <div key={job.name} className="flex items-center justify-between rounded-md border border-border p-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{job.name}</p>
                        <p className="text-xs text-muted-foreground">{schedule}</p>
                      </div>
                      <StatusBadge status={status} />
                    </div>
                  )
                })}
                {jobs.length > 8 && (
                  <Link href="/system/cron" className="flex items-center justify-center rounded-md border border-dashed border-border p-2.5 text-sm text-muted-foreground hover:text-foreground hover:border-border transition-colors">
                    +{jobs.length - 8} more jobs
                  </Link>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Latest Intel */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Radio className="h-5 w-5" />
                Latest Intelligence
              </CardTitle>
              <Link href="/intel" className="text-sm text-blue-400 hover:underline flex items-center gap-1">
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            {alerts.length > 0 && (
              <CardDescription>{alerts[0].date} — {alerts[0].type === 'daily' ? 'Daily scan' : alerts[0].type}</CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {alerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No intelligence alerts</p>
            ) : (
              <div className="text-sm text-muted-foreground whitespace-pre-line line-clamp-8">
                {alerts[0].content.slice(0, 600)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
