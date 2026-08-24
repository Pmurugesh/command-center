'use client'

import { useEffect, useState } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import type { IntakeReviewItem } from '@/types'

/**
 * The "uncertain" lane of email intake: staged messages that matched no CRM
 * contact exactly. Each row is resolved by a human — into a contact, or away.
 * Only distilled metadata is shown; bodies never leave the staging dir.
 */
export function ReviewQueue() {
  const [items, setItems] = useState<IntakeReviewItem[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/intake/review')
      .then(r => r.json())
      .then(d => setItems(Array.isArray(d) ? d : []))
      .catch(() => setItems([]))
  }, [])

  async function resolve(item: IntakeReviewItem, createContact: boolean) {
    setBusy(item.id)
    setError(null)
    try {
      if (createContact) {
        // Deterministic prefill only: display name (or the address's local
        // part), the address itself, and — for government senders — the agency
        // code straight from the domain. Everything is editable on the contact.
        const domain = item.email.split('@')[1] ?? ''
        const gov = domain.match(/^([a-z0-9-]+)\.ca\.gov$/) ?? domain.match(/^([a-z0-9-]+)\.gov$/)
        const res = await fetch('/api/crm/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: item.fromName || item.email.split('@')[0],
            email: item.email,
            agency: gov ? gov[1].toUpperCase() : undefined,
            source: 'email-intake',
            via: 'intake-review',
          }),
        })
        if (!res.ok) throw new Error((await res.json()).error || 'contact creation failed')
      }
      const res = await fetch('/api/intake/review', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: item.id,
          status: createContact ? 'contact-created' : 'dismissed',
          via: 'dashboard',
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'update failed')
      setItems(prev => (prev ?? []).filter(i => i.id !== item.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(null)
    }
  }

  if (items === null) return null
  if (!items.length) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Email review queue</CardTitle>
        <CardDescription>
          Correspondence with people the CRM doesn&apos;t know yet — add them or dismiss.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && <p className="mb-3 text-sm text-red-500">{error}</p>}
        <ul className="divide-y divide-border">
          {items.map(item => (
            <li key={item.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">
                  <span className="font-medium">{item.fromName || item.email}</span>
                  {item.fromName && (
                    <span className="ml-2 text-muted-foreground">{item.email}</span>
                  )}
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  {item.direction === 'out' ? '→ we wrote: ' : ''}&ldquo;{item.subject}&rdquo;
                </p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-mono">{item.date}</span> · {item.matched}
                  {item.count > 1 && <span> · {item.count} messages</span>}
                </p>
              </div>
              <button
                onClick={() => resolve(item, true)}
                disabled={busy === item.id}
                className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-accent/50 disabled:opacity-50"
              >
                Add to CRM
              </button>
              <button
                onClick={() => resolve(item, false)}
                disabled={busy === item.id}
                className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent/50 disabled:opacity-50"
              >
                Dismiss
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
