import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CalendarDays, MapPin, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CalendarResult, Meeting } from '@/lib/calendar'
import { LOOKAHEAD_DAYS } from '@/lib/calendar'

const MAX_ROWS = 8

function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return dayKey(iso)
}

function timeLabel(m: Meeting): string {
  if (m.allDay) return 'All day'
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return m.endAt ? `${fmt(m.startAt)} – ${fmt(m.endAt)}` : fmt(m.startAt)
}

/**
 * The next two weeks of scheduled meetings, demos flagged. Fed by Google
 * Calendar secret iCal URLs (see lib/calendar.ts) — until those are
 * configured the card says exactly how to connect one, because a card that
 * silently renders nothing is how features get presumed broken.
 */
export function UpcomingMeetingsCard({ result }: { result: CalendarResult }) {
  const { configured, meetings, errors } = result
  const demos = meetings.filter(m => m.isDemo).length

  // Group into day sections so the card reads as an agenda.
  const byDay = new Map<string, Meeting[]>()
  for (const m of meetings.slice(0, MAX_ROWS)) {
    const key = dayKey(m.startAt)
    byDay.set(key, [...(byDay.get(key) ?? []), m])
  }

  return (
    <Card className={demos > 0 ? 'border-blue-500/30' : undefined}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarDays className="h-4 w-4" />
          Upcoming meetings
          {meetings.length > 0 && (
            <Badge variant="outline" className="text-[10px] font-mono tabular-nums">{meetings.length}</Badge>
          )}
          {demos > 0 && (
            <Badge className="text-[10px] bg-blue-500/10 text-blue-400 border-blue-500/30">
              {demos} demo{demos > 1 ? 's' : ''}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {errors.length > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-status-warning">
            <AlertTriangle className="h-3.5 w-3.5 mt-px flex-shrink-0" />
            <span>Feed unreachable — {errors.join('; ')}. The secret iCal URL may have been reset.</span>
          </p>
        )}
        {!configured ? (
          <p className="text-sm text-muted-foreground">
            Not connected. Paste each calendar&apos;s secret iCal address (Google Calendar →
            Settings → Integrate calendar) into{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">~/.openclaw/workspace/.credentials/calendar.json</code>{' '}
            as <code className="text-xs bg-muted px-1 py-0.5 rounded">{'{ "icsUrls": ["…"] }'}</code>.
          </p>
        ) : meetings.length === 0 && errors.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing scheduled in the next {LOOKAHEAD_DAYS} days.
          </p>
        ) : (
          Array.from(byDay.entries()).map(([key, dayMeetings]) => (
            <div key={key}>
              <p className="text-xs font-medium text-muted-foreground mb-1">
                {dayLabel(dayMeetings[0].startAt)}
              </p>
              <ul className="divide-y divide-border">
                {dayMeetings.map(m => (
                  <li key={m.uid} className="py-2 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className={cn('text-sm font-medium truncate', m.isDemo && 'text-blue-400')}>
                            {m.title}
                          </p>
                          {m.isDemo && (
                            <Badge className="text-[10px] flex-shrink-0 bg-blue-500/10 text-blue-400 border-blue-500/30">
                              demo
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5 flex items-center gap-1">
                          <span>{m.calendar}</span>
                          {m.location && (
                            <>
                              <span>·</span>
                              <MapPin className="h-3 w-3 flex-shrink-0" />
                              <span className="truncate">{m.location}</span>
                            </>
                          )}
                        </p>
                      </div>
                      <span className="flex-shrink-0 text-xs font-mono tabular-nums text-muted-foreground whitespace-nowrap">
                        {timeLabel(m)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
        {meetings.length > MAX_ROWS && (
          <p className="text-xs text-muted-foreground text-center border border-dashed border-border rounded-md p-2">
            +{meetings.length - MAX_ROWS} more in the next {LOOKAHEAD_DAYS} days
          </p>
        )}
      </CardContent>
    </Card>
  )
}
