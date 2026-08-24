import { listBids } from '@/lib/files'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { StatusBadge } from '@/components/shared/status-badge'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { NewBidForm } from './new-bid-form'
import { ActiveBidsKanban } from '@/components/bids/active-bids-kanban'
import { TimeAgo } from '@/components/shared/time-ago'
import Link from 'next/link'
import { FileText, ArrowRight, FolderOpen, Paperclip } from 'lucide-react'
import { cn } from '@/lib/utils'

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

  // Sort by most recent first
  const sorted = [...allBids].sort((a, b) => {
    const aT = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
    const bT = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
    return bT - aT
  })

  // Apply filter
  const filter = (searchParams.filter || 'all').toLowerCase()
  const allowedStatuses = FILTER_GROUPS[filter] || []
  const filteredBids = filter === 'all' || allowedStatuses.length === 0
    ? sorted
    : sorted.filter(b => allowedStatuses.includes((b.status || '').toLowerCase()))

  // Counts per group
  const counts = {
    all: allBids.length,
    active: allBids.filter(b => FILTER_GROUPS.active.includes((b.status || '').toLowerCase())).length,
    submitted: allBids.filter(b => FILTER_GROUPS.submitted.includes((b.status || '').toLowerCase())).length,
    closed: allBids.filter(b => FILTER_GROUPS.closed.includes((b.status || '').toLowerCase())).length,
  }

  const filterTabs: Array<{ key: keyof typeof counts; label: string }> = [
    { key: 'all',       label: 'All' },
    { key: 'active',    label: 'Active' },
    { key: 'submitted', label: 'Submitted' },
    { key: 'closed',    label: 'Closed' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bid Pipeline"
        description={`${allBids.length} bid${allBids.length === 1 ? '' : 's'} · sorted by most recently updated`}
      />

      <NewBidForm />

      {/* Stage kanban with inline triage — re-homed from Today, where a
          compact list now stands in for it */}
      {allBids.length > 0 && (
        <ActiveBidsKanban
          bids={allBids.filter(b => !FILTER_GROUPS.closed.includes((b.status || '').toLowerCase()))}
        />
      )}

      {/* Filter tabs (URL-based, server-rendered, no client JS needed) */}
      {allBids.length > 0 && (
        <div className="flex items-center gap-1 border-b border-border">
          {filterTabs.map(tab => {
            const active = filter === tab.key
            return (
              <Link
                key={tab.key}
                href={tab.key === 'all' ? '/bids' : `/bids?filter=${tab.key}`}
                className={cn(
                  'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                  active
                    ? 'border-status-accent text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                {tab.label}
                <span className="ml-1.5 font-mono tabular-nums text-xs text-muted-foreground">
                  {counts[tab.key]}
                </span>
              </Link>
            )
          })}
        </div>
      )}

      {allBids.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No bids found"
          description="Add bid folders to ~/repos/operations/bids/ to see them here"
        />
      ) : filteredBids.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No bids in this view.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredBids.map((bid) => (
            <Link key={bid.name} href={`/bids/${bid.name}`} className="group">
              <Card className="hover:border-status-accent/50 transition-colors cursor-pointer h-full">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                      <CardTitle className="text-base leading-tight truncate">{bid.displayName}</CardTitle>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-status-accent transition-colors flex-shrink-0 mt-0.5" />
                  </div>
                  {bid.updatedAt && (
                    <CardDescription className="text-xs">
                      Updated <TimeAgo date={bid.updatedAt} />
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                    {bid.status && <StatusBadge status={bid.status} />}
                    {bid.entity && (
                      <span className="truncate">{bid.entity}</span>
                    )}
                    <span className="font-mono tabular-nums">{bid.fileCount} docs</span>
                    {bid.hasDocuments && (
                      <span className="inline-flex items-center gap-1">
                        <Paperclip className="h-3 w-3" />
                        source files
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
