"use client"

/**
 * Today's Moves — the single ranked action queue.
 *
 * One list, leverage-ranked, every row a verb. Replaces the Decisions,
 * Action Queue, Morning Actions, and Leverage cards; the merge those four
 * forced on the reader now happens in lib/moves.ts.
 *
 * Quick actions follow the pipeline-buckets mutation recipe: busy flag +
 * fetch + useTransition(router.refresh) — the server re-render is the truth.
 */
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Zap, ArrowRight, Loader2, Check } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { Move } from '@/lib/moves'

function daysUntil(due: string): number {
  const [y, m, d] = due.split('-').map(Number)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return Math.round((new Date(y, m - 1, d).getTime() - today) / 86_400_000)
}

function DueChip({ due }: { due: string }) {
  const d = daysUntil(due)
  const label = d < 0 ? `${-d}d overdue` : d === 0 ? 'today' : `${d}d`
  const tone =
    d <= 0 ? 'bg-status-danger/10 text-status-danger border-status-danger/30' :
    d <= 2 ? 'bg-status-warning/10 text-status-warning border-status-warning/30' :
    'bg-muted text-muted-foreground border-border'
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] tabular-nums ${tone}`}>
      {label}
    </span>
  )
}

function MoveRow({ move, working, onLogTouch, onResolve }: {
  move: Move
  working: boolean
  onLogTouch: (slug: string) => void
  onResolve: (file: string, lineNumber: number) => void
}) {
  return (
    // Meta stacks under the action on phones — chips must never eat the verb.
    <li className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0 md:flex-row md:items-start md:gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link href={move.href} className="group flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium group-hover:text-blue-400">
              {move.action}
            </span>
            <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground group-hover:text-blue-400" />
          </Link>
        </div>
        {move.detail && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{move.detail}</p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {move.due && <DueChip due={move.due} />}
        <Badge variant="outline" className="text-[10px]">{move.source}</Badge>
        {move.kind === 'crm-due' && move.contactSlug && (
          <Button size="touch" onClick={() => onLogTouch(move.contactSlug!)} disabled={working}>
            {working ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Log touch'}
          </Button>
        )}
        {move.kind === 'strategic' && move.file && move.lineNumber !== undefined && (
          <Button
            size="touch"
            onClick={() => onResolve(move.file!, move.lineNumber!)}
            disabled={working}
            title="Mark answered — appends [RESOLVED] to the line in the source file"
          >
            {working ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Check className="h-3 w-3" />Resolve</>}
          </Button>
        )}
      </div>
    </li>
  )
}

export function MovesCard({ moves, limit = 7 }: { moves: Move[]; limit?: number }) {
  const router = useRouter()
  const [workingId, setWorkingId] = useState<string | null>(null)
  const [, start] = useTransition()

  const act = async (id: string, fn: () => Promise<Response>) => {
    setWorkingId(id)
    try {
      await fn()
    } finally {
      setWorkingId(null)
      start(() => router.refresh())
    }
  }

  const onLogTouch = (slug: string) => {
    const text = window.prompt('What happened? (logged as a touch)')
    if (!text) return
    void act(`crm:${slug}`, () =>
      fetch(`/api/crm/contacts/${slug}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, clearNextAction: true }),
      })
    )
  }

  const onResolve = (file: string, lineNumber: number) => {
    void act(`strategic:${file}:${lineNumber}`, () =>
      fetch('/api/gtm/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file, lineNumber }),
      })
    )
  }

  const visible = moves.slice(0, limit)
  const overflow = moves.slice(limit)
  const isWorking = (m: Move) =>
    workingId === (m.kind === 'crm-due' ? `crm:${m.contactSlug}` : `strategic:${m.file}:${m.lineNumber}`)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Zap className="h-4 w-4" />
          Today&apos;s moves
          <Badge variant="outline" className="font-mono text-[10px] tabular-nums">{moves.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {moves.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing needs you. Go sell.</p>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {visible.map(m => (
                <MoveRow key={m.id} move={m} working={isWorking(m)} onLogTouch={onLogTouch} onResolve={onResolve} />
              ))}
            </ul>
            {overflow.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer select-none py-2 text-xs text-muted-foreground transition-colors hover:text-foreground">
                  Show {overflow.length} more
                </summary>
                <ul className="divide-y divide-border">
                  {overflow.map(m => (
                    <MoveRow key={m.id} move={m} working={isWorking(m)} onLogTouch={onLogTouch} onResolve={onResolve} />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
