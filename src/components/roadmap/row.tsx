/**
 * One row: the north star, what it cost, who is asking, and the milestones under
 * it in three horizon columns.
 *
 * The header is deliberately the whole argument for the row. Investment and pull
 * sit next to each other because the interesting rows are the ones where they
 * disagree — effort with nobody asking, or an agency asking with nothing moving.
 * That contrast is the reason both numbers are derived rather than typed.
 */
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { MilestoneCard } from './milestone'
import { HORIZONS, type RoadmapRow } from '@/lib/roadmap'
import { cn } from '@/lib/utils'

const HORIZON_LABEL: Record<string, string> = { now: 'Now', next: 'Next', later: 'Later' }

/** A number with the thing it measures under it — no sparkline, no trend arrow.
 *  Two windows is the whole story: is it moving, and did it ever. */
function Stat({ label, value, hint, tone }: {
  label: string; value: string; hint?: string; tone?: string
}) {
  return (
    <div>
      <div className={cn('font-mono text-lg tabular-nums leading-none', tone)}>{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  )
}

export function RowCard({ row }: { row: RoadmapRow }) {
  const inv30 = row.investment?.[30]
  const inv90 = row.investment?.[90]
  const pull = row.pull

  const trouble = row.milestones.filter(m =>
    m.state === 'slipped' || m.state === 'at-risk' || m.state === 'stranded').length

  // Effort with nobody asking is the single most useful thing this card can say,
  // and it is only sayable because both halves are derived.
  const investedWithoutPull = (inv90 ?? 0) >= 20 && (pull?.score ?? 0) === 0

  return (
    <Card id={row.slug} className={cn('scroll-mt-16', trouble > 0 && 'border-status-danger/30')}>
      <CardContent className="p-5">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold">{row.name}</h3>
              {row.product && <Badge variant="outline" className="text-[10px]">{row.product}</Badge>}
              <Badge variant="outline" className="text-[10px]">{row.kind}</Badge>
              <span className="font-mono text-[10px] text-muted-foreground">
                {row.repos.join(' · ')}
              </span>
            </div>
            {/* The north star is the point of the row. It gets the biggest text
                on the card and it is never truncated. */}
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-foreground/90">
              {row.northStar || (
                <span className="text-status-warning">No north star authored — the lint fails on this.</span>
              )}
            </p>
            {row.strategy && (
              <p className="mt-2 max-w-3xl border-l-2 border-border pl-3 text-xs leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground/70">Strategy: </span>{row.strategy}
              </p>
            )}
          </div>

          <div className="flex shrink-0 gap-6 pl-2">
            <Stat
              label="Invested"
              value={inv30 == null ? '—' : `${inv30}`}
              hint={inv90 == null ? 'unknown' : `${inv90} in 90d`}
            />
            <Stat
              label="Pull"
              value={pull ? `${pull.score}` : '—'}
              hint={pull
                ? `${pull.warm} warm · ${pull.meetings90} mtg 90d`
                : undefined}
              tone={pull && pull.score === 0 ? 'text-muted-foreground' : undefined}
            />
          </div>
        </div>

        {investedWithoutPull && (
          <p className="mt-3 rounded border border-status-warning/30 bg-status-warning/5 px-3 py-1.5 text-xs text-status-warning">
            {inv90} human commits in 90 days and no recorded pull — no contact past
            `identified`, no agency meeting.
          </p>
        )}

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {HORIZONS.map(h => {
            const items = row.milestones.filter(m => m.horizon === h)
            return (
              <div key={h}>
                <h4 className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {HORIZON_LABEL[h]}
                  <span className="font-mono tabular-nums">{items.length}</span>
                </h4>
                <div className="space-y-2">
                  {items.length === 0
                    ? <p className="text-xs text-muted-foreground/60">—</p>
                    : items.map(m => <MilestoneCard key={m.slug} item={m} />)}
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
