"use client"

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/shared/status-badge'
import { ArrowRight, FileText } from 'lucide-react'
import { BID_STATUSES, type BidStatus } from '@/lib/config'
import type { Bid } from '@/types'

// Preserve workflow order. Closed states omitted from the kanban — they live in /bids.
const STATUS_ORDER = ['needs triage', 'discovered', 'analyzing', 'draft ready', 'under review', 'submitted'] as const

interface ActiveBidsKanbanProps {
  bids: Bid[]
  title?: string
  href?: string  // "View all" link target
}

export function ActiveBidsKanban({ bids, title = 'Active bids', href = '/bids' }: ActiveBidsKanbanProps) {
  // Group bids by lowercase status. Bids nobody has triaged yet get their own
  // column instead of silently passing as "Analyzing".
  const statusGroups: Record<string, Bid[]> = {}
  for (const bid of bids) {
    const status = (bid.status || 'Needs triage').toLowerCase()
    if (!statusGroups[status]) statusGroups[status] = []
    statusGroups[status].push(bid)
  }
  const orderedGroups = STATUS_ORDER
    .filter(s => statusGroups[s])
    .map(s => [s as string, statusGroups[s]] as const)

  const activeCount = orderedGroups.reduce((sum, [, bs]) => sum + bs.length, 0)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" />
            {title}
            <Badge variant="outline" className="text-[10px] font-mono tabular-nums">{activeCount}</Badge>
          </CardTitle>
          <Link href={href} className="text-xs text-blue-400 hover:underline inline-flex items-center gap-1">
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {orderedGroups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active bids in flight.</p>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-2">
            {orderedGroups.map(([status, groupBids]) => (
              <div key={status} className="min-w-[220px] flex-shrink-0">
                <div className="flex items-center justify-between mb-3">
                  {status === 'needs triage'
                    ? <StatusBadge status="warning" label="Needs triage" />
                    : <StatusBadge status={status} />}
                  <span className="text-xs font-mono text-muted-foreground tabular-nums">{groupBids.length}</span>
                </div>
                <div className="space-y-2">
                  {groupBids.map(bid => <KanbanCard key={bid.name} bid={bid} />)}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

const STALE_AFTER_DAYS = 14

function KanbanCard({ bid }: { bid: Bid }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)

  const staleDays = bid.updatedAt
    ? Math.floor((Date.now() - new Date(bid.updatedAt).getTime()) / (24 * 60 * 60 * 1000))
    : null

  const handleStatusChange = async (newStatus: string) => {
    if (!newStatus) return
    setSaving(true)
    try {
      await fetch(`/api/bids/${encodeURIComponent(bid.name)}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      router.refresh()
    } catch (err) {
      console.error('Failed to save status:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-md border border-border p-3 hover:border-status-accent/30 hover:bg-accent/30 transition-colors">
      <Link href={`/bids/${bid.name}`}>
        <p className="text-sm font-medium truncate hover:underline">{bid.displayName}</p>
      </Link>
      <div className="flex items-center gap-2 mt-1.5">
        <span className="text-xs text-muted-foreground font-mono tabular-nums">{bid.fileCount} docs</span>
        {bid.entity && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">{bid.entity}</Badge>
        )}
        {staleDays !== null && staleDays >= STALE_AFTER_DAYS && (
          <span className="text-[10px] text-status-warning font-mono tabular-nums">untouched {staleDays}d</span>
        )}
      </div>
      <select
        value={bid.status || ''}
        onChange={(e) => handleStatusChange(e.target.value)}
        disabled={saving}
        className="mt-2 w-full rounded border border-border bg-background px-1.5 py-1 text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
      >
        <option value="" disabled>Set status…</option>
        {BID_STATUSES.map((s: BidStatus) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
    </div>
  )
}
