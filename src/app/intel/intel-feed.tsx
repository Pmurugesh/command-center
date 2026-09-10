"use client"

import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { MarkdownRenderer } from '@/components/shared/markdown-renderer'
import { EmptyState } from '@/components/shared/empty-state'
import { Reader } from '@/components/layout/reader'
import { Radio, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { IntelAlert } from '@/types'

type TabType = 'daily' | 'weekly' | 'procurement' | 'competitor' | 'system'

/** Per-alert signal computed once on the server, so the index can say something. */
export interface AlertSignal {
  filename: string
  critical: boolean
  deltas: { new: number; resolved: number; unchanged: number }
  summary: string
}

const TABS: { key: TabType; label: string }[] = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'procurement', label: 'Procurements' },
  { key: 'competitor', label: 'Competitors' },
  { key: 'system', label: 'System' },
]

/**
 * Intelligence, as a Reader.
 *
 * This page used to stack 58 collapsed cards: 6,949px tall with ZERO expanded
 * content on load — 6.7 screens of scrolling to reach 3,237 characters. The
 * open alert was then trapped in a max-h-[600px] nested scroller, and only one
 * could be open at a time.
 *
 * Now: an index carrying a per-row signal (critical / new / resolved) so it is
 * scannable without opening anything, and a pane that owns the full height.
 */
export function IntelFeed({ alerts, signals }: { alerts: IntelAlert[]; signals: Record<string, AlertSignal> }) {
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const a of alerts) c[a.type] = (c[a.type] ?? 0) + 1
    return c
  }, [alerts])

  const firstTab = TABS.find(t => (counts[t.key] ?? 0) > 0)?.key ?? 'daily'
  const [activeTab, setActiveTab] = useState<TabType>(firstTab)
  const [selected, setSelected] = useState<string | null>(null)

  const current = useMemo(() => alerts.filter(a => a.type === activeTab), [alerts, activeTab])
  const active = current.find(a => a.filename === selected) ?? current[0] ?? null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.filter(t => (counts[t.key] ?? 0) > 0).map(tab => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); setSelected(null) }}
            className={cn(
              'flex items-center gap-2 border-b-2 px-3 py-1.5 text-sm transition-colors',
              activeTab === tab.key
                ? 'border-blue-400 text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">{counts[tab.key] ?? 0}</Badge>
          </button>
        ))}
      </div>

      {current.length === 0 ? (
        <EmptyState icon={Radio} title={`No ${activeTab} alerts`} />
      ) : (
        <Reader
          index={
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {current.map(alert => {
                const sig = signals[alert.filename]
                const isActive = active?.filename === alert.filename
                return (
                  <li key={alert.filename}>
                    <button
                      onClick={() => setSelected(alert.filename)}
                      className={cn('w-full px-3 py-2 text-left transition-colors',
                        isActive ? 'bg-accent' : 'hover:bg-accent/40')}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                          {alert.date || '—'}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{alert.label}</span>
                        {sig?.critical && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-status-danger" />}
                      </div>
                      {/* The signal that makes the index worth scanning —
                          extractDeltaIndicators already existed and was only
                          used by /health. */}
                      <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] tabular-nums text-muted-foreground">
                        {sig && sig.deltas.new > 0 && <span className="text-status-warning">{sig.deltas.new} new</span>}
                        {sig && sig.deltas.resolved > 0 && <span className="text-status-success">{sig.deltas.resolved} resolved</span>}
                        {sig && sig.deltas.new === 0 && sig.deltas.resolved === 0 && !sig.critical && (
                          <span className="opacity-60">no change</span>
                        )}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          }
        >
          {active && (
            <div className="rounded-lg border border-border bg-card p-4 md:p-5">
              <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border pb-2">
                <h2 className="text-base font-semibold">{active.date || 'Undated'} — {active.label}</h2>
                <span className="font-mono text-xs text-muted-foreground">{active.filename}</span>
                {signals[active.filename]?.critical && (
                  <Badge variant="destructive" className="text-[10px]">Critical</Badge>
                )}
              </div>
              <MarkdownRenderer content={active.content} />
            </div>
          )}
        </Reader>
      )}
    </div>
  )
}
