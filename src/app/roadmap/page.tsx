/**
 * Roadmap — the ten dated commitments, grouped as Pavan holds them.
 *
 * Nexus is one initiative with its solution products underneath; the internal
 * repos each carry their own next steps; the two marketing sites are one job.
 * Every row's state is DERIVED by scripts/roadmap-check.ts — this page never
 * computes health from a working tree, and it says out loud when the check is
 * stale rather than rendering a confident board from old numbers.
 */
import Link from 'next/link'
import {
  listRoadmap, readStatus, STATUS_STALE_DAYS, EVIDENCE_WARN_DAYS,
  type RoadmapItem, type RoadmapState, type RoadmapGroup,
} from '@/lib/roadmap'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { MarkdownRenderer } from '@/components/shared/markdown-renderer'
import { Map, Boxes, Wrench, Globe, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const STATE_TONE: Record<RoadmapState, string> = {
  slipped: 'bg-status-danger/10 text-status-danger border-status-danger/30',
  stranded: 'bg-status-danger/10 text-status-danger border-status-danger/30',
  'at-risk': 'bg-status-warning/10 text-status-warning border-status-warning/30',
  unknown: 'bg-muted text-muted-foreground border-border',
  idle: 'bg-status-warning/10 text-status-warning border-status-warning/30',
  'no-target': 'bg-status-warning/10 text-status-warning border-status-warning/30',
  'on-track': 'bg-status-success/10 text-status-success border-status-success/30',
  active: 'bg-status-success/10 text-status-success border-status-success/30',
  done: 'bg-muted text-muted-foreground border-border',
}

const GROUPS: { key: RoadmapGroup; label: string; icon: typeof Boxes; blurb: string }[] = [
  { key: 'nexus', label: 'Nexus', icon: Boxes, blurb: 'One platform, one roadmap per solution product' },
  { key: 'internal', label: 'Internal', icon: Wrench, blurb: 'Automation repos — what each one needs next' },
  { key: 'web', label: 'Web presence', icon: Globe, blurb: 'Both marketing sites, one job' },
]

function StatePill({ state }: { state: RoadmapState }) {
  return (
    <span className={cn(
      'inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
      STATE_TONE[state]
    )}>
      {state}
    </span>
  )
}

/** Evidence age is the number that makes "on time" checkable — show it plainly. */
function EvidenceLine({ item }: { item: RoadmapItem }) {
  if (item.kind === 'handoff') {
    const { spec, landed, consumedBy } = item.handoff ?? {}
    return (
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">Handoff</dt>
        <dd className="font-mono">{item.handoffState ?? 'unknown'}</dd>
        {landed && (<><dt className="text-muted-foreground">Landed</dt><dd className="font-mono">{landed}</dd></>)}
        {consumedBy && (<><dt className="text-muted-foreground">Consumed by</dt><dd className="font-mono">{consumedBy}</dd></>)}
        {spec && (<><dt className="text-muted-foreground">Spec</dt><dd className="font-mono break-all">{spec}</dd></>)}
      </dl>
    )
  }
  return (
    <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
      <dt className="text-muted-foreground">Last human commit</dt>
      <dd className="font-mono tabular-nums">
        {item.evidenceAgeDays == null ? 'unknown' : `${item.evidenceAgeDays}d ago`}
        {item.lastEvidenceAt && (
          <span className="ml-2 text-muted-foreground">{item.lastEvidenceAt.slice(0, 10)}</span>
        )}
      </dd>
      <dt className="text-muted-foreground">Evidence</dt>
      <dd className="space-y-0.5">
        {item.evidence.length === 0
          ? <span className="text-muted-foreground">none declared</span>
          : item.evidence.map((e, i) => (
              <div key={i} className="font-mono break-all">
                <span className="text-muted-foreground">{e.repo}</span> {e.path}
              </div>
            ))}
      </dd>
    </dl>
  )
}

function InitiativeCard({ item }: { item: RoadmapItem }) {
  const alerting = item.state === 'slipped' || item.state === 'at-risk' || item.state === 'stranded'
  return (
    <Card id={item.slug} className={cn('scroll-mt-16', alerting && 'border-status-danger/30')}>
      <CardContent className="p-6">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold">{item.name}</h3>
          {item.product && <Badge variant="outline" className="text-[10px]">{item.product}</Badge>}
          <Badge variant="outline" className="text-[10px]">{item.kind}</Badge>
          {item.waitingOn && (
            <Badge variant="secondary" className="text-[10px]">waiting on {item.waitingOn}</Badge>
          )}
          <div className="ml-auto flex items-center gap-2">
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {item.target ?? 'no target'}
            </span>
            <StatePill state={item.state} />
          </div>
        </div>

        <p className={cn('mt-2 text-sm', alerting ? 'text-status-danger' : 'text-muted-foreground')}>
          {item.reason}
        </p>

        <EvidenceLine item={item} />

        {item.body && (
          <details className="mt-3">
            <summary className="cursor-pointer select-none py-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
              Definition of done
            </summary>
            <div className="mt-2 border-t border-border pt-3">
              <MarkdownRenderer content={item.body} />
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  )
}

export default async function RoadmapPage() {
  const [items, status] = await Promise.all([listRoadmap(), readStatus()])

  const withTarget = items.filter(i => i.target && !i.done).length
  const trouble = items.filter(i =>
    i.state === 'slipped' || i.state === 'at-risk' || i.state === 'stranded').length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Roadmap"
        description={
          items.length === 0
            ? 'Commitments will appear when added to ~/repos/operations/roadmap/'
            : `${items.length} initiatives · ${withTarget} with a target date` +
              (trouble > 0 ? ` · ${trouble} need a decision` : '') +
              ` — evidence clock: ${EVIDENCE_WARN_DAYS}d`
        }
      />

      {/* A board computed from a stale check is worse than no board: it looks
          like current health. Say so at the top, above everything it affects. */}
      {items.length > 0 && (!status.ran || status.stale) && (
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
                Rows below show what it last knew, not what is true now. Run{' '}
                <code className="font-mono text-xs">scripts/roadmap-check.ts</code> on the mini.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={Map}
          title="No initiatives tracked"
          description="Add frontmattered .md files to ~/repos/operations/roadmap/ to see them here"
        />
      ) : (
        GROUPS.map(g => {
          const group = items.filter(i => i.group === g.key)
          if (group.length === 0) return null
          return (
            <section key={g.key} className="space-y-4">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <g.icon className="h-4 w-4" /> {g.label}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{g.blurb}</p>
              </div>
              {group.map(i => <InitiativeCard key={i.slug} item={i} />)}
            </section>
          )
        })
      )}

      {items.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Targets and definitions of done are authored in{' '}
          <code className="font-mono">operations/roadmap/</code>; every state on this page is
          derived by <code className="font-mono">scripts/roadmap-check.ts</code> from human
          commits on <code className="font-mono">origin</code>. Bot and janitor commits are
          excluded — a path a machine writes to reads green forever.{' '}
          <Link href="/system/cron" className="underline underline-offset-2 hover:text-foreground">
            Check the schedule
          </Link>
          .
        </p>
      )}
    </div>
  )
}
