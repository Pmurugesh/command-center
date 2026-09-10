import { Card, CardContent } from '@/components/ui/card'
import { CHANNEL_WARN_DAYS, CHANNEL_COLD_DAYS, type Channel } from '@/lib/channels'
import { cn } from '@/lib/utils'

/**
 * Every channel's silence on one axis.
 *
 * lib/channels.ts exists because SLP sat untouched for 355 days and nobody
 * noticed. The page meant to prevent that scattered fourteen staleness pills
 * across three screens of cards, which is precisely how a 355-day outlier
 * hides: it looks like every other pill.
 *
 * One axis, warn and cold marked, worst labelled. The outlier is the shape.
 */
export function StalenessStrip({ channels }: { channels: Channel[] }) {
  const touched = channels.filter(c => c.daysSinceTouch !== null)
  if (touched.length === 0) return null

  const max = Math.max(CHANNEL_COLD_DAYS + 30, ...touched.map(c => c.daysSinceTouch!))
  const pct = (d: number) => Math.min(100, (d / max) * 100)

  // Label only what earns it: the three quietest past the warn line.
  const labelled = new Set(
    [...touched]
      .filter(c => c.daysSinceTouch! >= CHANNEL_WARN_DAYS)
      .sort((a, b) => b.daysSinceTouch! - a.daysSinceTouch!)
      .slice(0, 3)
      .map(c => c.slug),
  )

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-baseline gap-3">
          <h2 className="text-sm font-semibold">Days since last touch</h2>
          <p className="text-xs text-muted-foreground">
            {touched.length} channel{touched.length === 1 ? '' : 's'} · warn at {CHANNEL_WARN_DAYS}d · cold at {CHANNEL_COLD_DAYS}d
          </p>
        </div>

        <div className="relative h-14">
          <div className="absolute inset-x-0 top-5 h-1.5 rounded-full bg-status-success/20" />
          <div className="absolute top-5 h-1.5 bg-status-warning/25"
               style={{ left: `${pct(CHANNEL_WARN_DAYS)}%`, right: `${100 - pct(CHANNEL_COLD_DAYS)}%` }} />
          <div className="absolute top-5 h-1.5 rounded-r-full bg-status-danger/25"
               style={{ left: `${pct(CHANNEL_COLD_DAYS)}%`, right: 0 }} />

          {[CHANNEL_WARN_DAYS, CHANNEL_COLD_DAYS].map(d => (
            <div key={d} className="absolute top-3.5 flex flex-col items-center" style={{ left: `${pct(d)}%` }}>
              <span className="h-4 w-px bg-border" />
              <span className="mt-0.5 font-mono text-[9px] tabular-nums text-muted-foreground">{d}d</span>
            </div>
          ))}

          {touched.map(c => {
            const d = c.daysSinceTouch!
            const tone = d >= CHANNEL_COLD_DAYS ? 'bg-status-danger'
              : d >= CHANNEL_WARN_DAYS ? 'bg-status-warning' : 'bg-status-success'
            return (
              <div key={c.slug} className="absolute top-4" style={{ left: `${pct(d)}%` }}>
                <a href={`#${c.slug}`} title={`${c.name} — ${d}d`} className="block -translate-x-1/2">
                  <span className={cn('block h-3.5 w-3.5 rounded-full ring-2 ring-card transition-transform hover:scale-125', tone)} />
                </a>
                {labelled.has(c.slug) && (
                  <span className="absolute left-1/2 top-5 -translate-x-1/2 whitespace-nowrap font-mono text-[9px] tabular-nums text-muted-foreground">
                    {c.name.length > 14 ? `${c.name.slice(0, 13)}…` : c.name} {d}d
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
