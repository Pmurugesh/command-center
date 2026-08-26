'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Plus, Loader2, X } from 'lucide-react'

const ENTITIES = ['Pavan Personal', 'Infinite Solutions', 'InfiniteAI', 'NovaEra']

/**
 * Add a post outside the Monday run. The timeliest content — an event you just
 * left, a thought with a short shelf life — is exactly what a weekly batch
 * can't produce, so waiting until Monday would lose it.
 */
export function NewPostForm() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [entity, setEntity] = useState(ENTITIES[0])
  const [topic, setTopic] = useState('')
  const [hook, setHook] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!topic.trim()) { setError('Give it a topic.'); return }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity, topic, hook }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'could not create')
      setTopic(''); setHook(''); setOpen(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <Button size="touch" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" />
        <span className="ml-1.5">New post</span>
      </Button>
    )
  }

  return (
    <Card className="border-status-accent/30">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">New post</h3>
          <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Entity</span>
            <select
              value={entity}
              onChange={e => setEntity(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-status-accent/50"
            >
              {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Topic</span>
            <input
              value={topic}
              onChange={e => setTopic(e.target.value)}
              autoFocus
              placeholder="What's it about?"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:border-status-accent/50"
            />
          </label>
        </div>

        <label className="space-y-1 block">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Hook / notes <span className="normal-case font-normal">(optional)</span></span>
          <textarea
            value={hook}
            onChange={e => setHook(e.target.value)}
            rows={2}
            placeholder="The opening line, or just what you want to say."
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:border-status-accent/50"
          />
        </label>

        {error && <p className="text-sm text-status-danger">{error}</p>}

        <div className="flex items-center gap-2">
          <Button size="touch" disabled={busy} onClick={submit}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Add post'}
          </Button>
          <Button size="touch" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <span className="text-xs text-muted-foreground">Saved as picked — Voice sees you wrote it yourself.</span>
        </div>
      </CardContent>
    </Card>
  )
}
