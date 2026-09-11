'use client'

/**
 * The morning view: everything that needs attention, grouped by agency.
 *
 * The agency is the client; the people inside it are touchpoints. A flat list of
 * people put Shafi's year-old OEIS demo on the board as its own alarm while the
 * same work moved forward through Pindy (2026-09-10). Grouped, one agency reads
 * as one situation: what is wrong there, and when we last spoke to anyone.
 *
 * Agencies arrive ranked by their most urgent row (crm.ts), and rows keep the
 * order that has always been the argument: blocked (cannot proceed), overdue
 * (late), due today, going cold (drifting), not started. Day counters are the
 * point — "89d" is a fact nobody argues with, where "pending" is a status that
 * survived three months unnoticed.
 *
 * Every row acts in place. Navigating to a detail page to change a status is
 * how a CRM becomes something you stop updating.
 */
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle, Ban, CalendarClock, Snowflake, Check, Clock, Loader2, UserPlus,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { CrmAgencyGroup, CrmBucketKey, CrmBuckets, CrmContactView } from '@/types'

const BUCKET_META: Record<CrmBucketKey, {
  label: string
  icon: typeof AlertTriangle
  tone: string
  chip: string
}> = {
  blocked: {
    label: 'blocked',
    icon: Ban,
    tone: 'border-red-500/30 bg-red-500/5',
    chip: 'bg-red-500/10 text-red-400 border-red-500/30',
  },
  overdue: {
    label: 'overdue',
    icon: AlertTriangle,
    tone: 'border-amber-500/30 bg-amber-500/5',
    chip: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  },
  dueToday: {
    label: 'due today',
    icon: CalendarClock,
    tone: 'border-blue-500/30 bg-blue-500/5',
    chip: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  },
  goingCold: {
    label: 'going cold',
    icon: Snowflake,
    tone: 'border-slate-500/30 bg-slate-500/5',
    chip: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
  },
  notStarted: {
    label: 'not started',
    icon: UserPlus,
    tone: '',
    chip: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
  },
}

// Order of the summary chips only. The rows arrive already ranked from crm.ts.
const SUMMARY_ORDER: CrmBucketKey[] = ['blocked', 'overdue', 'dueToday', 'goingCold', 'notStarted']
const AGENCIES_SHOWN = 8

/** Rows no longer sit under a bucket heading, so every row names its bucket. */
function chipLabel(c: CrmContactView, bucket: CrmBucketKey): string {
  if (bucket === 'blocked' && c.daysBlocked) return `${c.daysBlocked}d blocked`
  if (bucket === 'overdue' && c.daysOverdue) return `${c.daysOverdue}d overdue`
  if (bucket === 'goingCold' && c.daysSinceTouch) return `${c.daysSinceTouch}d cold`
  // Deliberately NO day counter on not-started: a lead nobody ever called is not
  // "88 days late", it is simply unworked, and an age badge on it manufactures
  // guilt for a commitment that never existed.
  if (bucket === 'notStarted' && c.tier === 'T1') return 'not started · T1'
  return BUCKET_META[bucket].label
}

function touchLabel(t: NonNullable<CrmAgencyGroup['lastTouch']>): string {
  return `last touch ${t.days <= 0 ? 'today' : `${t.days}d ago`} · ${t.name}`
}

function ContactRow({ contact, bucket, onDone }: {
  contact: CrmContactView
  bucket: CrmBucketKey
  onDone: () => void
}) {
  const [pending, start] = useTransition()
  const [busy, setBusy] = useState<string | null>(null)

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
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-xs ${BUCKET_META[bucket].chip}`}>
            {chipLabel(contact, bucket)}
          </span>
          {contact.owner && (
            <span className="text-xs text-muted-foreground">{contact.owner}</span>
          )}
        </div>
        {/* The agency is the card header, so the row carries only the title. */}
        {contact.title && (
          <p className="text-xs text-muted-foreground truncate">{contact.title}</p>
        )}
        {contact.status === 'blocked' && contact.blockedOn && (
          <p className="mt-1 text-xs text-red-400">Blocked on: {contact.blockedOn}</p>
        )}
        {contact.nextAction && contact.status !== 'blocked' && (
          <p className="mt-1 text-xs text-foreground/80 truncate">{contact.nextAction}</p>
        )}
      </div>

      <div className="flex flex-shrink-0 items-center gap-1">
        {working && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        <Button size="touch" onClick={() => act('log')} disabled={working} title="Log a touch">
          <Check className="h-3.5 w-3.5" />
        </Button>
        {contact.status === 'blocked' ? (
          <Button size="touch" onClick={() => act('unblock')} disabled={working} title="Clear the blocker">
            Unblock
          </Button>
        ) : (
          <Button size="touch" onClick={() => act('snooze')} disabled={working} title="Snooze 7 days">
            <Clock className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}

function AgencyCard({ group, onDone }: { group: CrmAgencyGroup; onDone: () => void }) {
  // Items are in urgency order, so the first one is the agency's worst.
  const worst = BUCKET_META[group.items[0].bucket]
  const Icon = worst.icon

  return (
    <Card className={worst.tone}>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-base">
          <Icon className="h-4 w-4 self-center" />
          {group.agency ? (
            <Link href={`/agencies/${encodeURIComponent(group.agency)}`} className="hover:underline">
              {group.agencyName}
            </Link>
          ) : group.agencyName}
          {group.lastTouch && (
            <span className="text-xs font-normal text-muted-foreground">{touchLabel(group.lastTouch)}</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {group.items.map(({ bucket, contact }) => (
          <ContactRow key={contact.slug} contact={contact} bucket={bucket} onDone={onDone} />
        ))}
      </CardContent>
    </Card>
  )
}

export function PipelineBuckets({ buckets }: { buckets: CrmBuckets }) {
  const router = useRouter()
  const refresh = () => router.refresh()
  const [expanded, setExpanded] = useState(false)

  const groups = buckets.byAgency
  const shown = expanded ? groups : groups.slice(0, AGENCIES_SHOWN)
  const counts = SUMMARY_ORDER
    .map(key => ({ key, n: buckets[key].length }))
    .filter(({ n }) => n > 0)

  return (
    // scroll-mt clears the top bar when a Move deep-links here via /#pipeline
    <div id="pipeline" className="scroll-mt-16 space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Pipeline</h2>
        <span className="font-mono text-xs text-muted-foreground">
          {buckets.total} contacts
        </span>
      </div>
      {counts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">
            {groups.length} {groups.length === 1 ? 'agency' : 'agencies'}
          </span>
          {counts.map(({ key, n }) => (
            <span key={key} className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono ${BUCKET_META[key].chip}`}>
              {n} {BUCKET_META[key].label}
            </span>
          ))}
        </div>
      )}
      {/* Sourced contacts are counted, not listed. They are business cards from a
          conference, not work anyone committed to — browsable, not a to-do. */}
      {buckets.sourcedCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {buckets.sourcedCount} sourced contacts not yet in the pipeline ·{' '}
          <Link href="/agencies" className="text-blue-400 hover:underline">browse by agency →</Link>
        </p>
      )}
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing needs attention. Every agency is current.</p>
      ) : (
        <>
          {shown.map(g => (
            <AgencyCard key={g.agency ?? g.items[0].contact.slug} group={g} onDone={refresh} />
          ))}
          {groups.length > AGENCIES_SHOWN && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="text-xs text-blue-400 hover:underline"
            >
              {expanded ? 'Show fewer agencies' : `Show ${groups.length - AGENCIES_SHOWN} more agencies`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
