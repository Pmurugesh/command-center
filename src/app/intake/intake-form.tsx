'use client'

import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Send } from 'lucide-react'
import { AgentSelect } from '@/components/shared/agent-select'

const DESTINATIONS = [
  { value: 'inbox', label: 'Inbox — agent files it (default)' },
  { value: 'intelligence', label: 'Intelligence — research material' },
  { value: 'business', label: 'Business context — company docs' },
]

export function IntakeForm() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formEl = e.currentTarget
    const data = new FormData(formEl)
    setBusy(true)
    setResult(null)
    try {
      const res = await fetch('/api/intake', { method: 'POST', body: data })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Upload failed')
      setResult({
        ok: true,
        text: `Saved ${json.saved.length} file${json.saved.length === 1 ? '' : 's'} to ${json.dest} — agent notified`,
      })
      formEl.reset()
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : 'Upload failed' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Send files to the agent</CardTitle>
        <CardDescription>
          Files are saved on the mini and OpenClaw processes them immediately — confirmation arrives on
          Telegram.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="file"
            name="files"
            multiple
            required
            className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm file:text-foreground hover:file:bg-accent/50 file:cursor-pointer"
          />
          <select
            name="destination"
            defaultValue="inbox"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {DESTINATIONS.map(d => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
          <input
            name="note"
            placeholder="Note for the agent (optional — what is this, what should happen)"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <AgentSelect />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="h-3.5 w-3.5" />
              {busy ? 'Sending...' : 'Send to agent'}
            </button>
            {result && (
              <p className={`text-xs ${result.ok ? 'text-emerald-400' : 'text-red-400'}`}>{result.text}</p>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
