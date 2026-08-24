/**
 * Brief sub-cards, being decomposed into the new Today layout.
 *
 * MomentumCard is gone (Scoreboard) and LeverageCard is gone (Today's Moves).
 * ShapeCard and HealthCard move to their own homes next, then this file goes
 * away.
 */
import Link from 'next/link'
import { BarChart3, HeartPulse } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import type { Insights, ShapeBucket } from '@/lib/insights'

function Bar({ buckets, tone }: { buckets: ShapeBucket[]; tone: string }) {
  const max = Math.max(1, ...buckets.map(b => b.count))
  return (
    <div className="space-y-1.5">
      {buckets.slice(0, 6).map(b => (
        <div key={b.key} className="flex items-center gap-2">
          <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">{b.key}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-border">
            <div className={`h-full rounded-full ${tone}`} style={{ width: `${(b.count / max) * 100}%` }} />
          </div>
          <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums">{b.count}</span>
        </div>
      ))}
    </div>
  )
}

export function ShapeCard({ shape }: { shape: Insights['shape'] }) {
  const allIdentified = shape.stages.length === 1 && shape.stages[0].key === 'identified'
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="h-5 w-5" />
          Pipeline shape
          <span className="font-mono text-sm text-muted-foreground">{shape.liveTotal} live</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Stage</p>
          <Bar buckets={shape.stages} tone="bg-blue-500" />
          {allIdentified && (
            // A single flat bar is not a rendering failure — it is the finding.
            <p className="mt-2 text-xs text-amber-400">
              Every contact is still at &ldquo;identified&rdquo;. Nobody has been contacted yet.
            </p>
          )}
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Owner load</p>
          <Bar buckets={shape.owners} tone="bg-purple-500" />
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Product</p>
          <Bar buckets={shape.products} tone="bg-emerald-500" />
        </div>
      </CardContent>
    </Card>
  )
}

export function HealthCard({ health }: { health: Insights['health'] }) {
  const dot = { ok: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-red-500' }
  const worst = health.some(h => h.status === 'bad') ? 'bad'
    : health.some(h => h.status === 'warn') ? 'warn' : 'ok'
  return (
    <Card className={worst === 'bad' ? 'border-red-500/30' : worst === 'warn' ? 'border-amber-500/30' : ''}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <HeartPulse className="h-5 w-5" />
          Machine health
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
          {health.map(h => (
            <div key={h.label} className="flex items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${dot[h.status]}`} />
              <span className="text-sm">{h.label}</span>
              <span className="ml-auto truncate text-xs text-muted-foreground">{h.detail}</span>
            </div>
          ))}
        </div>
        <Link href="/system" className="mt-3 inline-block text-xs text-blue-400 hover:underline">
          System detail →
        </Link>
      </CardContent>
    </Card>
  )
}

