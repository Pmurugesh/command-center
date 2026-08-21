'use client'

/**
 * The morning view: contacts ranked by what needs Pavan first.
 *
 * Buckets are mutually exclusive and ordered by urgency (blocked outranks
 * overdue, because a blocked item cannot be worked at all). Day counters are
 * the point — "89d" is a fact nobody argues with, where "pending" is a status
 * that survived three months unnoticed.
 *
 * Every row acts in place. Navigating to a detail page to change a status is
 * how a CRM becomes something you stop updating.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle, Ban, CalendarClock, Snowflake, Check, Clock, Loader2, UserPlus,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import type { CrmBuckets, CrmContactView } from '@/types'

type BucketKey = 'overdue' | 'blocked' | 'dueToday' | 'goingCold' | 'neverContacted'

const BUCKET_META: Record<BucketKey, {
  label: string
  icon: typeof AlertTriangle
  tone: string
  chip: string
  empty: string
}> = {
  blocked: {
    label: 'Blocked',
    icon: Ban,
    tone: 'border-red-500/30 bg-red-500/5',
    chip: 'bg-red-500/10 text-red-400 border-red-500/30',
    empty: 'Nothing blocked. Every action can proceed.',
  },
  overdue: {
    label: 'Overdue',
    icon: AlertTriangle,
    tone: 'border-amber-500/30 bg-amber-500/5',
    chip: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    empty: 'Nothing overdue. You are current.',
  },
  dueToday: {
    label: 'Due today',
    icon: CalendarClock,
    tone: 'border-blue-500/30 bg-blue-500/5',
    chip: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    empty: 'Nothing due today.',
  },
  neverContacted: {
    label: 'Never contacted',
    icon: UserPlus,
    tone: '',
    chip: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
    empty: 'Everyone has been contacted at least once.',
  },
  goingCold: {
    label: 'Going cold',
    icon: Snowflake,
    tone: 'border-slate-500/30 bg-slate-500/5',
    chip: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
    empty: 'No contacts going cold.',
  },
}

function dayLabel(c: CrmContactView, key: BucketKey): string | null {
  if (key === 'blocked') return c.daysBlocked ? `${c.daysBlocked}d blocked` : null
  if (key === 'overdue') return c.daysOverdue ? `${c.daysOverdue}d overdue` : null
  if (key === 'goingCold') return c.daysSinceTouch ? `${c.daysSinceTouch}d cold` : null
  // Deliberately NO day counter: a lead nobody ever called is not "88 days late",
  // it is simply unworked, and an age badge on it manufactures guilt for a
  // commitment that never existed.
  if (key === 'neverContacted') return c.tier === 'T1' ? 'T1' : null
  return null
}

function ContactRow({ contact, bucket, onDone }: {
  contact: CrmContactView
  bucket: BucketKey
  onDone: () => void
}) {
  const [pending, start] = useTransition()
  const [busy, setBusy] = useState<string | null>(null)
  const meta = BUCKET_META[bucket]
  const days = dayLabel(contact, bucket)

  async function act(kind: 'log' | 'snooze' | 'unblock') {
    setBusy(kind)
    try {
      if (kind === 'log') {
        const text = window.prompt(`Log a touch for ${contact.name}:`)
        if (!text) return
        await fetch(`/api/crm/contacts/${contact.slug}/log`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, clearNextAction: true, via: 'dashboard' }),
        })
      } else if (kind === 'snooze') {
        await fetch(`/api/crm/contacts/${contact.slug}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ snoozeDays: 7, via: 'dashboard' }),
        })
      } else {
        await fetch(`/api/crm/contacts/${contact.slug}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blockedOn: null, via: 'dashboard' }),
        })
      }
      start(onDone)
    } finally {
      setBusy(null)
    }
  }

  const working = busy !== null || pending

  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border p-3 hover:bg-accent/30 transition-colors">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium truncate">{contact.name}</p>
          {days && (
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-xs ${meta.chip}`}>
              {days}
            </span>
          )}
          {contact.owner && (
            <span className="text-xs text-muted-foreground">{contact.owner}</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {contact.title ? `${contact.title} — ` : ''}{contact.agencyName ?? contact.agency ?? ''}
        </p>
        {contact.status === 'blocked' && contact.blockedOn && (
          <p className="mt-1 text-xs text-red-400">Blocked on: {contact.blockedOn}</p>
        )}
        {contact.nextAction && contact.status !== 'blocked' && (
          <p className="mt-1 text-xs text-foreground/80 truncate">{contact.nextAction}</p>
        )}
      </div>

      <div className="flex flex-shrink-0 items-center gap-1">
        {working && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        <button
          onClick={() => act('log')}
          disabled={working}
          title="Log a touch"
          className="rounded border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-40"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        {contact.status === 'blocked' ? (
          <button
            onClick={() => act('unblock')}
            disabled={working}
            title="Clear the blocker"
            className="rounded border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-40"
          >
            Unblock
          </button>
        ) : (
          <button
            onClick={() => act('snooze')}
            disabled={working}
            title="Snooze 7 days"
            className="rounded border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-40"
          >
            <Clock className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

function Bucket({ bucket, items, onDone }: {
  bucket: BucketKey
  items: CrmContactView[]
  onDone: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const meta = BUCKET_META[bucket]
  const Icon = meta.icon
  const shown = expanded ? items : items.slice(0, 5)

  return (
    <Card className={items.length > 0 ? meta.tone : ''}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-5 w-5" />
          {meta.label}
          <span className="font-mono text-sm text-muted-foreground">{items.length}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{meta.empty}</p>
        ) : (
          <>
            {shown.map(c => (
              <ContactRow key={c.slug} contact={c} bucket={bucket} onDone={onDone} />
            ))}
            {items.length > 5 && (
              <button
                onClick={() => setExpanded(v => !v)}
                className="text-xs text-blue-400 hover:underline"
              >
                {expanded ? 'Show less' : `Show ${items.length - 5} more`}
              </button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

export function PipelineBuckets({ buckets }: { buckets: CrmBuckets }) {
  const router = useRouter()
  const refresh = () => router.refresh()

  // Order is the argument: blocked first (cannot proceed), then overdue (late),
  // then today (on time), then cold (drifting).
  const order: BucketKey[] = ['blocked', 'overdue', 'dueToday', 'goingCold', 'neverContacted']

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Pipeline</h2>
        <span className="font-mono text-xs text-muted-foreground">
          {buckets.total} contacts
        </span>
      </div>
      {order.map(key => (
        <Bucket key={key} bucket={key} items={buckets[key]} onDone={refresh} />
      ))}
    </div>
  )
}
