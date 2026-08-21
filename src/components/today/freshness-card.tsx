import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { TimeAgo } from '@/components/shared/time-ago'
import { Activity } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PipelineFreshness } from '@/lib/files'

function ageDays(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000)
}

/**
 * One row per data pipeline: when it last produced output, colored against its
 * expected cadence. Makes a silently-dead pipeline look broken instead of calm.
 */
export function FreshnessCard({ sources }: { sources: PipelineFreshness[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4" />
          Pipeline freshness
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="divide-y divide-border">
          {sources.map(s => {
            const days = s.lastUpdated ? ageDays(s.lastUpdated) : Infinity
            const dotClass =
              days >= s.staleAfterDays ? 'bg-status-danger' :
              days >= s.warnAfterDays  ? 'bg-status-warning' :
              'bg-status-success'
            return (
              <li key={s.label} className="py-2 first:pt-0 last:pb-0 flex items-center gap-3">
                <span className={cn('h-2 w-2 rounded-full flex-shrink-0', dotClass)} />
                <Link href={s.href} className="text-sm flex-1 min-w-0 truncate hover:underline">
                  {s.label}
                </Link>
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  {s.lastUpdated ? <TimeAgo date={s.lastUpdated} /> : 'no output yet'}
                </span>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
