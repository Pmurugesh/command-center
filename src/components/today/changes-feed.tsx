'use client'

/**
 * What changed since YOU last looked.
 *
 * Client-side because "your last visit" is a per-browser fact the server cannot
 * know. The timestamp is only advanced after the page has been open for a few
 * seconds, so bouncing in and out does not silently mark everything as seen.
 *
 * The data is exact rather than heuristic: since M0 made operations a git repo,
 * every change is a dated, attributed commit. The original plan for this used
 * file mtimes, which a clone resets — the same trap that made the health panel
 * report dead scans as fresh.
 */
import { useEffect, useState } from 'react'
import { History, Users, FileText, Radar, Package, ClipboardList, GitCommit, ChevronRight } from 'lucide-react'
import type { ChangeEntry } from '@/lib/insights'

const LAST_VISIT_KEY = 'cc:lastVisit'
const MARK_SEEN_AFTER_MS = 5000

const AREA_META: Record<ChangeEntry['area'], { icon: typeof Users; label: string; tone: string }> = {
  contacts: { icon: Users, label: 'CRM', tone: 'text-blue-400' },
  bids: { icon: FileText, label: 'Bids', tone: 'text-purple-400' },
  intel: { icon: Radar, label: 'Intel', tone: 'text-emerald-400' },
  products: { icon: Package, label: 'Products', tone: 'text-amber-400' },
  reports: { icon: ClipboardList, label: 'Reports', tone: 'text-slate-400' },
  other: { icon: GitCommit, label: 'Other', tone: 'text-slate-400' },
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function ChangesFeed() {
  const [changes, setChanges] = useState<ChangeEntry[] | null>(null)
  const [since, setSince] = useState<string | null>(null)

  useEffect(() => {
    // First ever visit has no baseline — show the last 24h so the panel is
    // useful immediately instead of empty and unexplained.
    const stored = localStorage.getItem(LAST_VISIT_KEY)
    const from = stored ?? new Date(Date.now() - 86_400_000).toISOString()
    setSince(from)

    let cancelled = false
    fetch(`/api/crm/changes?since=${encodeURIComponent(from)}`)
      .then(r => (r.ok ? r.json() : []))
      .then(data => { if (!cancelled) setChanges(Array.isArray(data) ? data : []) })
      .catch(() => { if (!cancelled) setChanges([]) })

    const t = setTimeout(() => localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString()), MARK_SEEN_AFTER_MS)
    return () => { cancelled = true; clearTimeout(t) }
  }, [])

  // One line collapsed — the feed is context, not action. It expands on tap
  // and never competes with the queues above it for vertical space.
  const summaryText =
    changes === null ? 'checking…' :
    changes.length === 0 ? `nothing since ${since ? timeAgo(since) : 'your last visit'}` :
    `${changes.length} change${changes.length > 1 ? 's' : ''} since ${since ? timeAgo(since) : 'your last visit'}`

  return (
    <details className="group rounded-lg border border-border bg-card">
      <summary className="flex cursor-pointer select-none items-center gap-2 px-6 py-3 text-sm text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" />
        <History className="h-4 w-4 shrink-0" />
        <span className="font-medium">What changed</span>
        <span className="truncate text-xs">{summaryText}</span>
      </summary>
      <div className="space-y-2 border-t border-border px-6 py-4">
        {changes === null ? (
          <div className="h-16 animate-pulse rounded-md bg-accent/30" />
        ) : changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing since {since ? timeAgo(since) : 'your last visit'}.
          </p>
        ) : (
          changes.slice(0, 8).map((c, i) => {
            const meta = AREA_META[c.area] ?? AREA_META.other
            const Icon = meta.icon
            return (
              <div key={`${c.at}-${i}`} className="flex items-start gap-2 rounded-md border border-border p-2.5">
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.tone}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{c.summary}</p>
                  <p className="text-xs text-muted-foreground">
                    {meta.label} · {c.author} · {timeAgo(c.at)}
                  </p>
                </div>
              </div>
            )
          })
        )}
      </div>
    </details>
  )
}
