'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2, Copy, Check } from 'lucide-react'

interface Draft { slug: string; subject: string; body: string; edited: boolean }

/**
 * The draft behind an overdue touch. Assembled from the contact's own log and
 * next action — every line traces to something in the store, so it can't invent
 * a commitment. You edit before sending; nothing here sends mail.
 */
export function FollowupDraft({ slug, onClose }: { slug: string; onClose: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetch(`/api/crm/contacts/${slug}/followup`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error('could not load draft')))
      .then((d: Draft) => { if (live) { setDraft(d); setSubject(d.subject); setBody(d.body) } })
      .catch(e => live && setError(e.message))
    return () => { live = false }
  }, [slug])

  async function save() {
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/crm/contacts/${slug}/followup`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'save failed')
      setDraft(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed')
    } finally { setSaving(false) }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { setError('clipboard blocked — select and copy manually') }
  }

  if (error && !draft) return <p className="mt-2 text-xs text-status-danger">{error}</p>
  if (!draft) {
    return (
      <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Building draft from the contact log…
      </p>
    )
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-border bg-card/50 p-3">
      <input
        value={subject}
        onChange={e => setSubject(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-status-accent/50"
      />
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        rows={11}
        className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs leading-relaxed focus:outline-none focus:border-status-accent/50"
      />
      {error && <p className="text-xs text-status-danger">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="touch" onClick={copy}>
          {copied ? <><Check className="h-3.5 w-3.5" /><span className="ml-1.5">Copied</span></>
                  : <><Copy className="h-3.5 w-3.5" /><span className="ml-1.5">Copy</span></>}
        </Button>
        <Button size="touch" variant="outline" disabled={saving} onClick={save}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save edits'}
        </Button>
        <Button size="touch" variant="ghost" onClick={onClose}>Close</Button>
        <span className="text-[11px] text-muted-foreground">
          {draft.edited ? 'Your edited version — not regenerated.' : 'Scaffold from the contact log. Edit before sending.'}
        </span>
      </div>
    </div>
  )
}
