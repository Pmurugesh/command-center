"use client"

import { Fragment, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, Paperclip, AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/shared/status-badge'
import { DeadlineBadge } from '@/components/shared/deadline-badge'
import { TimeAgo } from '@/components/shared/time-ago'
import { BID_STATUSES, type BidStatus } from '@/lib/config'
import { cn } from '@/lib/utils'
import type { Bid } from '@/types'

/**
 * The bid pipeline as one table.
 *
 * Before: a stage kanban AND a card grid rendered the SAME 12 records, ~2,400px
 * apart on one page, for a combined ~2,500px. Neither showed a deadline, a
 * contract value, an agency or a staffing gap — all of which sit in
 * .status.json and were read, then discarded, by listBids.
 *
 * Now: one row per bid, grouped by status with group headers so the pipeline
 * still reads top-to-bottom, keeping the inline status select the kanban card
 * used to carry.
 */
function money(n?: number): string {
  if (!n) return ''
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`
  return `$${n}`
}

function CoverageBar({ coverage }: { coverage?: Bid['coverage'] }) {
  if (!coverage || !coverage.rolesTotal) return <span className="text-muted-foreground">—</span>
  const { rolesStaffed, rolesTotal } = coverage
  const pct = Math.round((rolesStaffed / rolesTotal) * 100)
  const tone = pct >= 100 ? 'bg-status-success' : pct >= 50 ? 'bg-status-warning' : 'bg-status-danger'
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-1.5 w-10 overflow-hidden rounded-full bg-muted">
        <span className={cn('block h-full rounded-full', tone)} style={{ width: `${Math.min(pct, 100)}%` }} />
      </span>
      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{rolesStaffed}/{rolesTotal}</span>
    </span>
  )
}

function BidRow({ bid }: { bid: Bid }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [, startTransition] = useTransition()

  const onStatus = async (next: string) => {
    if (!next) return
    setSaving(true)
    try {
      await fetch(`/api/bids/${encodeURIComponent(bid.name)}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      startTransition(() => router.refresh())
    } catch (err) {
      console.error('Failed to save status:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <tr className="border-b border-border transition-colors last:border-0 hover:bg-accent/30">
      <td className="max-w-0 px-3 py-1.5">
        <Link href={`/bids/${bid.name}`} className="group flex items-center gap-1.5">
          <span className="truncate text-sm font-medium group-hover:text-blue-400" title={bid.displayName}>
            {bid.displayName}
          </span>
          <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground group-hover:text-blue-400" />
        </Link>
        {bid.reason && <p className="truncate text-[11px] text-muted-foreground" title={bid.reason}>{bid.reason}</p>}
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground">{bid.agency || '—'}</td>
      <td className="whitespace-nowrap px-3 py-1.5">
        {bid.entity ? <Badge variant="outline" className="px-1.5 py-0 text-[10px]">{bid.entity}</Badge> : null}
      </td>
      <td className="whitespace-nowrap px-3 py-1.5">
        {bid.deadlineAt ? <DeadlineBadge deadlineAt={bid.deadlineAt} /> : <span className="text-xs text-muted-foreground">—</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-1.5"><CoverageBar coverage={bid.coverage} /></td>
      <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-xs tabular-nums">
        {money(bid.contractValue) || <span className="text-muted-foreground">—</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-xs tabular-nums text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          {bid.fileCount}{bid.hasDocuments && <Paperclip className="h-3 w-3" />}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-1.5">
        {bid.decisionsOpen ? (
          <span className="inline-flex items-center gap-1 font-mono text-xs tabular-nums text-status-warning">
            <AlertTriangle className="h-3 w-3" />{bid.decisionsOpen}
          </span>
        ) : <span className="text-xs text-muted-foreground">—</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground">
        {bid.updatedAt ? <TimeAgo date={bid.updatedAt} /> : '—'}
      </td>
      <td className="px-3 py-1.5">
        <select
          value={bid.status || ''}
          onChange={e => onStatus(e.target.value)}
          disabled={saving}
          className="w-full rounded border border-border bg-background px-1.5 py-0.5 text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        >
          <option value="" disabled>Set status…</option>
          {BID_STATUSES.map((s: BidStatus) => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>
    </tr>
  )
}

const HEAD = 'px-3 py-1.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground'

export function BidsTable({ groups }: { groups: { status: string; bids: Bid[] }[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full border-collapse">
        <thead className="border-b border-border bg-muted/40">
          <tr>
            <th className={cn(HEAD, 'w-[26%]')}>Bid</th>
            <th className={HEAD}>Agency</th>
            <th className={HEAD}>Entity</th>
            <th className={HEAD}>Deadline</th>
            <th className={HEAD}>Coverage</th>
            <th className={cn(HEAD, 'text-right')}>Value</th>
            <th className={cn(HEAD, 'text-right')}>Docs</th>
            <th className={HEAD}>Open</th>
            <th className={HEAD}>Updated</th>
            <th className={cn(HEAD, 'w-32')}>Status</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(group => (
            <Fragment key={group.status}>
              <tr className="bg-muted/20">
                <td colSpan={10} className="px-3 py-1">
                  <span className="flex items-center gap-2">
                    <StatusBadge status={group.status} />
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{group.bids.length}</span>
                  </span>
                </td>
              </tr>
              {group.bids.map(bid => <BidRow key={bid.name} bid={bid} />)}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
