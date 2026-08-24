"use client"

/**
 * Active bids, compact. One line per bid: name, status (inline triage), and
 * the response deadline. The full kanban lives on /bids — Today only needs
 * "what's in flight and when is it due", not columns.
 */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FileText, ArrowRight } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { DeadlineBadge } from '@/components/shared/deadline-badge'
import { BID_STATUSES, type BidStatus } from '@/lib/config'
import type { Bid } from '@/types'

function BidRow({ bid }: { bid: Bid }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)

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
    <li className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <Link href={`/bids/${bid.name}`} className="group flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium group-hover:text-blue-400">{bid.displayName}</span>
          <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground group-hover:text-blue-400" />
        </Link>
        {bid.entity && (
          <Badge variant="outline" className="mt-0.5 px-1.5 py-0 text-[10px]">{bid.entity}</Badge>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {bid.deadlineAt && <DeadlineBadge deadlineAt={`${bid.deadlineAt}T17:00:00`} />}
        <select
          value={bid.status || ''}
          onChange={(e) => handleStatusChange(e.target.value)}
          disabled={saving}
          className="rounded border border-border bg-background px-1.5 py-1 text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        >
          <option value="" disabled>Set status…</option>
          {BID_STATUSES.map((s: BidStatus) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
    </li>
  )
}

export function ActiveBidsList({ bids }: { bids: Bid[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" />
            Active bids
            <Badge variant="outline" className="font-mono text-[10px] tabular-nums">{bids.length}</Badge>
          </CardTitle>
          <Link href="/bids" className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline">
            Full pipeline <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {bids.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active bids in flight.</p>
        ) : (
          <ul className="divide-y divide-border">
            {bids.map(b => <BidRow key={b.name} bid={b} />)}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
