'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Plus, Upload, X } from 'lucide-react'
import { AgentSelect } from '@/components/shared/agent-select'

export function NewBidForm() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formEl = e.currentTarget
    const data = new FormData(formEl)
    setBusy(true)
    setResult(null)
    try {
      const res = await fetch('/api/bids', { method: 'POST', body: data })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Upload failed')
      setResult({
        ok: true,
        text: `Saved ${json.saved.length} file${json.saved.length === 1 ? '' : 's'} to bids/${json.bidName}/documents — agent notified`,
      })
      formEl.reset()
      router.refresh()
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : 'Upload failed' })
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div>
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent/50 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New bid from RFP docs
        </button>
        {result && (
          <p className={`text-xs mt-2 ${result.ok ? 'text-emerald-400' : 'text-red-400'}`}>{result.text}</p>
        )}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="h-4 w-4" />
            New bid from RFP documents
          </CardTitle>
          <button
            onClick={() => setOpen(false)}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            name="name"
            required
            placeholder="Bid name (e.g. ITN-37485 or caltrans-reporting)"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <input
            name="note"
            placeholder="Note for the agent (optional — deadline, entity, context)"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <input
            type="file"
            name="files"
            multiple
            required
            className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm file:text-foreground hover:file:bg-accent/50 file:cursor-pointer"
          />
          <AgentSelect />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Upload className="h-3.5 w-3.5" />
              {busy ? 'Uploading...' : 'Create bid'}
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
