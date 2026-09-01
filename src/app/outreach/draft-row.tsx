'use client'

import { useState } from 'react'
import { Copy, Check, PenLine, CheckCircle2, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { OutreachDraft } from '@/lib/followup'

// ── display maps ──────────────────────────────────────────────────────────────

const PRIORITY_DOT: Record<string, string> = {
  high: 'bg-status-danger',
  medium: 'bg-status-warning',
  low: 'bg-muted-foreground/30',
}

const TRIGGER_LABEL: Record<string, string> = {
  'crm-due': 'overdue',
  'post-meeting': 'post-meeting',
  'bid-submitted': 'bid follow-up',
  'cold-contact': 'going cold',
  'manual': 'manual',
}

const TRIGGER_COLOR: Record<string, string> = {
  'crm-due': 'bg-status-danger/10 text-status-danger border-status-danger/30',
  'post-meeting': 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  'bid-submitted': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  'cold-contact': 'bg-status-warning/10 text-status-warning border-status-warning/30',
  'manual': 'bg-muted text-muted-foreground border-border',
}

// ── sub-components ────────────────────────────────────────────────────────────

function AgingChip({ days }: { days?: number }) {
  if (days === undefined) return null
  const label = days === 0 ? 'today' : days === 1 ? '1d' : `${days}d`
  const cls =
    days > 14
      ? 'bg-status-danger/10 text-status-danger border-status-danger/30'
      : days > 7
      ? 'bg-status-warning/10 text-status-warning border-status-warning/30'
      : 'bg-muted text-muted-foreground border-border'
  return (
    <span className={cn('shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] tabular-nums', cls)}>
      {label}
    </span>
  )
}

// ── main component ────────────────────────────────────────────────────────────

export function DraftRow({
  draft,
  onMarkSent,
  onEdited,
}: {
  draft: OutreachDraft
  onMarkSent: (slug: string, sentAt: string) => void
  onEdited: (slug: string, subject: string, body: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [subject, setSubject] = useState(draft.subject)
  const [body, setBody] = useState(draft.body)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [marking, setMarking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isSent = draft.status === 'sent'
  const triggerLabel = draft.triggerKind ? TRIGGER_LABEL[draft.triggerKind] : undefined
  const triggerCls = draft.triggerKind ? TRIGGER_COLOR[draft.triggerKind] : undefined

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('Clipboard blocked — select and copy manually')
    }
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/drafts/${draft.slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'save failed')
      onEdited(draft.slug, subject, body)
      setExpanded(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed')
    } finally {
      setSaving(false)
    }
  }

  async function markSent() {
    setMarking(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/drafts/${draft.slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark-sent' }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'failed')
      const data = await res.json()
      onMarkSent(draft.slug, data.sentAt ?? new Date().toISOString())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'mark sent failed')
    } finally {
      setMarking(false)
    }
  }

  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        {/* Priority dot */}
        <div className={cn(
          'mt-[5px] h-2 w-2 shrink-0 rounded-full',
          PRIORITY_DOT[draft.priority]
        )} />

        <div className="min-w-0 flex-1">
          {/* Header row: name · agency + chips */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium leading-snug">
              {draft.contactName ?? draft.slug}
              {draft.contactAgencyName && (
                <span className="font-normal text-muted-foreground">
                  {' · '}{draft.contactAgencyName}
                </span>
              )}
            </span>
            <AgingChip days={draft.agingDays} />
            {triggerLabel && (
              <span className={cn(
                'rounded-full border px-2 py-0.5 text-[10px]',
                triggerCls
              )}>
                {triggerLabel}
              </span>
            )}
            {draft.edited && (
              <span className="text-[10px] italic text-muted-foreground">edited</span>
            )}
          </div>

          {/* Subject */}
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {draft.subject}
          </p>

          {/* To: */}
          {draft.to && !isSent && (
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground/50">
              {draft.to}
            </p>
          )}

          {/* Sent metadata */}
          {isSent && draft.sentAt && (
            <p className="mt-0.5 text-[11px] text-emerald-400">
              Sent{' '}
              {new Date(draft.sentAt).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
              })}
            </p>
          )}

          {/* Error */}
          {error && (
            <p className="mt-1 text-xs text-status-danger">{error}</p>
          )}

          {/* Action buttons — only for open drafts */}
          {!isSent && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="touch" onClick={copy}>
                {copied
                  ? <><Check className="h-3.5 w-3.5" /><span className="ml-1">Copied</span></>
                  : <><Copy className="h-3.5 w-3.5" /><span className="ml-1">Copy</span></>}
              </Button>

              <Button
                size="touch"
                variant="outline"
                onClick={() => setExpanded(e => !e)}
              >
                {expanded
                  ? <><X className="h-3.5 w-3.5" /><span className="ml-1">Close</span></>
                  : <><PenLine className="h-3.5 w-3.5" /><span className="ml-1">Edit</span></>}
              </Button>

              <Button
                size="touch"
                variant="outline"
                onClick={markSent}
                disabled={marking}
              >
                {marking
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <><CheckCircle2 className="h-3.5 w-3.5" /><span className="ml-1">Mark Sent</span></>}
              </Button>
            </div>
          )}

          {/* Inline editor */}
          {expanded && !isSent && (
            <div className="mt-3 space-y-2 rounded-md border border-border bg-card/50 p-3">
              <input
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="Subject"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                rows={12}
                className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="touch" onClick={copy}>
                  {copied
                    ? <><Check className="h-3.5 w-3.5" /><span className="ml-1">Copied</span></>
                    : <><Copy className="h-3.5 w-3.5" /><span className="ml-1">Copy</span></>}
                </Button>
                <Button
                  size="touch"
                  variant="outline"
                  onClick={save}
                  disabled={saving}
                >
                  {saving
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : 'Save edits'}
                </Button>
                <Button
                  size="touch"
                  variant="ghost"
                  onClick={() => setExpanded(false)}
                >
                  Cancel
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  {draft.edited
                    ? 'Your edited version — not regenerated.'
                    : 'Scaffold from contact log. Edit before sending.'}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  )
}
