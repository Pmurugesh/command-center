'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/shared/status-badge'
import { Check, X, MessageSquare, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ContentSuggestion, ContentStatus } from '@/types'

const ENTITY_STYLE: Record<string, string> = {
  'infiniteai': 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  'infinite solutions': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  'novaera': 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  'pavan personal': 'bg-status-warning/10 text-status-warning border-status-warning/30',
}

// 'suggested' has no badge — it's the resting state, and badging every card
// would make the two you actually decided on harder to spot.
const DECIDED: Record<string, string> = {
  picked: 'ok',
  skipped: 'disabled',
  drafted: 'running',
}

export function SuggestionList({ initial }: { initial: ContentSuggestion[] }) {
  const [items, setItems] = useState(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [drafting, setDrafting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(id)
    setError(null)
    try {
      const res = await fetch(`/api/content/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'update failed')
      const updated: ContentSuggestion = await res.json()
      setItems(prev => prev.map(i => (i.id === id ? updated : i)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(null)
    }
  }

  if (items.length === 0) return null

  return (
    <div className="space-y-4">
      {error && (
        <p className="text-sm text-status-danger">{error}</p>
      )}
      {items.map(s => {
        const entityClass = ENTITY_STYLE[s.entity.toLowerCase()]
          ?? 'bg-muted text-muted-foreground border-border'
        const expanded = open === s.id
        const decided = s.status !== 'suggested'

        return (
          <Card key={s.id} className={cn(decided && 'opacity-90')}>
            <CardContent className="p-5 space-y-3">
              {/* Header — entity, day, decision state */}
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <span className={cn(
                    'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
                    entityClass,
                  )}>
                    {s.entity}
                  </span>
                  <span className="text-xs text-muted-foreground">{s.day}</span>
                  {s.optional && (
                    <span className="text-xs text-muted-foreground/70 italic">backlog</span>
                  )}
                </div>
                {decided && <StatusBadge status={DECIDED[s.status] ?? 'idle'} label={s.status} />}
              </div>

              <h3 className="text-base font-semibold leading-snug">{s.topic}</h3>

              {/* The hook is the thing you actually judge, so it leads. */}
              {s.hook && (
                <blockquote className="border-l-2 border-status-accent/40 pl-3 text-sm text-foreground/90 italic">
                  {s.hook}
                </blockquote>
              )}

              <button
                onClick={() => setOpen(expanded ? null : s.id)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Angle, signal &amp; value
              </button>

              {expanded && (
                <div className="space-y-3 text-sm border-l border-border pl-3">
                  {s.angle && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Draft angle</p>
                      <p className="text-muted-foreground leading-relaxed">{s.angle}</p>
                    </div>
                  )}
                  {s.signalSource && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Signal source</p>
                      <p className="text-muted-foreground leading-relaxed">{s.signalSource}</p>
                    </div>
                  )}
                  {s.strategicValue && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Strategic value</p>
                      <p className="text-muted-foreground leading-relaxed">{s.strategicValue}</p>
                    </div>
                  )}
                </div>
              )}

              {s.draft && (
                <div className="rounded-md border border-border bg-card/50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Draft</p>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{s.draft}</p>
                </div>
              )}

              {s.feedback && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-semibold">Your note:</span> {s.feedback}
                </p>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1 flex-wrap">
                <Button
                  size="touch"
                  disabled={busy === s.id}
                  onClick={() => patch(s.id, { status: s.status === 'picked' ? 'suggested' : 'picked' })}
                  className={cn(s.status === 'picked' && 'border-status-success/40 text-status-success')}
                >
                  {busy === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  <span className="ml-1.5">{s.status === 'picked' ? 'Picked' : 'Pick'}</span>
                </Button>
                <Button
                  size="touch"
                  disabled={busy === s.id}
                  onClick={() => patch(s.id, { status: s.status === 'skipped' ? 'suggested' : 'skipped' })}
                  className={cn(s.status === 'skipped' && 'border-status-danger/40 text-status-danger')}
                >
                  <X className="h-3.5 w-3.5" />
                  <span className="ml-1.5">{s.status === 'skipped' ? 'Skipped' : 'Skip'}</span>
                </Button>
                <Button
                  size="touch"
                  variant="ghost"
                  onClick={() => setDrafting(drafting === s.id ? null : s.id)}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span className="ml-1.5">{s.feedback ? 'Edit note' : 'Feedback'}</span>
                </Button>
              </div>

              {drafting === s.id && (
                <FeedbackBox
                  initial={s.feedback ?? ''}
                  busy={busy === s.id}
                  onCancel={() => setDrafting(null)}
                  onSave={async (text) => {
                    await patch(s.id, { feedback: text })
                    setDrafting(null)
                  }}
                />
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function FeedbackBox({ initial, busy, onSave, onCancel }: {
  initial: string
  busy: boolean
  onSave: (text: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(initial)
  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={3}
        autoFocus
        placeholder="What's wrong with this angle, or what would make it work? Voice reads this next Monday."
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:border-status-accent/50"
      />
      <div className="flex items-center gap-2">
        <Button size="touch" disabled={busy} onClick={() => onSave(text.trim())}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save note'}
        </Button>
        <Button size="touch" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}
