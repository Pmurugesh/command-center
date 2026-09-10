"use client"

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Reader } from '@/components/layout/reader'
import { MarkdownRenderer } from '@/components/shared/markdown-renderer'
import { cn } from '@/lib/utils'

export interface GtmDoc {
  slug: string
  title: string
  content: string
  date?: string
  openDecisions: number
}

/**
 * GTM docs as a Reader.
 *
 * Two things were wrong with the stack this replaces. Every doc was a
 * full-width Card holding a collapsed <summary> — ~85% horizontally empty, six
 * of them. And `<details open={i === 0}>` meant a deep link from Today's Moves
 * (lib/moves.ts builds /gtm#<slug>) scrolled to a CLOSED card unless the target
 * happened to be the newest dated doc.
 *
 * Selecting from the hash fixes the deep link by construction, and delivers the
 * master-detail layout gtm/loading.tsx had been promising all along.
 */
export function GtmReader({ docs }: { docs: GtmDoc[] }) {
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    const fromHash = () => {
      const slug = decodeURIComponent(window.location.hash.replace(/^#/, ''))
      if (slug && docs.some(d => d.slug === slug)) setSelected(slug)
    }
    fromHash()
    window.addEventListener('hashchange', fromHash)
    return () => window.removeEventListener('hashchange', fromHash)
  }, [docs])

  const active = docs.find(d => d.slug === selected) ?? docs[0] ?? null

  // Dated strategy docs are a timeline; targets.md and lead-rules.md are
  // standing reference. A reference doc does not belong in a reverse-chron feed.
  const dated = docs.filter(d => d.date)
  const standing = docs.filter(d => !d.date)

  const Item = ({ doc }: { doc: GtmDoc }) => (
    <li>
      <button
        onClick={() => { setSelected(doc.slug); history.replaceState(null, '', `#${doc.slug}`) }}
        className={cn('w-full px-2 py-1.5 text-left transition-colors',
          active?.slug === doc.slug ? 'bg-accent' : 'hover:bg-accent/40')}
      >
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{doc.title}</span>
          {doc.openDecisions > 0 && <Badge variant="warning" className="shrink-0 text-[10px]">{doc.openDecisions}</Badge>}
        </div>
        {doc.date && <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{doc.date}</span>}
      </button>
    </li>
  )

  const Group = ({ label, items }: { label: string; items: GtmDoc[] }) =>
    items.length === 0 ? null : (
      <div>
        <p className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <Card><CardContent className="p-1"><ul className="divide-y divide-border">{items.map(d => <Item key={d.slug} doc={d} />)}</ul></CardContent></Card>
      </div>
    )

  return (
    <Reader
      indexWidth="lg:w-[19rem] 3xl:w-[21rem]"
      index={<div className="space-y-2"><Group label="Strategy — dated" items={dated} /><Group label="Standing reference" items={standing} /></div>}
    >
      {active && (
        <Card>
          <CardContent className="p-4 md:p-5">
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3 border-b border-border pb-2">
              <h2 className="text-base font-semibold">{active.title}</h2>
              <span className="font-mono text-xs text-muted-foreground">{active.slug}.md</span>
              {active.openDecisions > 0 && (
                <Badge variant="warning" className="text-[10px]">
                  {active.openDecisions} open decision{active.openDecisions === 1 ? '' : 's'}
                </Badge>
              )}
            </div>
            <MarkdownRenderer content={active.content} />
          </CardContent>
        </Card>
      )}
    </Reader>
  )
}
