/**
 * Today — the morning home.
 *
 * Pulls together:
 *  - Decisions waiting on you (parsed across every bid)
 *  - Agents last 24h (cron run summary + outputs-touched count)
 *  - Active bids mini-kanban
 *  - Action queue (partnership next-actions)
 *  - System health and bid counters in the header strip
 *
 * Replaces the previous Overview. Same route (/), so existing bookmarks
 * still land here.
 */

import { listBids, listScanReports, listIntelAlerts, getActionQueue } from '@/lib/files'
import { getCronJobs } from '@/lib/shell'
import { getDecisionQueue } from '@/lib/decisions'
import { getAgent24hSummary } from '@/lib/agents'
import { extractCriticalCount } from '@/lib/markdown'
import { PageHeader } from '@/components/shared/page-header'
import { HealthDot } from '@/components/shared/status-badge'
import { DataCard } from '@/components/shared/data-card'
import { DecisionsCard } from '@/components/today/decisions-card'
import { AgentsSummaryCard } from '@/components/today/agents-summary'
import { ActiveBidsKanban } from '@/components/today/active-bids-kanban'
import { ActionQueueCard } from '@/components/today/action-queue-card'
import type { CronJob } from '@/types'

export const dynamic = 'force-dynamic'

function greeting(now = new Date()): string {
  const h = now.getHours()
  if (h < 5) return 'Up late'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  if (h < 21) return 'Good evening'
  return 'Up late'
}

function todayLabel(now = new Date()): string {
  return now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default async function TodayPage() {
  // Fetch everything in parallel — each data source is independent.
  const [bids, reports, alerts, cronJobs, decisions, agentSummaries, actionQueue] = await Promise.all([
    listBids(),
    listScanReports(),
    listIntelAlerts(),
    getCronJobs(),
    getDecisionQueue().catch(() => []),
    getAgent24hSummary().catch(() => []),
    getActionQueue().catch(() => []),
  ])

  // Aggregate critical findings across scan reports (signal for header health).
  let criticalFindings = 0
  for (const r of reports) criticalFindings += extractCriticalCount(r.content)

  const jobs = cronJobs as CronJob[]
  const cronFailed = jobs.filter(j => {
    const s = j.state?.lastRunStatus || j.last_run?.status
    return s === 'failed' || s === 'error'
  }).length

  const overallHealth: 'green' | 'yellow' | 'red' =
    cronFailed > 2 || criticalFindings > 5 || decisions.length > 10 ? 'red' :
    cronFailed > 0 || criticalFindings > 0 || decisions.length > 0     ? 'yellow' :
    'green'

  // Active bids = anything not in a closed state.
  const CLOSED = new Set(['won', 'lost', 'no-bid', 'submitted'])
  const activeBids = bids.filter(b => !CLOSED.has((b.status || '').toLowerCase()))

  // Today's date for the header.
  const now = new Date()

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting(now)}, Pavan`}
        description={todayLabel(now)}
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

      {/* Header counter strip — the morning glance metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <DataCard
          label="Decisions"
          value={decisions.length}
          subtitle={decisions.length === 0 ? "You're clear" : 'Need your call'}
          valueColor={decisions.length > 0 ? 'text-status-warning' : undefined}
        />
        <DataCard
          label="Active bids"
          value={activeBids.length}
          subtitle="In flight"
        />
        <DataCard
          label="Critical findings"
          value={criticalFindings}
          subtitle={criticalFindings === 0 ? 'None' : 'In codebase'}
          valueColor={criticalFindings > 0 ? 'text-status-danger' : undefined}
        />
        <DataCard
          label="Intel alerts"
          value={alerts.length}
          subtitle="Total tracked"
        />
      </div>

      {/* Decisions — top of the page, the highest-leverage action */}
      <DecisionsCard decisions={decisions} />

      {/* Agents — what your workforce did last 24h */}
      <AgentsSummaryCard summaries={agentSummaries} />

      {/* Active bids kanban */}
      <ActiveBidsKanban bids={activeBids} />

      {/* Action queue from partnership next-actions */}
      <ActionQueueCard items={actionQueue} />
    </div>
  )
}
