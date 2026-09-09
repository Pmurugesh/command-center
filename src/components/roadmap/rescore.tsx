'use client'

/**
 * Rescore now.
 *
 * The board is derived by a daily cron, so a signal that lands after it runs
 * waits until tomorrow — about 40 hours from a Tuesday meeting to the ranking
 * moving, and 64 over a weekend. That is the right default (the check fetches
 * six clones and must not run on every page view) but it is the wrong answer
 * when you already know something changed.
 *
 * This triggers the same job the cron triggers, by name. Nothing else here
 * writes: the button cannot change the board's contents, only ask for them to
 * be recomputed, so the worst case is a wasted minute.
 *
 * On a machine without openclaw the route answers 503 and this says so plainly
 * rather than spinning — the same honesty rule the rest of the board follows.
 */
import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

type State = 'idle' | 'running' | 'ok' | 'error'

export function RescoreButton() {
  const [state, setState] = useState<State>('idle')
  const [message, setMessage] = useState('')

  async function run() {
    setState('running')
    setMessage('')
    try {
      const res = await fetch('/api/system/cron/roadmap-check/run', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setState('ok')
        setMessage('Rescored — reload to see it')
      } else {
        setState('error')
        setMessage(data.error ?? 'Failed')
      }
    } catch {
      setState('error')
      setMessage('Request failed')
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={state === 'running'}
        className={cn(
          'inline-flex items-center gap-1.5 rounded border border-border px-2 py-1',
          'text-[11px] text-muted-foreground transition-colors',
          'hover:border-foreground/30 hover:text-foreground disabled:opacity-50'
        )}
      >
        <RefreshCw className={cn('h-3 w-3', state === 'running' && 'animate-spin')} />
        {state === 'running' ? 'Rescoring…' : 'Rescore now'}
      </button>
      {message && (
        <span className={cn('text-[11px]', state === 'error' ? 'text-status-danger' : 'text-status-success')}>
          {message}
        </span>
      )}
    </span>
  )
}
