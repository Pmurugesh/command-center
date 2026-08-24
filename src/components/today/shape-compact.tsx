import { BarChart3 } from 'lucide-react'
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

/**
 * Pipeline shape, one compact card: stage funnel, owner load, product
 * concentration side by side on wide screens. Extracted from the old daily
 * brief — the shape is context, not action, so it lives below the queues.
 */
export function ShapeCompact({ shape }: { shape: Insights['shape'] }) {
  const allIdentified = shape.stages.length === 1 && shape.stages[0].key === 'identified'
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="h-4 w-4" />
          Pipeline shape
          <span className="font-mono text-sm text-muted-foreground">{shape.liveTotal} live</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid gap-4 lg:grid-cols-3">
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
        </div>
      </CardContent>
    </Card>
  )
}
