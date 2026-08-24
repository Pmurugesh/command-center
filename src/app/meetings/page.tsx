/**
 * Meetings — the Granola-fed archive, newest first, grouped by month.
 * Every business meeting the sync captured: agency threads, partnerships,
 * GTM/procurement, product, and ops sessions.
 */
import Link from 'next/link'
import { listMeetings, type MeetingRecord } from '@/lib/meetings'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { NotebookPen, Users } from 'lucide-react'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const CATEGORY_STYLE: Record<string, string> = {
  agency: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  partnership: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  gtm: 'bg-status-warning/10 text-status-warning border-status-warning/30',
  product: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  operations: 'bg-muted text-muted-foreground border-border',
  other: 'bg-muted text-muted-foreground border-border',
}

function monthLabel(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default async function MeetingsPage() {
  const meetings = await listMeetings()

  // Group by month, preserving newest-first order.
  const byMonth = new Map<string, MeetingRecord[]>()
  for (const m of meetings) {
    const key = m.date.slice(0, 7)
    byMonth.set(key, [...(byMonth.get(key) ?? []), m])
  }

  const agencyCount = meetings.filter(m => m.category === 'agency').length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Meetings"
        description={
          meetings.length === 0
            ? 'Meeting notes from Granola land here'
            : `${meetings.length} captured · ${agencyCount} agency threads · fed by the daily Granola sync`
        }
      />

      {meetings.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            <NotebookPen className="h-6 w-6 mx-auto mb-2 opacity-50" />
            No meetings captured yet. The Granola sync writes them to{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">operations/crm/meetings/</code>.
          </CardContent>
        </Card>
      ) : (
        Array.from(byMonth.entries()).map(([month, monthMeetings]) => (
          <section key={month}>
            <h2 className="text-sm font-medium text-muted-foreground mb-2">
              {monthLabel(monthMeetings[0].date)}
              <span className="ml-2 font-mono text-xs">{monthMeetings.length}</span>
            </h2>
            <Card>
              <CardContent className="p-0">
                <ul className="divide-y divide-border">
                  {monthMeetings.map(m => (
                    <li key={m.slug}>
                      <Link
                        href={`/meetings/${m.slug}`}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors"
                      >
                        <span className="w-14 flex-shrink-0 text-xs font-mono tabular-nums text-muted-foreground">
                          {dayLabel(m.date)}
                        </span>
                        <span className="min-w-0 flex-1 text-sm font-medium truncate">{m.title}</span>
                        {m.contacts.length > 0 && (
                          <span className="hidden sm:inline-flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
                            <Users className="h-3 w-3" />
                            {m.contacts.length}
                          </span>
                        )}
                        {m.agency && (
                          <Badge variant="outline" className="text-[10px] uppercase flex-shrink-0">
                            {m.agency}
                          </Badge>
                        )}
                        <Badge className={cn('text-[10px] flex-shrink-0 border', CATEGORY_STYLE[m.category])}>
                          {m.category}
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </section>
        ))
      )}
    </div>
  )
}
