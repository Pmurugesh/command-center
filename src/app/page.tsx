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

import { listBids, getActionQueue, getMorningActions, getPipelineFreshness } from '@/lib/files'
import { getBuckets } from '@/lib/crm'
import { getInsights } from '@/lib/insights'
import { getCampaignScore } from '@/lib/gtm'
import { getNormalizedCronJobs } from '@/lib/shell'
import { isFailing } from '@/lib/cron'
import { getOpenOpportunities } from '@/lib/procurements'
import { getUpcomingMeetings } from '@/lib/calendar'
import { getDecisionQueue } from '@/lib/decisions'
import { getAgent24hSummary } from '@/lib/agents'
import { PageHeader } from '@/components/shared/page-header'
import { HealthDot } from '@/components/shared/status-badge'
import { Scoreboard } from '@/components/today/scoreboard'
import { DecisionsCard } from '@/components/today/decisions-card'
import { AgentsSummaryCard } from '@/components/today/agents-summary'
import { ActiveBidsKanban } from '@/components/today/active-bids-kanban'
import { ActionQueueCard } from '@/components/today/action-queue-card'
import { MorningActionsCard } from '@/components/today/morning-actions-card'
import { OpportunitiesCard } from '@/components/today/opportunities-card'
import { FreshnessCard } from '@/components/today/freshness-card'
import { PipelineBuckets } from '@/components/today/pipeline-buckets'
import { UpcomingMeetingsCard } from '@/components/today/upcoming-meetings-card'
import { LeverageCard, ShapeCard, HealthCard } from '@/components/today/daily-brief'
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
  const [bids, score, cronJobs, decisions, agentSummaries, actionQueue,
         morningActions, opportunities, freshness, buckets, insights, calendar] = await Promise.all([
    listBids(),
    getCampaignScore().catch(() => ({ targets: null, meetingsHeld: 0, demosGiven: 0, daysLeft: null })),
    getNormalizedCronJobs().catch(() => []),
    getDecisionQueue().catch(() => []),
    getAgent24hSummary().catch(() => []),
    getActionQueue().catch(() => []),
    getMorningActions().catch(() => ''),
    getOpenOpportunities().catch(() => []),
    getPipelineFreshness().catch(() => []),
    getBuckets().catch(() => ({ overdue: [], blocked: [], dueToday: [], goingCold: [], notStarted: [], sourcedCount: 0, total: 0 })),
    getInsights().catch(() => null),
    getUpcomingMeetings().catch(() => ({ configured: true, meetings: [], errors: ['calendar lookup failed'] })),
  ])

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

      {/* Scoreboard — progress against the declared campaign. "Am I actually
          selling, and am I on pace?" outranks every other number on the page. */}
      <Scoreboard momentum={insights?.momentum ?? null} score={score} />

      {/* Brief remnants — being decomposed into Moves / Shape / Machine Room */}
      {insights && (
        <div className="grid gap-4 lg:grid-cols-2">
          <LeverageCard blockers={insights.blockers} />
          <ShapeCard shape={insights.shape} />
        </div>
      )}
      {insights && <HealthCard health={insights.health} />}

      {/* What changed since this browser last looked */}
      <ChangesFeed />

      {/* Scheduled time — demos and meetings on the calendar, next two weeks */}
      <UpcomingMeetingsCard result={calendar} />

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
