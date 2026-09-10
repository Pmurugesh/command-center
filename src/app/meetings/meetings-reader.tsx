"use client"

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Reader } from '@/components/layout/reader'
import { MarkdownRenderer } from '@/components/shared/markdown-renderer'
import { Search, X, Users, ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface MeetingItem {
  slug: string
  title: string
  date: string
  category: string
  agency?: string
  contacts: string[]
  content: string
}

/**
 * Meetings as a Reader.
 *
 * The stack this replaces spent ~520px on section chrome — ten month headings
 * and ten separate Card borders — to separate what is one 50-row list, and
 * truncated every title while ~450px sat unused to its right. Each meeting's
 * body, ~1KB, was a full page navigation away, and there was no filter or
 * search despite category and agency both being structured fields.
 */
export function MeetingsReader({
  meetings, categoryStyle,
}: { meetings: MeetingItem[]; categoryStyle: Record<string, string> }) {
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const categories = useMemo(() => Array.from(new Set(meetings.map(m => m.category))).sort(), [meetings])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return meetings.filter(m => {
      if (cat && m.category !== cat) return false
      if (!q) return true
      return m.title.toLowerCase().includes(q)
        || (m.agency ?? '').toLowerCase().includes(q)
        || m.contacts.some(c => c.toLowerCase().includes(q))
    })
  }, [meetings, query, cat])

  const active = filtered.find(m => m.slug === selected) ?? filtered[0] ?? null

  let lastMonth = ''
  const monthOf = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <Reader
      indexWidth="lg:w-[24rem] 3xl:w-[27rem]"
      index={
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search title, agency, contact…"
              className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-7 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {query && (
              <button onClick={() => setQuery('')} aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-1">
            <button onClick={() => setCat(null)}
              className={cn('rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide transition-colors',
                cat === null ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              all {meetings.length}
            </button>
            {categories.map(c => (
              <button key={c} onClick={() => setCat(c === cat ? null : c)}
                className={cn('rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide transition-colors',
                  cat === c ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                {c} {meetings.filter(m => m.category === c).length}
              </button>
            ))}
          </div>

          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {filtered.map(m => {
                  const month = monthOf(m.date)
                  const showMonth = month !== lastMonth
                  lastMonth = month
                  return (
                    <li key={m.slug}>
                      {showMonth && (
                        <p className="sticky top-0 z-10 bg-muted/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground backdrop-blur">
                          {month}
                        </p>
                      )}
                      <button onClick={() => setSelected(m.slug)}
                        className={cn('w-full px-2 py-1.5 text-left transition-colors',
                          active?.slug === m.slug ? 'bg-accent' : 'hover:bg-accent/40')}>
                        <div className="flex items-baseline gap-2">
                          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{m.date.slice(5)}</span>
                          <span className="min-w-0 flex-1 truncate text-sm">{m.title}</span>
                          {m.agency && <Badge variant="outline" className="shrink-0 text-[9px] uppercase">{m.agency}</Badge>}
                        </div>
                      </button>
                    </li>
                  )
                })}
                {filtered.length === 0 && (
                  <li className="px-3 py-4 text-center text-xs text-muted-foreground">No meetings match.</li>
                )}
              </ul>
            </CardContent>
          </Card>
        </div>
      }
    >
      {active && (
        <Card>
          <CardContent className="p-4 md:p-5">
            <div className="mb-3 border-b border-border pb-2">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-base font-semibold">{active.title}</h2>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">{active.date}</span>
                <Badge className={cn('border text-[10px]', categoryStyle[active.category])}>{active.category}</Badge>
                {active.agency && <Badge variant="outline" className="text-[10px] uppercase">{active.agency}</Badge>}
                <Link href={`/meetings/${active.slug}`} className="ml-auto inline-flex items-center gap-1 text-xs text-blue-400 hover:underline">
                  Permalink <ArrowUpRight className="h-3 w-3" />
                </Link>
              </div>
              {/* Contact slugs are the CRM join key and were reduced to a count. */}
              {active.contacts.length > 0 && (
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Users className="h-3 w-3" />
                  {active.contacts.map(c => (
                    <span key={c} className="font-mono text-[11px]">{c}</span>
                  ))}
                </p>
              )}
            </div>
            <MarkdownRenderer content={active.content} />
          </CardContent>
        </Card>
      )}
    </Reader>
  )
}
