import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ArrowRight, Target } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Opportunity } from '@/lib/procurements'

const MAX_ROWS = 6

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
}

function DeadlineBadge({ deadlineAt }: { deadlineAt?: string }) {
  if (!deadlineAt) {
    return <span className="text-xs text-muted-foreground">no deadline listed</span>
  }
  const days = daysUntil(deadlineAt)
  const label = new Date(deadlineAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return (
    <span className={cn(
      'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap font-mono tabular-nums',
      days <= 7  ? 'bg-status-danger/10 text-status-danger border-status-danger/30' :
      days <= 14 ? 'bg-status-warning/10 text-status-warning border-status-warning/30' :
                   'bg-muted text-muted-foreground border-border'
    )}>
      {label} · {days}d
    </span>
  )
}

/**
 * Open procurement opportunities pulled from the daily CaleProcure scans,
 * soonest deadline first. This is the "what needs me right now" card — the
 * scans were already finding these; they were just buried in collapsed
 * markdown under /intel.
 */
export function OpportunitiesCard({ items }: { items: Opportunity[] }) {
  const urgent = items.filter(o => o.deadlineAt && daysUntil(o.deadlineAt) <= 7).length

  return (
    <Card className={urgent > 0 ? 'border-status-danger/30' : undefined}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-4 w-4" />
            Open opportunities
            {items.length > 0 && (
              <Badge variant="outline" className="text-[10px] font-mono tabular-nums">{items.length}</Badge>
            )}
            {urgent > 0 && (
              <Badge variant="destructive" className="text-[10px]">{urgent} due this week</Badge>
            )}
          </CardTitle>
          <Link href="/intel" className="text-xs text-blue-400 hover:underline inline-flex items-center gap-1">
            Procurement scans <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No open opportunities in recent procurement scans.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {items.slice(0, MAX_ROWS).map(o => (
              <li key={o.eventId} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {o.score !== undefined && (
                        <span className={cn(
                          'text-xs font-mono tabular-nums flex-shrink-0',
                          o.score >= 8 ? 'text-status-danger' : o.score >= 6 ? 'text-status-warning' : 'text-muted-foreground'
                        )}>
                          {o.score}/10
                        </span>
                      )}
                      <p className="text-sm font-medium truncate">{o.title}</p>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {[o.department, o.entity && `→ ${o.entity}`].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="flex-shrink-0">
                    <DeadlineBadge deadlineAt={o.deadlineAt} />
                  </div>
                </div>
                {o.action && (
                  <p className="text-xs text-muted-foreground/80 mt-1 line-clamp-1">{o.action}</p>
                )}
              </li>
            ))}
          </ul>
        )}
        {items.length > MAX_ROWS && (
          <Link href="/intel" className="mt-2 flex items-center justify-center rounded-md border border-dashed border-border p-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
            +{items.length - MAX_ROWS} more in procurement scans
          </Link>
        )}
      </CardContent>
    </Card>
  )
}
