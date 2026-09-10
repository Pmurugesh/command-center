"use client"

import { useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Reader } from '@/components/layout/reader'
import { MarkdownRenderer } from '@/components/shared/markdown-renderer'
import { TimeAgo } from '@/components/shared/time-ago'
import { Shield, History } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ScanReportWithDeltas } from '@/types'

/**
 * Scan reports as a Reader.
 *
 * Twenty stacked cards, one report open at a time, its content boxed in a
 * max-h-[600px] scroller inside an already-3,100px page. Nine of those twenty
 * were dated re-runs of product-health, rendered as equal-weight cards even
 * though the stat row above deliberately excluded them — so superseded history
 * looked exactly like current findings.
 *
 * Now: current scans in the index with their own numbers, superseded runs
 * folded under the family they belong to, and the report in a pane that owns
 * the page height.
 */
export function HealthReportList({
  reports, currentNames,
}: { reports: ScanReportWithDeltas[]; currentNames: string[] }) {
  const current = useMemo(() => new Set(currentNames), [currentNames])
  const [selected, setSelected] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  const currentReports = reports.filter(r => current.has(r.name))
  const superseded = reports.filter(r => !current.has(r.name))
  const active = reports.find(r => r.name === selected) ?? currentReports[0] ?? reports[0] ?? null

  const Row = ({ r, muted = false }: { r: ScanReportWithDeltas; muted?: boolean }) => (
    <li>
      <button
        onClick={() => setSelected(r.name)}
        className={cn('w-full px-2 py-1.5 text-left transition-colors',
          active?.name === r.name ? 'bg-accent' : 'hover:bg-accent/40')}
      >
        <div className="flex items-baseline gap-2">
          <span className={cn('min-w-0 flex-1 truncate text-sm', muted ? 'text-muted-foreground' : 'font-medium')}>
            {r.displayName}
          </span>
          {r.criticalCount > 0 && <Badge variant="destructive" className="shrink-0 text-[10px]">{r.criticalCount}</Badge>}
        </div>
        {/* The numbers that make the index worth scanning — previously visible
            only after opening a report. */}
        <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] tabular-nums text-muted-foreground">
          {r.deltas.new > 0 && <span className="text-status-danger">{r.deltas.new} new</span>}
          {r.deltas.resolved > 0 && <span className="text-status-success">{r.deltas.resolved} resolved</span>}
          {r.deltas.new === 0 && r.deltas.resolved === 0 && <span className="opacity-60">no change</span>}
          <span className="ml-auto opacity-70"><TimeAgo date={r.lastModified} /></span>
        </div>
      </button>
    </li>
  )

  return (
    <Reader
      indexWidth="lg:w-[22rem] 3xl:w-[25rem]"
      index={
        <div className="space-y-2">
          <Card>
            <CardContent className="p-0">
              <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Current scans · {currentReports.length}
              </p>
              <ul className="divide-y divide-border">{currentReports.map(r => <Row key={r.name} r={r} />)}</ul>
            </CardContent>
          </Card>

          {superseded.length > 0 && (
            <Card>
              <CardContent className="p-0">
                <button onClick={() => setShowHistory(v => !v)}
                  className="flex w-full items-center gap-1.5 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground">
                  <History className="h-3 w-3" />
                  Superseded runs · {superseded.length}
                  <span className="ml-auto">{showHistory ? '−' : '+'}</span>
                </button>
                {showHistory && (
                  <ul className="divide-y divide-border border-t border-border">
                    {superseded.map(r => <Row key={r.name} r={r} muted />)}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      }
    >
      {active && (
        <Card>
          <CardContent className="p-4 md:p-5">
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3 border-b border-border pb-2">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <Shield className="h-4 w-4" />{active.displayName}
              </h2>
              <span className="text-xs text-muted-foreground">updated <TimeAgo date={active.lastModified} /></span>
              {!current.has(active.name) && <Badge variant="outline" className="text-[10px]">superseded</Badge>}
              {active.criticalCount > 0 && <Badge variant="destructive" className="text-[10px]">{active.criticalCount} critical</Badge>}
            </div>
            <MarkdownRenderer content={active.content} />
          </CardContent>
        </Card>
      )}
    </Reader>
  )
}
