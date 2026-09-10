import { listBids } from '@/lib/files'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { NewBidForm } from './new-bid-form'
import { BidsTable } from './bids-table'
import { BID_STATUSES } from '@/lib/config'
import Link from 'next/link'
import { FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Bid } from '@/types'

export const dynamic = 'force-dynamic'

const FILTER_GROUPS: Record<string, string[]> = {
  all: [],
  active: ['discovered', 'analyzing', 'draft ready', 'under review'],
  submitted: ['submitted'],
  closed: ['won', 'lost', 'no-bid'],
}

interface PageProps {
  searchParams: { filter?: string }
}

export default async function BidsPage({ searchParams }: PageProps) {
  const allBids = await listBids()

  const filter = (searchParams.filter || 'all').toLowerCase()
  const allowed = FILTER_GROUPS[filter] || []
  const filtered = filter === 'all' || allowed.length === 0
    ? allBids
    : allBids.filter(b => allowed.includes((b.status || '').toLowerCase()))

  // Group by status along the workflow ladder, so one table still reads as a
  // pipeline. This replaces the kanban + card grid, which rendered the same
  // records twice, ~2,400px apart. See tasks/todo.md Phase 14.
  const byStatus = new Map<string, Bid[]>()
  for (const bid of filtered) {
    const key = bid.status || 'Unassigned'
    if (!byStatus.has(key)) byStatus.set(key, [])
    byStatus.get(key)!.push(bid)
  }
  const order = [...BID_STATUSES as readonly string[], 'Unassigned']
  const groups = order
    .filter(s => byStatus.has(s))
    .map(status => ({
      status,
      bids: byStatus.get(status)!.sort((a, b) => {
        // Dated work first — a deadline outranks recency.
        if (a.deadlineAt && b.deadlineAt) return a.deadlineAt.localeCompare(b.deadlineAt)
        if (a.deadlineAt) return -1
        if (b.deadlineAt) return 1
        return (b.updatedAt || '').localeCompare(a.updatedAt || '')
      }),
    }))

  const counts = {
    all: allBids.length,
    active: allBids.filter(b => FILTER_GROUPS.active.includes((b.status || '').toLowerCase())).length,
    submitted: allBids.filter(b => FILTER_GROUPS.submitted.includes((b.status || '').toLowerCase())).length,
    closed: allBids.filter(b => FILTER_GROUPS.closed.includes((b.status || '').toLowerCase())).length,
  }
  const tabs: Array<{ key: keyof typeof counts; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'submitted', label: 'Submitted' },
    { key: 'closed', label: 'Closed' },
  ]

  const withDeadline = allBids.filter(b => b.deadlineAt).length

  return (
    <div className="space-y-3">
      <PageHeader
        title="Bid Pipeline"
        description={`${allBids.length} bids · ${withDeadline} dated`}
        actions={
          <div className="flex items-center gap-3">
            {/* Filters used to be a separate full-width band under the header;
                they carry <400px of content, so they ride in the header. */}
            {allBids.length > 0 && (
              <div className="flex items-center gap-1">
                {tabs.map(tab => {
                  const active = filter === tab.key
                  return (
                    <Link
                      key={tab.key}
                      href={tab.key === 'all' ? '/bids' : `/bids?filter=${tab.key}`}
                      className={cn(
                        'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                        active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                      )}
                    >
                      {tab.label}
                      <span className="ml-1.5 font-mono tabular-nums text-muted-foreground">{counts[tab.key]}</span>
                    </Link>
                  )
                })}
              </div>
            )}
            <NewBidForm />
          </div>
        }
      />

      {allBids.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No bids found"
          description="Add bid folders to ~/repos/operations/bids/ to see them here"
        />
      ) : filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No bids in this view.
        </div>
      ) : (
        <BidsTable groups={groups} />
      )}
    </div>
  )
}
