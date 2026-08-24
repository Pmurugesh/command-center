import Link from 'next/link'
import { HeartPulse, ChevronRight } from 'lucide-react'
import { AgentsSummaryCard } from '@/components/today/agents-summary'
import { FreshnessCard } from '@/components/today/freshness-card'
import type { HealthItem } from '@/lib/insights'
import type { PipelineFreshness } from '@/lib/files'
import type { AgentSummary } from '@/lib/agents'

function staleDays(f: PipelineFreshness): number | null {
  if (!f.lastUpdated) return null
  return Math.floor((Date.now() - new Date(f.lastUpdated).getTime()) / 86_400_000)
}

/**
 * The machine room: agents, pipeline freshness, and the system's own vitals,
 * folded into ONE collapsed section at the bottom of Today. Monitoring is not
 * deciding — a green machine earns a single quiet line, and only a red state
 * opens the panel on its own (server-computed <details open>, zero client JS).
 * The health dot in the page header still carries the glanceable signal.
 */
export function MachineRoom({ summaries, freshness, health, failingJobs }: {
  summaries: AgentSummary[]
  freshness: PipelineFreshness[]
  health: HealthItem[]
  failingJobs: number
}) {
  const agentFailures = summaries.reduce((n, s) => n + s.failed, 0)
  const badHealth = health.filter(h => h.status === 'bad').length
  const staleFeeds = freshness.filter(f => {
    const d = staleDays(f)
    return f.lastUpdated === null || (d !== null && d >= f.staleAfterDays)
  }).length

  const isRed = failingJobs > 0 || agentFailures > 0 || badHealth > 0 || staleFeeds > 0
  const problems = [
    failingJobs > 0 && `${failingJobs} cron job${failingJobs > 1 ? 's' : ''} failing`,
    agentFailures > 0 && `${agentFailures} agent failure${agentFailures > 1 ? 's' : ''}`,
    staleFeeds > 0 && `${staleFeeds} stale feed${staleFeeds > 1 ? 's' : ''}`,
    badHealth > 0 && `${badHealth} health check${badHealth > 1 ? 's' : ''} red`,
  ].filter(Boolean)

  const dot = { ok: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-red-500' }

  return (
    <details open={isRed} className="group rounded-lg border border-border bg-card">
      <summary className="flex cursor-pointer select-none items-center gap-2 px-6 py-3 text-sm text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" />
        <HeartPulse className="h-4 w-4 shrink-0" />
        <span className="font-medium">Machine room</span>
        <span className={`h-2 w-2 shrink-0 rounded-full ${isRed ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'}`} />
        <span className="truncate text-xs">
          {isRed ? problems.join(' · ') : 'agents, feeds, and health all green'}
        </span>
      </summary>
      <div className="space-y-4 border-t border-border px-6 py-4">
        {health.length > 0 && (
          <div className="grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2">
            {health.map(h => (
              <div key={h.label} className="flex items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${dot[h.status]}`} />
                <span className="text-sm">{h.label}</span>
                <span className="ml-auto truncate text-xs text-muted-foreground">{h.detail}</span>
              </div>
            ))}
          </div>
        )}
        <AgentsSummaryCard summaries={summaries} />
        <FreshnessCard sources={freshness} />
        <Link href="/system" className="inline-block text-xs text-blue-400 hover:underline">
          System detail →
        </Link>
      </div>
    </details>
  )
}
