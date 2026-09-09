/**
 * One row: the north star, what it cost, who is asking, and the milestones under
 * it in three horizon columns.
 *
 * The north star is the reason the row exists, so it gets the largest text on
 * the card and is never truncated. Everything else on the header is deliberately
 * quiet — the first cut gave the product slug, the kind, the repo list and two
 * stat blocks the same weight as the star itself, and the eye had nowhere to
 * land.
 *
 * Investment and pull sit together because the interesting rows are the ones
 * where they disagree: effort with nobody asking (Candor, 165 commits and no
 * contact past `identified`) or an agency asking with nothing moving (Milestone,
 * three meetings and 16 commits). That contrast is the reason both numbers are
 * derived rather than typed, so the card calls it out in words when it happens.
 */
import { Card, CardContent } from '@/components/ui/card'
import { MilestoneCard } from './milestone'
import { HORIZONS, type RoadmapRow } from '@/lib/roadmap'
import { cn } from '@/lib/utils'

const HORIZON_LABEL: Record<string, string> = { now: 'Now', next: 'Next', later: 'Later' }

export function RowCard({ row, ranks }: {
  row: RoadmapRow
  /** slug → position in the global Build-next list. */
  ranks?: Record<string, number>
}) {
  const inv30 = row.investment?.[30]
  const inv90 = row.investment?.[90]
  const pull = row.pull

  const trouble = row.milestones.filter(m =>
    m.state === 'slipped' || m.state === 'at-risk' || m.state === 'stranded').length

  // Effort with nobody asking is the single most useful thing this card can say,
  // and it is only sayable because both halves are derived.
  //
  // Gated on `product`, and that gate is load-bearing: pull is measured from CRM
  // contacts carrying `product: <slug>`, so a row without one scores 0 by
  // construction, not by neglect. Ungated, this fired on BidPro, Contract
  // Management and the platform row — three rows where a demand column is
  // meaningless — and an alarm that cannot ever be true is one you learn to
  // ignore, which would have cost the three rows where it IS true.
  const investedWithoutPull =
    Boolean(row.product) && (inv90 ?? 0) >= 20 && (pull?.score ?? 0) === 0

  return (
    <Card id={row.slug} className={cn('scroll-mt-16', trouble > 0 && 'border-status-danger/30')}>
      <CardContent className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
          <div className="min-w-0 flex-1 basis-80">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h3 className="text-[15px] font-semibold tracking-tight">{row.name}</h3>
              {row.product && (
                <span className="font-mono text-[10px] text-muted-foreground">{row.product}</span>
              )}
            </div>
            {/* The star is the point of the row: biggest text, full width, never cut. */}
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-foreground/85">
              {row.northStar || (
                <span className="text-status-warning">No north star authored — the lint fails on this.</span>
              )}
            </p>
          </div>

          {/* Two numbers, right-aligned, quiet. Labels below so the digits align. */}
          <dl className="flex shrink-0 gap-8 text-right">
            <div>
              <dd className="font-mono text-base tabular-nums leading-none">
                {inv30 ?? '—'}
                <span className="ml-1 text-[11px] text-muted-foreground">/ {inv90 ?? '—'}</span>
              </dd>
              <dt className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                commits 30 / 90d
              </dt>
            </div>
            <div>
              <dd className={cn(
                'font-mono text-base tabular-nums leading-none',
                (pull?.score ?? 0) === 0 && 'text-muted-foreground'
              )}>
                {pull?.score ?? '—'}
              </dd>
              <dt className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                pull{pull && pull.total > 0 ? ` · ${pull.warm}/${pull.total} warm` : ''}
              </dt>
            </div>
          </dl>
        </div>

        {row.strategy && (
          <details className="mt-3">
            <summary className="cursor-pointer list-none select-none text-[11px] text-muted-foreground transition-colors hover:text-foreground">
              Strategy ▸
            </summary>
            <p className="mt-2 max-w-2xl border-l-2 border-border pl-3 text-xs leading-relaxed text-muted-foreground">
              {row.strategy}
            </p>
          </details>
        )}

        {investedWithoutPull && (
          <p className="mt-3 text-xs text-status-warning/90">
            {inv90} human commits in 90 days and no recorded pull — no contact past
            {' '}<span className="font-mono">identified</span>, no agency meeting.
          </p>
        )}

        <div className="mt-5 grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          {HORIZONS.map(h => {
            const items = row.milestones.filter(m => m.horizon === h)
            return (
              <div key={h}>
                <h4 className="mb-2 flex items-baseline gap-1.5 border-b border-border pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {HORIZON_LABEL[h]}
                  <span className="font-mono tabular-nums opacity-60">{items.length}</span>
                </h4>
                <div className="space-y-1">
                  {items.length === 0
                    ? <p className="pl-1 text-xs text-muted-foreground/40">—</p>
                    : items.map(m => (
                        <MilestoneCard
                          key={m.slug}
                          item={m}
                          rank={ranks?.[m.slug]}
                          isNext={row.nextMilestone === m.slug}
                        />
                      ))}
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
