'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { DraftRow } from './draft-row'
import type { OutreachDraft } from '@/lib/followup'

interface Props {
  drafts: OutreachDraft[]
}

export function OutreachBoard({ drafts: initial }: Props) {
  const [drafts, setDrafts] = useState<OutreachDraft[]>(initial)
  const [tab, setTab] = useState<'draft' | 'sent'>('draft')

  const open = drafts.filter(d => d.status === 'draft')
  const sent = drafts.filter(d => d.status === 'sent')
  const visible = tab === 'draft' ? open : sent

  function onMarkSent(slug: string, sentAt: string) {
    setDrafts(prev =>
      prev.map(d => d.slug === slug ? { ...d, status: 'sent' as const, sentAt } : d)
    )
    // Stay on draft tab so the queue naturally shrinks in front of the user.
  }

  function onEdited(slug: string, subject: string, body: string) {
    setDrafts(prev =>
      prev.map(d => d.slug === slug ? { ...d, subject, body, edited: true } : d)
    )
  }

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex gap-0 border-b border-border">
        <TabBtn
          active={tab === 'draft'}
          onClick={() => setTab('draft')}
          label="Open"
          count={open.length}
          countStyle="bg-status-danger/10 text-status-danger"
        />
        <TabBtn
          active={tab === 'sent'}
          onClick={() => setTab('sent')}
          label="Sent"
          count={sent.length}
          countStyle="bg-muted text-muted-foreground"
        />
      </div>

      {visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {tab === 'draft'
            ? 'Queue is empty — nothing overdue.'
            : 'Nothing marked sent yet.'}
        </p>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {visible.map(d => (
                <DraftRow
                  key={d.slug}
                  draft={d}
                  onMarkSent={onMarkSent}
                  onEdited={onEdited}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function TabBtn({
  active, onClick, label, count, countStyle,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
  countStyle: string
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2',
        active
          ? 'border-foreground text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      )}
    >
      {label}
      {count > 0 && (
        <span className={cn('rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums', countStyle)}>
          {count}
        </span>
      )}
    </button>
  )
}
