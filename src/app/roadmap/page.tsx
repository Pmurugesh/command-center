/**
 * Roadmap — twelve north stars and the sixty-five milestones under them.
 *
 * A queue, not a gallery. The top of the page is what to build next and what
 * only Pavan can decide; the rows are below it, because a board you have to
 * read top-to-bottom to find the work is a board you stop opening.
 *
 * Every state, stage and ranking on this page is DERIVED by
 * scripts/roadmap-check.ts and read out of `_status.md`. The page never computes
 * health from a working tree, and it says out loud when the check is stale
 * rather than rendering a confident board from old numbers.
 */
import Link from 'next/link'
import {
  listRoadmap, readStatus, allMilestones, STATUS_STALE_DAYS,
  type RoadmapRow, type RoadmapGroup,
} from '@/lib/roadmap'
import { getStrategicDecisions } from '@/lib/gtm'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { Card, CardContent } from '@/components/ui/card'
import { RowCard } from '@/components/roadmap/row'
import { StatePill } from '@/components/roadmap/milestone'
import { Map as MapIcon, Boxes, Layers, Briefcase, Wrench, Globe, AlertTriangle, ArrowRight, HelpCircle } from 'lucide-react'

export const dynamic = 'force-dynamic'

const GROUPS: { key: RoadmapGroup; label: string; icon: typeof Boxes; blurb: string }[] = [
  { key: 'nexus', label: 'Nexus products', icon: Boxes, blurb: 'One north star per solution product' },
  { key: 'platform', label: 'Platform', icon: Layers, blurb: 'No star of its own — it serves whichever product milestones list it upstream' },
  { key: 'suite', label: 'Infinite Solutions: bid to cash', icon: Briefcase, blurb: 'BidPro wins the bid, Contract Management runs it. Pre-award / post-award is the boundary' },
  { key: 'internal', label: 'Command Center', icon: Wrench, blurb: 'The screen this is on' },
  { key: 'web', label: 'Web', icon: Globe, blurb: 'Both marketing sites, one job' },
]

