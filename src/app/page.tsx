/**
 * Today — the morning home.
 *
 * Answers, in order:
 *  - Am I actually selling? (daily brief: momentum, leverage, pipeline shape,
 *    machine health)
 *  - What changed since I last looked? (exact, from git)
 *  - Who needs me now? (CRM buckets: blocked / overdue / due today / going cold)
 *  - What needs a decision? (bid decisions, opportunity deadlines)
 *  - What did the agents do overnight, and is the automation still alive?
 *
 * Same route (/), so existing bookmarks still land here.
 */

import { listBids, listIntelAlerts, getActionQueue, getMorningActions, getPipelineFreshness } from '@/lib/files'
import { getBuckets } from '@/lib/crm'
import { getInsights } from '@/lib/insights'
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
import { MorningActionsCard } from '@/components/today/morning-actions-card'
import { OpportunitiesCard } from '@/components/today/opportunities-card'
import { FreshnessCard } from '@/components/today/freshness-card'
import { PipelineBuckets } from '@/components/today/pipeline-buckets'
import { DailyBrief } from '@/components/today/daily-brief'
import { ChangesFeed } from '@/components/today/changes-feed'

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
  const [bids, alerts, cronJobs, decisions, agentSummaries, actionQueue,
         morningActions, opportunities, freshness, buckets, insights] = await Promise.all([
    listBids(),
    listIntelAlerts(),
    getNormalizedCronJobs().catch(() => []),
    getDecisionQueue().catch(() => []),
    getAgent24hSummary().catch(() => []),
    getActionQueue().catch(() => []),
    getMorningActions().catch(() => ''),
    getOpenOpportunities().catch(() => []),
    getPipelineFreshness().catch(() => []),
    getBuckets().catch(() => ({ overdue: [], blocked: [], dueToday: [], goingCold: [], notStarted: [], sourcedCount: 0, total: 0 })),
    getInsights().catch(() => null),
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

      {/* Daily brief — momentum first: this page exists to answer "am I
          actually selling?", and that number outranks everything else. */}
      {insights && <DailyBrief insights={insights} />}

      {/* What changed since this browser last looked */}
      <ChangesFeed />

      {/* Pipeline — who needs you, ranked. A blocked or overdue contact
          outranks any report. */}
      <PipelineBuckets buckets={buckets} />

      {/* Decisions — highest-leverage bid action */}
      <DecisionsCard decisions={decisions} />

      {/* Opportunity deadlines from procurement scans */}
      <OpportunitiesCard items={opportunities} />

      {/* Agents — what your workforce did last 24h, including failures */}
      <AgentsSummaryCard summaries={agentSummaries} />

      {/* Active bids kanban with inline triage */}
      <ActiveBidsKanban bids={activeBids} />

      {/* Action queue from partnership next-actions */}
      <ActionQueueCard items={actionQueue} />

      {/* Morning actions from overnight scans (hidden until something generates them) */}
      <MorningActionsCard content={morningActions} />

      {/* Is the automation feeding this page still alive? */}
      <FreshnessCard sources={freshness} />
    </div>
  )
}
