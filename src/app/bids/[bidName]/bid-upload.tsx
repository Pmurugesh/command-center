'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload } from 'lucide-react'
import { AgentSelect } from '@/components/shared/agent-select'

export function BidUpload({ bidName }: { bidName: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formEl = e.currentTarget
    const data = new FormData(formEl)
    setBusy(true)
    setResult(null)
    try {
      const res = await fetch(`/api/bids/${encodeURIComponent(bidName)}/documents`, {
        method: 'POST',
        body: data,
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Upload failed')
      setResult({
        ok: true,
        text: `Saved ${json.saved.length} file${json.saved.length === 1 ? '' : 's'} — agent notified`,
      })
      formEl.reset()
      router.refresh()
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : 'Upload failed' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <input
        type="file"
        name="files"
        multiple
        required
        className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm file:text-foreground hover:file:bg-accent/50 file:cursor-pointer"
      />
      <input
        name="note"
        placeholder="Note for the agent (optional)"
        className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <AgentSelect />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Upload className="h-3.5 w-3.5" />
          {busy ? 'Uploading...' : 'Add documents'}
        </button>
        {result && (
          <p className={`text-xs ${result.ok ? 'text-emerald-400' : 'text-red-400'}`}>{result.text}</p>
        )}
      </div>
    </form>
  )
}
