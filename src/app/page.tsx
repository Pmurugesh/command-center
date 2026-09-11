/**
 * Today — the CEO screen.
 *
 * Answers, in order:
 *  - Am I on pace against the campaign I declared? (scoreboard)
 *  - What is the single highest-leverage thing to do next? (Today's Moves —
 *    one ranked queue: strategic decisions, artifact blockers, bid flags,
 *    due touches, closing deadlines)
 *  - What is dated in the next two weeks? (the Clock)
 *  - Who needs me, who did I delegate to, and is any channel going dark?
 *  - Below the fold, collapsed: what changed, and is the machine healthy.
 *
 * Same route (/), so existing bookmarks still land here.
 */

import { listBids, getPipelineFreshness } from '@/lib/files'
import { getBuckets } from '@/lib/crm'
import { getInsights } from '@/lib/insights'
import { getCampaignScore, getStrategicDecisions } from '@/lib/gtm'
import { listChannels, channelAlerts } from '@/lib/channels'
import { buildMoves, buildWaitingOn } from '@/lib/moves'
import { listContacts, hasBeenWorked } from '@/lib/crm'
import { getNormalizedCronJobs } from '@/lib/shell'
import { isFailing } from '@/lib/cron'
import { getOpenOpportunities } from '@/lib/procurements'
import { getUpcomingMeetings } from '@/lib/calendar'
import { getDecisionQueue } from '@/lib/decisions'
import { getAgent24hSummary } from '@/lib/agents'
import { listLeads } from '@/lib/leads'
import { buildClock } from '@/lib/clock'
import { listRoadmap, roadmapAlerts, allMilestones, roadmapDemandSignals } from '@/lib/roadmap'
import { PageHeader } from '@/components/shared/page-header'
import { HealthDot } from '@/components/shared/status-badge'
import { Scoreboard } from '@/components/today/scoreboard'
import { MovesCard } from '@/components/today/moves-card'
import { ClockCard } from '@/components/today/clock-card'
import { ActiveBidsList } from '@/components/today/active-bids-list'
import { ChannelsHealthCard } from '@/components/today/channels-health-card'
import { WaitingOnCard } from '@/components/today/waiting-on-card'
import { PipelineBuckets } from '@/components/today/pipeline-buckets'
import { ShapeCompact } from '@/components/today/shape-compact'
import { ChangesFeed } from '@/components/today/changes-feed'
import { MachineRoom } from '@/components/today/machine-room'

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
  const [bids, score, cron, decisions, agentSummaries, strategic,
         channels, opportunities, freshness, buckets, insights, calendar, leads, contacts,
         roadmapRows] = await Promise.all([
    listBids(),
    getCampaignScore().catch(() => ({ targets: null, meetingsHeld: 0, demosGiven: 0, bidsSubmitted: 0, daysLeft: null })),
    getNormalizedCronJobs().catch(() => ({ reachable: false, jobs: [] })),
    getDecisionQueue().catch(() => []),
    getAgent24hSummary().catch(() => []),
    getStrategicDecisions().catch(() => []),
    listChannels().catch(() => []),
    getOpenOpportunities().catch(() => []),
    getPipelineFreshness().catch(() => []),
    getBuckets().catch(() => ({ overdue: [], blocked: [], dueToday: [], goingCold: [], notStarted: [], byAgency: [], sourcedCount: 0, total: 0 })),
    getInsights().catch(() => null),
    getUpcomingMeetings().catch(() => ({ configured: true, meetings: [], errors: ['calendar lookup failed'] })),
    listLeads().catch(() => []),
    listContacts().catch(() => []),
    listRoadmap().catch(() => []),
  ])

  // Today reads MILESTONES, not rows. A row is a north star and never moves;
  // what slips, goes at-risk or sits stranded is always a milestone under it.
  const roadmap = allMilestones(roadmapRows)

  // Demand reads the LIVE CRM, not `_status.md`: the status file holds a pull
  // snapshot with no history, so "who just got warm" is not derivable from it.
  const roadmapDemand = roadmapDemandSignals(
    roadmapRows,
    contacts.map(c => ({
      name: c.name, product: c.product, interestedIn: c.interestedIn, stage: c.stage,
      lastTouched: c.lastTouched, worked: hasBeenWorked(c),
    })),
  )

  // The merge that used to happen in Pavan's head: one ranked queue.
  const moves = buildMoves({
    strategic,
    bidDecisions: decisions,
    blockers: insights?.blockers ?? [],
    buckets,
    opportunities,
    channels: channelAlerts(channels),
    roadmap: roadmapAlerts(roadmap),
    roadmapDemand,
  })

  // Everything dated in the next 14 days — meetings and deadlines, one agenda.
  const clock = buildClock({ meetings: calendar.meetings, bids, opportunities, leads, roadmap })

  // Delegation: live next-actions owned by people other than Pavan.
  const waiting = buildWaitingOn(contacts)

  const failingJobs = cron.jobs.filter(isFailing)
  const persistentFailure = failingJobs.some(j => j.consecutiveErrors >= 2)

  // The health dot answers "is the automation running?" — codebase findings and
  // open decisions have their own cards and shouldn't keep the dot red forever.
  // Unreachable openclaw means the automation state is UNKNOWN. Reporting that
  // as green is the worst possible failure for a monitoring dashboard: it goes
  // reassuring at the exact moment it stops being able to see anything.
  const overallHealth: 'green' | 'yellow' | 'red' =
    !cron.reachable ? 'red' :
    persistentFailure || failingJobs.length >= 2 ? 'red' :
    failingJobs.length > 0 ? 'yellow' :
    'green'

  const healthLabel =
    !cron.reachable ? "Can't reach openclaw" :
    failingJobs.length === 0 ? 'Automation healthy' :
    failingJobs.length === 1 ? `1 job failing: ${failingJobs[0].name}` :
    `${failingJobs.length} jobs failing`

  // Active bids = anything not in a closed state.
  const CLOSED = new Set(['won', 'lost', 'no-bid', 'submitted'])
  const activeBids = bids.filter(b => !CLOSED.has((b.status || '').toLowerCase()))

  const now = new Date()

  return (
    <div className="space-y-4">
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
          selling, and am I on pace?" outranks every other number on the page,
          so it keeps the full width as a tile strip. */}
      <Scoreboard momentum={insights?.momentum ?? null} score={score} />

      {/* Two-column working area. Reading order is preserved: the ranked queue
          stays top-left, where the eye lands. The rail carries the dated and
          the delegated — context you check against the queue, not instead of
          it. Stacking these cost ~2,400px of scroll for rows whose content
          never exceeded ~520px. See tasks/todo.md Phase 14. */}
      {/* min-w-0 on both columns: a grid item defaults to min-width:auto, so one
          `truncate` line (nowrap) sized the whole column to its text — 1,435px on
          a 375px phone, clipping every row's action buttons off-screen. */}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="min-w-0 space-y-4 xl:col-span-2">
          {/* The single ranked queue: strategic decisions, artifact blockers,
              bid flags, due touches, closing deadlines — leverage-ranked. */}
          <MovesCard moves={moves} />

          {/* Who needs you, ranked. A blocked or overdue contact outranks
              any report. */}
          <PipelineBuckets buckets={buckets} />

          {/* Active bids — compact; the full table lives on /bids */}
          <ActiveBidsList bids={activeBids} />
        </div>

        <div className="min-w-0 space-y-4">
          {/* The clock — meetings, bid deadlines and scored solicitations for
              the next two weeks, one agenda */}
          <ClockCard items={clock} calendarConfigured={calendar.configured} calendarErrors={calendar.errors} />

          {/* Waiting on — what's delegated, to whom, and what's stuck */}
          <WaitingOnCard groups={waiting} />

          {/* Channels going dark — renders only when a vehicle/partner is
              blocked or cold (the SLP failure class) */}
          <ChannelsHealthCard alerts={channelAlerts(channels)} />

          {/* Pipeline shape — stage funnel, owner load, product concentration */}
          {insights && <ShapeCompact shape={insights.shape} />}
        </div>
      </div>

      {/* Below the queue: what changed, and is the machine healthy. Both are
          full-width strips that stay collapsed unless something is red. */}
      <ChangesFeed />

      <MachineRoom
        summaries={agentSummaries}
        freshness={freshness}
        health={insights?.health ?? []}
        failingJobs={failingJobs.length}
      />
    </div>
  )
}
