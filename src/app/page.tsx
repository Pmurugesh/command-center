import { listBids, listScanReports, listIntelAlerts } from '@/lib/files'
import { getCronJobs } from '@/lib/shell'
import { extractDeltaIndicators, extractCriticalCount } from '@/lib/markdown'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatusBadge, HealthDot } from '@/components/shared/status-badge'
import { DataCard } from '@/components/shared/data-card'
import { PageHeader } from '@/components/shared/page-header'
import Link from 'next/link'
import { FileText, Shield, Radio, Clock, ArrowRight, AlertTriangle } from 'lucide-react'
import type { CronJob } from '@/types'

export const dynamic = 'force-dynamic'

// First non-empty paragraph from markdown (skips headings)
function firstParagraph(md: string, max = 220): string {
  const lines = md.split('\n')
  let buf = ''
  for (const line of lines) {
    const t = line.trim()
    if (!t) {
      if (buf) break
      continue
    }
    if (t.startsWith('#')) continue
    if (t.startsWith('---')) continue
    buf += (buf ? ' ' : '') + t.replace(/[*_`>]/g, '')
    if (buf.length > max) break
  }
  return buf.length > max ? buf.slice(0, max).trimEnd() + '…' : buf
}

export default async function OverviewPage() {
  const [bids, reports, alerts, cronJobs] = await Promise.all([
    listBids(),
    listScanReports(),
    listIntelAlerts(),
    getCronJobs(),
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

  // Group bids by status for mini-kanban (preserve workflow order, case-insensitive)
  const STATUS_ORDER = ['discovered', 'analyzing', 'draft ready', 'under review', 'submitted', 'won', 'lost', 'no-bid']
  const statusGroups: Record<string, typeof bids> = {}
  for (const bid of bids) {
    const status = (bid.status || 'Analyzing').toLowerCase()
    if (!statusGroups[status]) statusGroups[status] = []
    statusGroups[status].push(bid)
  }
  const orderedGroups = STATUS_ORDER
    .filter(s => statusGroups[s])
    .map(s => [s, statusGroups[s]] as const)

  // Critical alerts from reports + intel
  const criticalReports = reportDeltas.filter(r => r.critical > 0)
  const criticalAlerts = alerts.filter(a => a.content.toLowerCase().includes('critical'))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description={`${bids.length} active bid${bids.length === 1 ? '' : 's'} · ${reports.length} scan report${reports.length === 1 ? '' : 's'} · ${criticalFindings} critical finding${criticalFindings === 1 ? '' : 's'}`}
        actions={
          <div className="flex items-center gap-2 text-sm">
            <HealthDot status={overallHealth} />
            <span className="text-muted-foreground">
              {overallHealth === 'green' ? 'All systems healthy' :
               overallHealth === 'yellow' ? 'Attention needed' : 'Critical issues'}
            </span>
          </div>
        }
      />

      {/* Stats Row — 4 hero metrics (dropped Claude Processes; it's not actionable) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <DataCard label="Active Bids" value={bids.length} subtitle="In pipeline" />
        <DataCard
          label="Cron Jobs"
          value={jobs.length === 0 ? '—' : `${jobs.filter(j => j.enabled !== false).length}/${jobs.length}`}
          subtitle={jobs.length === 0 ? 'No tasks scheduled' : cronOk ? 'All healthy' : `${cronFailed} failed`}
          valueColor={jobs.length === 0 ? 'text-muted-foreground' : cronOk ? undefined : 'text-status-warning'}
        />
        <DataCard label="Scan Reports" value={reports.length} subtitle="Available" />
        <DataCard
          label="Critical Findings"
          value={criticalFindings}
          subtitle={criticalFindings === 0 ? 'None found' : 'Need attention'}
          valueColor={criticalFindings > 0 ? 'text-status-danger' : 'text-status-success'}
        />
      </div>

      {/* Needs Attention — only renders if there's something to act on */}
      {(criticalReports.length > 0 || criticalAlerts.length > 0) && (
        <Card className="border-status-danger/30 bg-status-danger/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-status-danger">
              <AlertTriangle className="h-5 w-5" />
              Needs Attention
              <Badge variant="destructive" className="ml-1 font-mono">{criticalReports.length + criticalAlerts.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {criticalReports.map(r => (
              <Link key={r.name} href="/health" className="block group">
                <div className="flex items-center justify-between rounded-md border border-status-danger/20 p-3 hover:border-status-danger/50 hover:bg-status-danger/5 transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    <Shield className="h-4 w-4 text-status-danger flex-shrink-0" />
                    <span className="text-sm truncate">{r.displayName}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge variant="destructive" className="font-mono">{r.critical} critical</Badge>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-status-danger transition-colors" />
                  </div>
                </div>
              </Link>
            ))}
            {criticalAlerts.slice(0, 2).map(a => (
              <Link key={a.filename} href="/intel" className="block group">
                <div className="flex items-center justify-between rounded-md border border-status-danger/20 p-3 hover:border-status-danger/50 hover:bg-status-danger/5 transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    <Radio className="h-4 w-4 text-status-danger flex-shrink-0" />
                    <span className="text-sm truncate">{a.date} — Intel Alert</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge variant="destructive">Critical</Badge>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-status-danger transition-colors" />
                  </div>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Bid Pipeline Mini-Kanban — colored stage headers */}
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
              {orderedGroups.map(([status, groupBids]) => (
                <div key={status} className="min-w-[220px] flex-shrink-0">
                  <div className="flex items-center justify-between mb-3">
                    <StatusBadge status={status} />
                    <span className="text-xs font-mono text-muted-foreground tabular-nums">{groupBids.length}</span>
                  </div>
                  <div className="space-y-2">
                    {groupBids.map(bid => (
                      <Link key={bid.name} href={`/bids/${bid.name}`}>
                        <div className="rounded-md border border-border p-3 hover:border-border hover:bg-accent/30 transition-colors">
                          <p className="text-sm font-medium truncate">{bid.displayName}</p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className="text-xs text-muted-foreground font-mono tabular-nums">{bid.fileCount} docs</span>
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

      {/* Two-column: Cron + Latest Intel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
            <CardDescription>{jobs.length === 0 ? 'No scheduled tasks' : `${jobs.length} scheduled · ${cronFailed} failing`}</CardDescription>
          </CardHeader>
          <CardContent>
            {jobs.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                Add a task with <code className="font-mono text-foreground bg-muted px-1.5 py-0.5 rounded text-xs">openclaw cron add</code>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {jobs.slice(0, 8).map((job) => {
                  const status = (job as any).state?.lastRunStatus || 'pending'
                  const schedule = typeof job.schedule === 'object' ? job.schedule.expr : job.schedule
                  return (
                    <div key={job.name} className="flex items-center justify-between rounded-md border border-border p-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{job.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{schedule}</p>
                      </div>
                      <StatusBadge status={status} />
                    </div>
                  )
                })}
                {jobs.length > 8 && (
                  <Link href="/system/cron" className="flex items-center justify-center rounded-md border border-dashed border-border p-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
                    +{jobs.length - 8} more jobs
                  </Link>
                )}
              </div>
            )}
          </CardContent>
        </Card>

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
              <CardDescription className="font-mono tabular-nums">{alerts[0].date} · {alerts[0].type === 'daily' ? 'Daily scan' : alerts[0].type}</CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {alerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No intelligence alerts</p>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {firstParagraph(alerts[0].content)}
                </p>
                <Link href="/intel" className="inline-flex items-center gap-1 text-sm text-blue-400 hover:underline">
                  Read full briefing <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
