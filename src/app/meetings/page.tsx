/**
 * Meetings — the Granola-fed archive as a filterable index beside the notes.
 * Month grouping moved into the index as sticky dividers; ten separate month
 * Cards were ~520px of chrome around one 50-row list. See todo.md Phase 14.
 * Originally:
 * Every business meeting the sync captured: agency threads, partnerships,
 * GTM/procurement, product, and ops sessions.
 */
import { listMeetings } from '@/lib/meetings'
import { MeetingsReader } from './meetings-reader'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { NotebookPen } from 'lucide-react'

export const dynamic = 'force-dynamic'

const CATEGORY_STYLE: Record<string, string> = {
  agency: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  partnership: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  gtm: 'bg-status-warning/10 text-status-warning border-status-warning/30',
  product: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  operations: 'bg-muted text-muted-foreground border-border',
  other: 'bg-muted text-muted-foreground border-border',
}

export default async function MeetingsPage() {
  const meetings = await listMeetings()

  const agencyCount = meetings.filter(m => m.category === 'agency').length

  return (
    <div className="space-y-3">
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
            <NotebookPen className="mx-auto mb-2 h-6 w-6 opacity-50" />
            No meetings captured yet. The Granola sync writes them to{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">operations/crm/meetings/</code>.
          </CardContent>
        </Card>
      ) : (
        <MeetingsReader
          meetings={meetings.map(m => ({
            slug: m.slug, title: m.title, date: m.date, category: m.category,
            agency: m.agency, contacts: m.contacts, content: m.content,
          }))}
          categoryStyle={CATEGORY_STYLE}
        />
      )}
    </div>
  )
}