export default async function RoadmapPage() {
  const [rows, status, decisions] = await Promise.all([
    listRoadmap(),
    readStatus(),
    getStrategicDecisions().catch(() => []),
  ])

  const milestones = allMilestones(rows)
  const bySlug = new Map(milestones.map(m => [m.slug, m]))
  // Only decisions raised by the roadmap itself — the GTM and intel queues have
  // their own home on Today and would drown this one.
  const roadmapDecisions = decisions.filter(d => d.file.startsWith('roadmap/'))

  const withTarget = milestones.filter(m => m.target && !m.done).length
  const trouble = milestones.filter(m =>
    m.state === 'slipped' || m.state === 'at-risk' || m.state === 'stranded').length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Roadmap"
        description={
          rows.length === 0
            ? 'Rows and milestones will appear when added to ~/repos/operations/roadmap/'
            : `${rows.length} rows · ${milestones.length} milestones · ${withTarget} with a target date` +
              (trouble > 0 ? ` · ${trouble} in trouble` : '')
        }
      />

      {/* A board computed from a stale check is worse than no board: it looks
          like current health. Say so at the top, above everything it affects. */}
      {rows.length > 0 && (!status.ran || status.stale) && (
        <Card className="border-status-warning/40">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" />
            <div className="text-sm">
              <p className="font-medium text-status-warning">
                {status.ran ? 'Status check is stale' : 'Status check has never run'}
              </p>
              <p className="mt-1 text-muted-foreground">
                {(status.lastRunAt ?? status.generatedAt)
                  ? `Last run ${(status.lastRunAt ?? status.generatedAt)!.slice(0, 10)} — over ${STATUS_STALE_DAYS} days ago. `
                  : ''}
                Everything below shows what it last knew, not what is true now. Run{' '}
                <code className="font-mono text-xs">scripts/roadmap-check.ts</code> on the mini.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* The lint is not advisory: a dangling `unlocks:` silently demotes real
          work in the ranking, so a failing board must say so before it is read. */}
      {status.lint.length > 0 && (
        <Card className="border-status-danger/40">
          <CardContent className="p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-status-danger">
              <AlertTriangle className="h-4 w-4" />
              {status.lint.length} lint error{status.lint.length === 1 ? '' : 's'} — the ranking below cannot be trusted
            </p>
            <ul className="mt-2 space-y-0.5 font-mono text-xs text-muted-foreground">
              {status.lint.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={MapIcon}
          title="No rows tracked"
          description="Add rows/<row>.md and <milestone>.md files to ~/repos/operations/roadmap/ to see them here"
        />
      ) : (
        <>
          {/* ── Build next ─────────────────────────────────────────────── */}
          <Card>
            <CardContent className="p-5">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <ArrowRight className="h-4 w-4" /> Build next
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Ranked by how many open milestones each unlocks, weighted by the pull behind them,
                plus urgency. Deterministic — no model call, and the same numbers the check printed.
              </p>
              {status.ranking.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  No ranking yet — <code className="font-mono text-xs">roadmap-check</code> has not
                  written one.
                </p>
              ) : (
                <ol className="mt-3 space-y-1.5">
                  {status.ranking.slice(0, 8).map((r, i) => {
                    const m = bySlug.get(r.slug)
                    return (
                      <li key={r.slug} className="flex items-baseline gap-3">
                        <span className="w-4 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                          {i + 1}
                        </span>
                        <Link
                          href={`#${r.slug}`}
                          className="text-sm font-medium underline-offset-2 hover:underline"
                        >
                          {r.name}
                        </Link>
                        {m && <StatePill state={m.state} />}
                        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                          {r.reason}
                        </span>
                        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                          {r.score.toFixed(1)}
                        </span>
                      </li>
                    )
                  })}
                </ol>
              )}
            </CardContent>
          </Card>

          {/* ── Decisions ──────────────────────────────────────────────── */}
          {roadmapDecisions.length > 0 && (
            <Card className="border-status-warning/30">
              <CardContent className="p-5">
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <HelpCircle className="h-4 w-4" /> Decisions
                  <span className="font-mono text-sm tabular-nums text-muted-foreground">
                    {roadmapDecisions.length}
                  </span>
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Open <code className="font-mono">[DECISION]</code> lines raised by the roadmap
                  itself. Nobody else can answer these, and none of them is code.
                </p>
                <ul className="mt-3 space-y-2">
                  {roadmapDecisions.map((d, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-status-warning" />
                      <span>
                        {d.text}{' '}
                        <Link href={`#${d.source}`} className="font-mono text-xs text-muted-foreground underline-offset-2 hover:underline">
                          {d.source}
                        </Link>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* ── Rows, grouped ──────────────────────────────────────────── */}
          {GROUPS.map(g => {
            const group = rows.filter((r: RoadmapRow) => r.group === g.key)
            if (group.length === 0) return null
            return (
              <section key={g.key} className="space-y-4">
                <div>
                  <h2 className="flex items-center gap-2 text-lg font-semibold">
                    <g.icon className="h-4 w-4" /> {g.label}
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">{g.blurb}</p>
                </div>
                {group.map(r => <RowCard key={r.slug} row={r} />)}
              </section>
            )
          })}
        </>
      )}

      {rows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          North stars, definitions of done and proofs are authored in{' '}
          <code className="font-mono">operations/roadmap/</code>; every state, stage and rank on
          this page is derived by <code className="font-mono">scripts/roadmap-check.ts</code> from
          human commits on <code className="font-mono">origin</code> and from the CRM. Bot and
          janitor commits are excluded, and demand counts only contacts with a human{' '}
          <code className="font-mono">via</code> log line — a path a machine writes to reads green
          forever.{' '}
          <Link href="/system/cron" className="underline underline-offset-2 hover:text-foreground">
            Check the schedule
          </Link>
          .
        </p>
      )}
    </div>
  )
}
