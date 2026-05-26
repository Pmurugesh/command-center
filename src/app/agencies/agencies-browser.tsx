"use client"

import { useMemo, useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TimeAgo } from '@/components/shared/time-ago'
import {
  ArrowRight, ArrowUpDown, ArrowUp, ArrowDown, Building2, Clock, LayoutGrid,
  Rows3, Search, Users, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Agency, AgencyPriority } from '@/types'

const PRIORITY_BADGE: Record<AgencyPriority, { variant: 'success' | 'warning' | 'secondary'; label: string }> = {
  high: { variant: 'success', label: 'High' },
  medium: { variant: 'warning', label: 'Medium' },
  low: { variant: 'secondary', label: 'Low' },
}

const PRIORITY_RANK: Record<AgencyPriority, number> = { high: 0, medium: 1, low: 2 }
const STALE_THRESHOLD_DAYS = 30

type SortKey = 'name' | 'priority' | 'contacts' | 'updated'
type SortDir = 'asc' | 'desc'
type ViewMode = 'table' | 'grid'
type PriorityFilter = 'all' | AgencyPriority

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24))
}

function isStale(iso: string): boolean {
  return daysSince(iso) >= STALE_THRESHOLD_DAYS
}

export function AgenciesBrowser({ agencies }: { agencies: Agency[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Hydrate state from URL (so refresh / share preserves view).
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '')
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const s = searchParams.get('sort') as SortKey | null
    return s && ['name', 'priority', 'contacts', 'updated'].includes(s) ? s : 'priority'
  })
  const [sortDir, setSortDir] = useState<SortDir>(() =>
    searchParams.get('dir') === 'desc' ? 'desc' : 'asc'
  )
  const [view, setView] = useState<ViewMode>(() =>
    searchParams.get('view') === 'grid' ? 'grid' : 'table'
  )
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>(() => {
    const p = searchParams.get('priority') as PriorityFilter | null
    return p && ['all', 'high', 'medium', 'low'].includes(p) ? p : 'all'
  })

  // Sync URL when state changes (replace, don't push — back button stays useful).
  useEffect(() => {
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    if (sortKey !== 'priority') params.set('sort', sortKey)
    if (sortDir !== 'asc') params.set('dir', sortDir)
    if (view !== 'table') params.set('view', view)
    if (priorityFilter !== 'all') params.set('priority', priorityFilter)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [query, sortKey, sortDir, view, priorityFilter, pathname, router])

  const priorityCounts = useMemo(() => ({
    all: agencies.length,
    high: agencies.filter(a => a.priority === 'high').length,
    medium: agencies.filter(a => a.priority === 'medium').length,
    low: agencies.filter(a => a.priority === 'low').length,
  }), [agencies])

  const filtered = useMemo(() => {
    let pool = agencies
    if (priorityFilter !== 'all') pool = pool.filter(a => a.priority === priorityFilter)
    const q = query.trim().toLowerCase()
    if (q) {
      pool = pool.filter(a =>
        a.displayName.toLowerCase().includes(q) ||
        a.slug.toLowerCase().includes(q) ||
        a.contacts.some(c => c.email.toLowerCase().includes(q) || c.name?.toLowerCase().includes(q))
      )
    }
    const sign = sortDir === 'asc' ? 1 : -1
    return [...pool].sort((a, b) => {
      let diff = 0
      switch (sortKey) {
        case 'name':
          diff = a.displayName.localeCompare(b.displayName)
          break
        case 'priority':
          diff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
          if (diff === 0) diff = a.displayName.localeCompare(b.displayName)
          break
        case 'contacts':
          diff = a.contactCount - b.contactCount
          break
        case 'updated':
          diff = a.lastModified.localeCompare(b.lastModified)
          break
      }
      return diff * sign
    })
  }, [agencies, query, sortKey, sortDir, priorityFilter])

  const toggleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'updated' || key === 'contacts' ? 'desc' : 'asc')
    }
  }, [sortKey])

  const staleCount = useMemo(() => filtered.filter(a => isStale(a.lastModified)).length, [filtered])

  return (
    <div className="space-y-4">
      {/* Priority filter chips */}
      <div className="flex items-center gap-1 border-b border-border overflow-x-auto pb-px">
        {(['all', 'high', 'medium', 'low'] as PriorityFilter[]).map(p => {
          const active = priorityFilter === p
          const label = p === 'all' ? 'All' : PRIORITY_BADGE[p].label
          const count = priorityCounts[p]
          return (
            <button
              key={p}
              type="button"
              onClick={() => setPriorityFilter(p)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-sm transition-colors border-b-2 -mb-px whitespace-nowrap',
                active
                  ? 'text-foreground border-status-accent'
                  : 'text-muted-foreground border-transparent hover:text-foreground'
              )}
            >
              {label}
              <span className="font-mono tabular-nums text-xs text-muted-foreground">{count}</span>
            </button>
          )
        })}
      </div>

      {/* Search + view toggle */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search agencies or contacts..."
            className="w-full rounded-md border border-border bg-background pl-8 pr-7 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {staleCount > 0 && (
          <Badge variant="warning" className="text-[10px] inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {staleCount} not updated in {STALE_THRESHOLD_DAYS}+ days
          </Badge>
        )}

        <div className="flex items-center rounded-md border border-border bg-card overflow-hidden ml-auto">
          <button
            onClick={() => setView('table')}
            className={cn(
              'px-2.5 py-1.5 text-xs inline-flex items-center gap-1.5 transition-colors',
              view === 'table' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
            aria-label="Table view"
          >
            <Rows3 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Table</span>
          </button>
          <button
            onClick={() => setView('grid')}
            className={cn(
              'px-2.5 py-1.5 text-xs inline-flex items-center gap-1.5 transition-colors border-l border-border',
              view === 'grid' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
            aria-label="Grid view"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Grid</span>
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {query
            ? <>No agencies match <span className="font-mono">&quot;{query}&quot;</span>.</>
            : <>No agencies in this view.</>}
        </div>
      ) : view === 'table' ? (
        <>
          {/* Table on md+, mobile-friendly compact list on small screens */}
          <div className="hidden md:block">
            <AgenciesTable agencies={filtered} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
          </div>
          <div className="md:hidden">
            <AgenciesCompactList agencies={filtered} />
          </div>
        </>
      ) : (
        <AgenciesGrid agencies={filtered} />
      )}
    </div>
  )
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown className="h-3 w-3 text-muted-foreground/50" />
  return dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
}

