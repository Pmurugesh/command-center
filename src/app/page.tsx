/**
 * Today — the morning home.
 *
 * Answers, in order: what needs me right now (decisions, opportunity
 * deadlines), what my agents did overnight (runs + failures), where the work
 * stands (bids kanban, outreach), and whether the automation feeding all of
 * this is still alive (pipeline freshness).
 */

import { listBids, listIntelAlerts, getActionQueue, getOutreachData, getMorningActions, getPipelineFreshness } from '@/lib/files'
import { getNormalizedCronJobs } from '@/lib/shell'
import { isFailing } from '@/lib/cron'
import { getOpenOpportunities } from '@/lib/procurements'
import { getDecisionQueue } from '@/lib/decisions'
import { getAgent24hSummary } from '@/lib/agents'
import { PageHeader } from '@/components/shared/page-header'
import { HealthDot } from '@/components/shared/status-badge'
import { DataCard } from '@/components/shared/data-card'
import { DecisionsCard } from '@/components/today/decisions-card'
import { AgentsSummaryCard } from '@/components/today/agents-summary'
import { ActiveBidsKanban } from '@/components/today/active-bids-kanban'
import { ActionQueueCard } from '@/components/today/action-queue-card'
import { PriorityOutreachCard } from '@/components/today/priority-outreach-card'
import { MorningActionsCard } from '@/components/today/morning-actions-card'
import { OpportunitiesCard } from '@/components/today/opportunities-card'
import { FreshnessCard } from '@/components/today/freshness-card'

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
  const [bids, alerts, cronJobs, decisions, agentSummaries, actionQueue, outreach, morningActions, opportunities, freshness] = await Promise.all([
    listBids(),
    listIntelAlerts(),
    getNormalizedCronJobs().catch(() => []),
    getDecisionQueue().catch(() => []),
    getAgent24hSummary().catch(() => []),
    getActionQueue().catch(() => []),
    getOutreachData().catch(() => ({ items: [], updatedAt: null })),
    getMorningActions().catch(() => ''),
    getOpenOpportunities().catch(() => []),
    getPipelineFreshness().catch(() => []),
  ])

  // Intel produced this week (alerts + procurements + briefings), not lifetime.
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const intelThisWeek = alerts.filter(a => a.date && new Date(a.date).getTime() >= weekAgo).length

  const failingJobs = cronJobs.filter(isFailing)
  const persistentFailure = failingJobs.some(j => j.consecutiveErrors >= 2)

  // The health dot answers "is the automation running?" — codebase findings and
  // open decisions have their own cards and shouldn't keep the dot red forever.
  const overallHealth: 'green' | 'yellow' | 'red' =
    persistentFailure || failingJobs.length >= 2 ? 'red' :
    failingJobs.length > 0 ? 'yellow' :
    'green'

  const healthLabel =
    overallHealth === 'green' ? 'Automation healthy' :
    failingJobs.length === 1 ? `1 job failing: ${failingJobs[0].name}` :
    `${failingJobs.length} jobs failing`

  // Active bids = anything not in a closed state.
  const CLOSED = new Set(['won', 'lost', 'no-bid', 'submitted'])
  const activeBids = bids.filter(b => !CLOSED.has((b.status || '').toLowerCase()))

  const urgentDeadlines = opportunities.filter(o =>
    o.deadlineAt && new Date(o.deadlineAt).getTime() - Date.now() <= 7 * 24 * 60 * 60 * 1000
  ).length

  const now = new Date()

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting(now)}, Pavan`}
        description={todayLabel(now)}
        actions={
          <div className="flex items-center gap-2 text-sm">
            <HealthDot status={overallHealth} />
            <span className="text-muted-foreground">{healthLabel}</span>
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
          label="Opportunities"
          value={opportunities.length}
          subtitle={urgentDeadlines > 0 ? `${urgentDeadlines} due this week` : 'Open, from scans'}
          valueColor={urgentDeadlines > 0 ? 'text-status-danger' : undefined}
        />
        <DataCard
          label="Active bids"
          value={activeBids.length}
          subtitle="In flight"
        />
        <DataCard
          label="Intel this week"
          value={intelThisWeek}
          subtitle="New scans & alerts"
        />
      </div>

      {/* Decisions — top of the page, the highest-leverage action */}
      <DecisionsCard decisions={decisions} />

      {/* Opportunity deadlines from procurement scans */}
      <OpportunitiesCard items={opportunities} />

      {/* Agents — what your workforce did last 24h, including failures */}
      <AgentsSummaryCard summaries={agentSummaries} />

      {/* Active bids kanban with inline triage */}
      <ActiveBidsKanban bids={activeBids} />

      {/* Action queue from partnership next-actions */}
      <ActionQueueCard items={actionQueue} />

      {/* Priority outreach */}
      <PriorityOutreachCard items={outreach.items} updatedAt={outreach.updatedAt} />

      {/* Morning actions from overnight scans (hidden until something generates them) */}
      <MorningActionsCard content={morningActions} />

      {/* Is the automation feeding this page still alive? */}
      <FreshnessCard sources={freshness} />
    </div>
  )
}
