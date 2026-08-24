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
import { listContacts } from '@/lib/crm'
import { getNormalizedCronJobs } from '@/lib/shell'
import { isFailing } from '@/lib/cron'
import { getOpenOpportunities } from '@/lib/procurements'
import { getUpcomingMeetings } from '@/lib/calendar'
import { getDecisionQueue } from '@/lib/decisions'
import { getAgent24hSummary } from '@/lib/agents'
import { listLeads } from '@/lib/leads'
import { buildClock } from '@/lib/clock'
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
  const [bids, score, cronJobs, decisions, agentSummaries, strategic,
         channels, opportunities, freshness, buckets, insights, calendar, leads, contacts] = await Promise.all([
    listBids(),
    getCampaignScore().catch(() => ({ targets: null, meetingsHeld: 0, demosGiven: 0, daysLeft: null })),
    getNormalizedCronJobs().catch(() => []),
    getDecisionQueue().catch(() => []),
    getAgent24hSummary().catch(() => []),
    getStrategicDecisions().catch(() => []),
    listChannels().catch(() => []),
    getOpenOpportunities().catch(() => []),
    getPipelineFreshness().catch(() => []),
    getBuckets().catch(() => ({ overdue: [], blocked: [], dueToday: [], goingCold: [], notStarted: [], sourcedCount: 0, total: 0 })),
    getInsights().catch(() => null),
    getUpcomingMeetings().catch(() => ({ configured: true, meetings: [], errors: ['calendar lookup failed'] })),
    listLeads().catch(() => []),
    listContacts().catch(() => []),
  ])

  // The merge that used to happen in Pavan's head: one ranked queue.
  const moves = buildMoves({
    strategic,
    bidDecisions: decisions,
    blockers: insights?.blockers ?? [],
    buckets,
    opportunities,
    channels: channelAlerts(channels),
  })

  // Everything dated in the next 14 days — meetings and deadlines, one agenda.
  const clock = buildClock({ meetings: calendar.meetings, bids, opportunities, leads })

  // Delegation: live next-actions owned by people other than Pavan.
  const waiting = buildWaitingOn(contacts)

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

      {/* Today's moves — the single ranked queue. Strategic decisions,
          artifact blockers, bid flags, due touches, closing deadlines: merged
          and leverage-ranked so the top row is the day's highest-value action. */}
      <MovesCard moves={moves} />

      {/* The clock — meetings, bid deadlines, and scored solicitations for
          the next two weeks, one agenda */}
      <ClockCard items={clock} calendarConfigured={calendar.configured} calendarErrors={calendar.errors} />

      {/* Pipeline — who needs you, ranked. A blocked or overdue contact
          outranks any report. */}
      <PipelineBuckets buckets={buckets} />

      {/* Active bids — compact; the kanban lives on /bids */}
      <ActiveBidsList bids={activeBids} />

      {/* Waiting on — what's delegated, to whom, and what's stuck */}
      <WaitingOnCard groups={waiting} />

      {/* Channels going dark — renders only when a vehicle/partner is blocked
          or cold (the SLP failure class) */}
      <ChannelsHealthCard alerts={channelAlerts(channels)} />

      {/* Pipeline shape — stage funnel, owner load, product concentration */}
      {insights && <ShapeCompact shape={insights.shape} />}

      {/* What changed since this browser last looked — one line, expandable */}
      <ChangesFeed />

      {/* Machine room — agents, feeds, health. Collapsed unless something is
          red; the header dot carries the green-state signal. */}
      <MachineRoom
        summaries={agentSummaries}
        freshness={freshness}
        health={insights?.health ?? []}
        failingJobs={failingJobs.length}
      />
    </div>
  )
}