function StaleBadge({ iso }: { iso: string }) {
  const days = daysSince(iso)
  if (days < STALE_THRESHOLD_DAYS) return null
  return (
    <span
      className="inline-flex items-center gap-1 text-status-warning text-xs"
      title={`Last touched ${days} days ago`}
    >
      <Clock className="h-3 w-3" />
      stale
    </span>
  )
}

function AgenciesTable({
  agencies, sortKey, sortDir, onSort,
}: {
  agencies: Agency[]
  sortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
}) {
  const HeaderButton = ({ k, label, align = 'left' }: { k: SortKey; label: string; align?: 'left' | 'right' }) => (
    <button
      type="button"
      onClick={() => onSort(k)}
      className={cn(
        'inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors',
        align === 'right' && 'flex-row-reverse'
      )}
    >
      {label}
      <SortIcon active={sortKey === k} dir={sortDir} />
    </button>
  )

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-4 py-2.5"><HeaderButton k="name" label="Agency" /></th>
              <th className="text-left px-3 py-2.5"><HeaderButton k="priority" label="Priority" /></th>
              <th className="text-right px-3 py-2.5"><HeaderButton k="contacts" label="Contacts" align="right" /></th>
              <th className="text-left px-3 py-2.5 hidden lg:table-cell">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Top contact</span>
              </th>
              <th className="text-left px-3 py-2.5"><HeaderButton k="updated" label="Updated" /></th>
              <th className="w-8 px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {agencies.map((a, i) => {
              const badge = PRIORITY_BADGE[a.priority]
              const top = a.contacts[0]
              return (
                <tr
                  key={a.slug}
                  className={cn(
                    'border-t border-border hover:bg-accent/30 transition-colors group',
                    i % 2 === 1 && 'bg-muted/10'
                  )}
                >
                  <td className="px-4 py-2.5">
                    <Link href={`/agencies/${encodeURIComponent(a.slug)}`} className="flex items-center gap-2 group/link">
                      <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <span className="font-medium group-hover/link:text-status-accent transition-colors">
                        {a.displayName}
                      </span>
                    </Link>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge variant={badge.variant} className="text-[10px] uppercase tracking-wide">
                      {badge.label}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">{a.contactCount}</td>
                  <td className="px-3 py-2.5 hidden lg:table-cell text-muted-foreground">
                    {top ? (
                      <a
                        href={`mailto:${top.email}`}
                        onClick={(e) => e.stopPropagation()}
                        className="hover:text-blue-400 hover:underline font-mono text-xs tabular-nums truncate inline-block max-w-[280px]"
                      >
                        {top.email}
                      </a>
                    ) : (
                      <span className="text-muted-foreground/50 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <TimeAgo date={a.lastModified} />
                      <StaleBadge iso={a.lastModified} />
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <Link href={`/agencies/${encodeURIComponent(a.slug)}`} aria-label={`Open ${a.displayName}`}>
                      <ArrowRight className="h-4 w-4 text-muted-foreground/60 group-hover:text-status-accent transition-colors" />
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function AgenciesCompactList({ agencies }: { agencies: Agency[] }) {
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-border">
        {agencies.map((a) => {
          const badge = PRIORITY_BADGE[a.priority]
          return (
            <li key={a.slug}>
              <Link
                href={`/agencies/${encodeURIComponent(a.slug)}`}
                className="flex items-center gap-3 p-3 hover:bg-accent/30 transition-colors"
              >
                <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm truncate">{a.displayName}</span>
                    <Badge variant={badge.variant} className="text-[10px] uppercase tracking-wide">
                      {badge.label}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    <span><span className="font-mono tabular-nums">{a.contactCount}</span> contact{a.contactCount === 1 ? '' : 's'}</span>
                    <span className="opacity-60">·</span>
                    <TimeAgo date={a.lastModified} />
                    <StaleBadge iso={a.lastModified} />
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground/60 flex-shrink-0" />
              </Link>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function AgenciesGrid({ agencies }: { agencies: Agency[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {agencies.map((agency) => {
        const badge = PRIORITY_BADGE[agency.priority]
        const top = agency.contacts[0]
        return (
          <Link key={agency.slug} href={`/agencies/${encodeURIComponent(agency.slug)}`} className="group">
            <Card className="hover:border-status-accent/50 transition-colors cursor-pointer h-full">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    <CardTitle className="text-base leading-tight truncate">{agency.displayName}</CardTitle>
                  </div>
                  <Badge variant={badge.variant} className="text-[10px] uppercase tracking-wide flex-shrink-0">
                    {badge.label}
                  </Badge>
                </div>
                {top && (
                  <CardDescription className="text-xs font-mono tabular-nums truncate pt-1">
                    {top.name ? `${top.name} · ${top.email}` : top.email}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    <span className="font-mono tabular-nums">{agency.contactCount}</span>
                    contact{agency.contactCount === 1 ? '' : 's'}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="opacity-60">Updated</span>
                    <TimeAgo date={agency.lastModified} />
                    <StaleBadge iso={agency.lastModified} />
                  </span>
                </div>
              </CardContent>
            </Card>
          </Link>
        )
      })}
    </div>
  )
}
