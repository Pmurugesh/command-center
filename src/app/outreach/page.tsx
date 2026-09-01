/**
 * Outreach — the follow-up drafts queue (Phase 12).
 *
 * Drafts land here when a contact goes overdue, a meeting happens without a
 * follow-up, a bid is submitted, or you click 'Draft' on Today's Moves.
 * Copy to Gmail → send → Mark Sent → auto-logged to the CRM contact.
 *
 * Phase A: queue + copy + edit + mark-sent.
 * Phase B: auto-trigger scan (cron), Voice AI enrichment, aging nudges.
 */
import { listDrafts } from '@/lib/followup'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { OutreachBoard } from './outreach-board'
import { Send } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function OutreachPage() {
  const drafts = await listDrafts()

  const open = drafts.filter(d => d.status === 'draft')
  const high = open.filter(d => d.priority === 'high')
  const oldest = open.reduce<number | undefined>((acc, d) =>
    d.agingDays !== undefined && (acc === undefined || d.agingDays > acc) ? d.agingDays : acc
  , undefined)

  const description = drafts.length === 0
    ? 'Follow-up drafts land here. Copy → paste into Gmail → Mark Sent → auto-logged to CRM.'
    : [
        `${open.length} open`,
        high.length > 0 && `${high.length} high priority`,
        oldest !== undefined && oldest > 0 && `oldest ${oldest}d`,
      ].filter(Boolean).join(' · ')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Outreach"
        description={description as string}
      />

      {drafts.length === 0 ? (
        <EmptyState
          icon={Send}
          title="No drafts yet"
          description="Click 'Draft' on an overdue contact in Today's Moves to create one. Auto-triggers (post-meeting, bid-submitted) arrive in Phase B."
        />
      ) : (
        <OutreachBoard drafts={drafts} />
      )}
    </div>
  )
}
