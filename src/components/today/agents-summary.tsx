import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TimeAgo } from '@/components/shared/time-ago'
import { ArrowRight, Bot } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AgentSummary } from '@/lib/agents'

interface AgentsSummaryCardProps {
  summaries: AgentSummary[]
}

export function AgentsSummaryCard({ summaries }: AgentsSummaryCardProps) {
  const totalRuns = summaries.reduce((s, a) => s + a.runs, 0)
  // Failing = jobs currently in error state, not just failures inside the 24h
  // window — a job that broke yesterday and hasn't recovered still counts.
  const totalFailed = summaries.reduce((s, a) => s + Math.max(a.failed, a.failures.length), 0)
  const totalOutputs = summaries.reduce((s, a) => s + a.outputsTouched, 0)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="h-4 w-4" />
            Agents · last 24h
            {summaries.length > 0 && (
              <Badge variant="outline" className="text-[10px] font-mono tabular-nums">
                {summaries.length}
              </Badge>
            )}
          </CardTitle>
          <Link href="/system/agents" className="text-xs text-blue-400 hover:underline inline-flex items-center gap-1">
            Workforce <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        {summaries.length > 0 && (
          <p className="text-xs text-muted-foreground mt-1">
            <span className="font-mono tabular-nums text-foreground">{totalRuns}</span> runs ·{' '}
            <span className={cn('font-mono tabular-nums', totalFailed > 0 ? 'text-status-danger' : 'text-foreground')}>
              {totalFailed}
            </span> failed ·{' '}
            <span className="font-mono tabular-nums text-foreground">{totalOutputs}</span> outputs touched
          </p>
        )}
      </CardHeader>
      <CardContent>
        {summaries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No agents detected. Run <code className="font-mono text-foreground bg-muted px-1.5 py-0.5 rounded text-xs">openclaw agents list</code> to verify.</p>
        ) : (
          <ul className="divide-y divide-border">
            {summaries.map(s => <AgentRow key={s.agentId} summary={s} />)}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function AgentRow({ summary: s }: { summary: AgentSummary }) {
  // Dot colour: red if anything failed, amber if no recent activity, green if active.
  const dotClass =
    s.failed > 0 || s.failures.length > 0 ? 'bg-status-danger' :
    s.runs > 0 || s.outputsTouched > 0 ? 'bg-status-success' :
    'bg-muted-foreground/40'

  return (
    <li className="py-2 first:pt-0 last:pb-0 flex items-center gap-3">
      <span className={cn('h-2 w-2 rounded-full flex-shrink-0', dotClass)} />
      <span className="text-lg flex-shrink-0" aria-hidden="true">{s.emoji || '🤖'}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{s.agentName || s.agentId}</span>
          {s.lastActivityAt && (
            <span className="text-xs text-muted-foreground"><TimeAgo date={s.lastActivityAt} /></span>
          )}
        </div>
        <div className="text-xs text-muted-foreground flex items-center gap-3">
          {s.runs > 0 && (
            <span><span className="font-mono tabular-nums text-foreground">{s.runs}</span> run{s.runs === 1 ? '' : 's'}</span>
          )}
          {s.failed > 0 && (
            <span className="text-status-danger">
              <span className="font-mono tabular-nums">{s.failed}</span> failed
            </span>
          )}
          {s.outputsTouched > 0 && (
            <span><span className="font-mono tabular-nums text-foreground">{s.outputsTouched}</span> output{s.outputsTouched === 1 ? '' : 's'} touched</span>
          )}
          {s.runs === 0 && s.outputsTouched === 0 && s.failures.length === 0 && (
            <span className="text-muted-foreground/70">idle in the last 24h</span>
          )}
        </div>
        {s.failures.map(f => (
          <p key={f.jobName} className="text-xs text-status-danger mt-1 truncate">
            {f.jobName}
            {f.consecutiveErrors > 1 && <span className="font-mono tabular-nums"> ×{f.consecutiveErrors}</span>}
            {f.error && <span className="text-status-danger/80"> — {f.error}</span>}
          </p>
        ))}
      </div>
    </li>
  )
}
