"use client"

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TimeAgo } from '@/components/shared/time-ago'
import {
  ArrowRight, ArrowUpDown, ArrowUp, ArrowDown, Building2, LayoutGrid,
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

type SortKey = 'name' | 'priority' | 'contacts' | 'updated'
type SortDir = 'asc' | 'desc'
type ViewMode = 'table' | 'grid'

export function AgenciesBrowser({ agencies }: { agencies: Agency[] }) {
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('priority')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [view, setView] = useState<ViewMode>('table')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = q
      ? agencies.filter(a =>
          a.displayName.toLowerCase().includes(q) ||
          a.slug.toLowerCase().includes(q) ||
          a.contacts.some(c => c.email.toLowerCase().includes(q) || c.name?.toLowerCase().includes(q))
        )
      : agencies
    const sign = sortDir === 'asc' ? 1 : -1
    return [...base].sort((a, b) => {
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
  }, [agencies, query, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'updated' || key === 'contacts' ? 'desc' : 'asc')
    }
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
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

        <div className="flex items-center rounded-md border border-border bg-card overflow-hidden ml-auto">
          <button
            onClick={() => setView('table')}
            className={cn(
              "px-2.5 py-1.5 text-xs inline-flex items-center gap-1.5 transition-colors",
              view === 'table' ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
            aria-label="Table view"
          >
            <Rows3 className="h-3.5 w-3.5" />
            Table
          </button>
          <button
            onClick={() => setView('grid')}
            className={cn(
              "px-2.5 py-1.5 text-xs inline-flex items-center gap-1.5 transition-colors border-l border-border",
              view === 'grid' ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
            aria-label="Grid view"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Grid
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No agencies match &quot;{query}&quot;.
        </div>
      ) : view === 'table' ? (
        <AgenciesTable agencies={filtered} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
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
        "inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors",
        align === 'right' && "flex-row-reverse"
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
              <th className="text-left px-3 py-2.5 hidden md:table-cell">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Top contact</span>
              </th>
              <th className="text-left px-3 py-2.5 hidden lg:table-cell"><HeaderButton k="updated" label="Updated" /></th>
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
                    "border-t border-border hover:bg-accent/30 transition-colors group",
                    i % 2 === 1 && "bg-muted/10"
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
                  <td className="px-3 py-2.5 hidden md:table-cell text-muted-foreground">
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
                  <td className="px-3 py-2.5 hidden lg:table-cell text-xs text-muted-foreground">
                    <TimeAgo date={a.lastModified} />
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
                    {top.email}
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
                  <span className="inline-flex items-center gap-1">
                    <span className="opacity-60">Updated</span>
                    <TimeAgo date={agency.lastModified} />
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
