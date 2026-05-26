"use client"

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ArrowRight, Building2, Search, Users, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Agency, AgencyPriority } from '@/types'

const PRIORITY_BADGE: Record<AgencyPriority, { variant: 'success' | 'warning' | 'secondary'; label: string }> = {
  high: { variant: 'success', label: 'High priority' },
  medium: { variant: 'warning', label: 'Medium priority' },
  low: { variant: 'secondary', label: 'Low priority' },
}

export function AgenciesBrowser({ agencies }: { agencies: Agency[] }) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return agencies
    return agencies.filter(a =>
      a.displayName.toLowerCase().includes(q) || a.slug.toLowerCase().includes(q)
    )
  }, [agencies, query])

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search agencies..."
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

      {filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No agencies match &quot;{query}&quot;.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((agency) => {
            const badge = PRIORITY_BADGE[agency.priority]
            return (
              <Link key={agency.slug} href={`/agencies/${encodeURIComponent(agency.slug)}`} className="group">
                <Card className={cn('hover:border-status-accent/50 transition-colors cursor-pointer h-full')}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <Building2 className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                        <CardTitle className="text-base leading-tight truncate">{agency.displayName}</CardTitle>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-status-accent transition-colors flex-shrink-0 mt-0.5" />
                    </div>
                    <CardDescription className="text-xs font-mono tabular-nums truncate">
                      {agency.filename}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={badge.variant} className="text-[10px] uppercase tracking-wide">
                        {badge.label}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] inline-flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        <span className="font-mono tabular-nums">{agency.contactCount}</span>
                        contact{agency.contactCount === 1 ? '' : 's'}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
