import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CalendarClock, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CLOCK_WINDOW_DAYS, type ClockItem } from '@/lib/clock'

const MAX_ROWS = 10

function dayKey(iso: string): string {
  return new Date(iso).toDateString()
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function timeLabel(item: ClockItem): string {
  if (item.allDay) return 'All day'
  if (item.kind !== 'meeting') return 'due'
  return new Date(item.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

const KIND_CHIP: Record<Exclude<ClockItem['kind'], 'meeting'>, string> = {
  bid: 'bid',
  opportunity: 'scan',
  lead: 'lead',
}

function Row({ item }: { item: ClockItem }) {
  const body = (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {item.score !== undefined && (
            <span className={cn(
              'shrink-0 font-mono text-xs tabular-nums',
              item.score >= 8 ? 'text-status-danger' : item.score >= 6 ? 'text-status-warning' : 'text-muted-foreground'
            )}>
              {item.score}/10
            </span>
          )}
          <p className={cn('truncate text-sm font-medium', item.isDemo && 'text-blue-400')}>{item.title}</p>
          {item.isDemo && (
            <Badge className="shrink-0 border-blue-500/30 bg-blue-500/10 text-[10px] text-blue-400">demo</Badge>
          )}
          {item.kind !== 'meeting' && (
            <Badge variant="outline" className="shrink-0 text-[10px]">{KIND_CHIP[item.kind]}</Badge>
          )}
        </div>
        {item.subtitle && <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.subtitle}</p>}
      </div>
      <span className="shrink-0 whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">
        {timeLabel(item)}
      </span>
    </div>
  )
  return (
    <li className="py-2 first:pt-0 last:pb-0">
      {item.href ? <Link href={item.href} className="block transition-colors hover:text-blue-400">{body}</Link> : body}
    </li>
  )
}

/**
 * The Clock: everything dated in the next two weeks — meetings, bid response
 * deadlines, scored solicitations, lead end-dates — as one agenda. Replaces
 * the separate meetings and opportunities cards; a deadline and a demo on the
 * same day should be one glance, not an assembly job.
 */
export function ClockCard({ items, calendarConfigured, calendarErrors }: {
  items: ClockItem[]
  calendarConfigured: boolean
  calendarErrors: string[]
}) {
  const demos = items.filter(i => i.isDemo).length
  const deadlines = items.filter(i => i.kind !== 'meeting').length

  const visible = items.slice(0, MAX_ROWS)
  const byDay = new Map<string, ClockItem[]>()
  for (const item of visible) {
    const key = dayKey(item.at)
    byDay.set(key, [...(byDay.get(key) ?? []), item])
  }

  return (
    <Card className={demos > 0 ? 'border-blue-500/30' : undefined}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4" />
          Next {CLOCK_WINDOW_DAYS} days
          {items.length > 0 && (
            <Badge variant="outline" className="font-mono text-[10px] tabular-nums">{items.length}</Badge>
          )}
          {demos > 0 && (
            <Badge className="border-blue-500/30 bg-blue-500/10 text-[10px] text-blue-400">
              {demos} demo{demos > 1 ? 's' : ''}
            </Badge>
          )}
          {deadlines > 0 && (
            <Badge variant="outline" className="font-mono text-[10px] tabular-nums">
              {deadlines} deadline{deadlines > 1 ? 's' : ''}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {calendarErrors.length > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-status-warning">
            <AlertTriangle className="mt-px h-3.5 w-3.5 flex-shrink-0" />
            <span>Calendar feed unreachable — {calendarErrors.join('; ')}. The secret iCal URL may have been reset.</span>
          </p>
        )}
        {!calendarConfigured && (
          <p className="text-xs text-muted-foreground">
            Calendar not connected — deadlines only. Paste each calendar&apos;s secret iCal address
            (Google Calendar → Settings → Integrate calendar) into{' '}
            <code className="break-all rounded bg-muted px-1 py-0.5 text-xs">~/.openclaw/workspace/.credentials/calendar.json</code>{' '}
            as <code className="rounded bg-muted px-1 py-0.5 text-xs">{'{ "icsUrls": ["…"] }'}</code>.
          </p>
        )}
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing dated in the next {CLOCK_WINDOW_DAYS} days.
          </p>
        ) : (
          Array.from(byDay.values()).map(dayItems => (
            <div key={dayKey(dayItems[0].at)}>
              <p className="mb-1 text-xs font-medium text-muted-foreground">{dayLabel(dayItems[0].at)}</p>
              <ul className="divide-y divide-border">
                {dayItems.map(item => <Row key={item.id} item={item} />)}
              </ul>
            </div>
          ))
        )}
        {items.length > MAX_ROWS && (
          <p className="rounded-md border border-dashed border-border p-2 text-center text-xs text-muted-foreground">
            +{items.length - MAX_ROWS} more in the next {CLOCK_WINDOW_DAYS} days
          </p>
        )}
      </CardContent>
    </Card>
  )
}
