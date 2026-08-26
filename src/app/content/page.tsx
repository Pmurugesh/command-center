/**
 * Content — the weekly suggestion queue (Phase 9).
 *
 * Voice generates grounded ideas every Monday; this is where they land, get
 * picked or skipped, and collect the feedback that shapes next week's batch.
 * Before this page they were announced to Telegram and lost.
 */
import { listSuggestions, byWeek } from '@/lib/content'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { SuggestionList } from './suggestion-list'
import { NewPostForm } from './new-post-form'
import { PenTool } from 'lucide-react'

export const dynamic = 'force-dynamic'

function weekLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return `Week of ${d.toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })}`
}

export default async function ContentPage() {
  const all = await listSuggestions()
  const weeks = byWeek(all)

  const undecided = all.filter(s => s.status === 'suggested').length
  const picked = all.filter(s => s.status === 'picked').length
  const published = all.filter(s => s.status === 'published').length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Content"
        description={
          all.length === 0
            ? 'Weekly post suggestions from Voice'
            : `${all.length} suggestion${all.length === 1 ? '' : 's'} · ${undecided} undecided · ${picked} picked` +
              (published > 0 ? ` · ${published} published` : '')
        }
        actions={<NewPostForm />}
      />

      {all.length === 0 ? (
        <EmptyState
          icon={PenTool}
          title="No suggestions yet"
          description="Voice generates content ideas every Monday at 08:00 PT and writes them to operations/content/suggestions/. Nothing has been written there yet — the next run will populate this page, or add one yourself with New post."
        />
      ) : (
        <div className="space-y-8">
          {weeks.map(({ week, items }) => (
            <section key={week} className="space-y-4">
              <div className="flex items-baseline gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  {weekLabel(week)}
                </h2>
                <span className="text-xs text-muted-foreground/70">
                  {items.length} post{items.length === 1 ? '' : 's'}
                </span>
              </div>
              <SuggestionList initial={items} />
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
