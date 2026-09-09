/**
 * One milestone, as it appears in a horizon column.
 *
 * Collapsed it shows the five things that decide whether to open it: what it is,
 * what kind of proof it has, how far along it is, whether it is in trouble, and
 * who is holding it. Expanded it shows the definition of done, every proof check
 * with its verdict, and the log.
 *
 * Nothing here computes state. Every value comes from `_status.md` via
 * `listRoadmap` — the page is a renderer, and a board that computed its own
 * health from a working tree is exactly the failure this whole layer avoids.
 */
import { Badge } from '@/components/ui/badge'
import { MarkdownRenderer } from '@/components/shared/markdown-renderer'
import { STAGES, type RoadmapMilestone, type RoadmapState, type Stage } from '@/lib/roadmap'
import { cn } from '@/lib/utils'

export const STATE_TONE: Record<RoadmapState, string> = {
  slipped: 'bg-status-danger/10 text-status-danger border-status-danger/30',
  stranded: 'bg-status-danger/10 text-status-danger border-status-danger/30',
  'at-risk': 'bg-status-warning/10 text-status-warning border-status-warning/30',
  unknown: 'bg-muted text-muted-foreground border-border',
  idle: 'bg-status-warning/10 text-status-warning border-status-warning/30',
  'no-target': 'bg-status-warning/10 text-status-warning border-status-warning/30',
  // Blue, not green: a manual proof is a job for a person, and it must never
  // read as an achievement just because nothing is failing.
  'needs-person': 'bg-status-info/10 text-status-info border-status-info/30',
  'on-track': 'bg-status-success/10 text-status-success border-status-success/30',
  active: 'bg-status-success/10 text-status-success border-status-success/30',
  done: 'bg-status-success/10 text-status-success border-status-success/30',
}

const KIND_TONE: Record<string, string> = {
  build: 'bg-status-accent/10 text-status-accent border-status-accent/30',
  handoff: 'bg-status-info/10 text-status-info border-status-info/30',
  demand: 'bg-status-success/10 text-status-success border-status-success/30',
  decision: 'bg-status-warning/10 text-status-warning border-status-warning/30',
}

export function StatePill({ state }: { state: RoadmapState }) {
  return (
    <span className={cn(
      'inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium',
      STATE_TONE[state]
    )}>
      {state}
    </span>
  )
}

/** Five dots, one per rung. Filled to the rung reached — a progress bar with no
 *  percentage, because a percentage would be a number nobody could defend. */
function StageDots({ stage }: { stage: Stage }) {
  const at = STAGES.indexOf(stage)
  return (
    <span className="inline-flex items-center gap-[3px]" title={`stage: ${stage}`} aria-label={`stage ${stage}`}>
      {STAGES.map((s, i) => (
        <span
          key={s}
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            i <= at ? 'bg-foreground/70' : 'bg-border'
          )}
        />
      ))}
    </span>
  )
}

function ProofList({ item }: { item: RoadmapMilestone }) {
  if (item.proof === null) {
    return (
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-status-info">proof: manual</span> — no check in the
        vocabulary can express this definition of done, so it needs a person. It can never read
        done on its own.
      </p>
    )
  }
  if (!item.proofResults?.length) {
    return <p className="text-xs text-muted-foreground">No proof evaluated yet.</p>
  }
  return (
    <ul className="space-y-1">
      {item.proofResults.map((r, i) => (
        <li key={i} className="flex items-start gap-2 text-xs">
          <span className={cn('mt-0.5 font-mono', r.ok ? 'text-status-success' : 'text-muted-foreground')}>
            {r.ok ? '✓' : '✗'}
          </span>
          <span>
            <span className="font-mono text-muted-foreground">{r.check}</span>{' '}
            <span className="text-foreground/80">{r.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

function EvidenceList({ item }: { item: RoadmapMilestone }) {
  if (item.kind === 'handoff') {
    const { spec, landed, consumedBy, pr } = item.handoff ?? {}
    return (
      <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">Handoff</dt>
        <dd className="font-mono">{item.handoffState ?? 'unknown'}</dd>
        {landed && (<><dt className="text-muted-foreground">Landed</dt><dd className="font-mono break-all">{landed}</dd></>)}
        {consumedBy && (<><dt className="text-muted-foreground">Consumed by</dt><dd className="font-mono break-all">{consumedBy}</dd></>)}
        {spec && (<><dt className="text-muted-foreground">Spec</dt><dd className="font-mono break-all">{spec}</dd></>)}
        {pr && (<><dt className="text-muted-foreground">PR</dt><dd className="font-mono break-all">{pr}</dd></>)}
      </dl>
    )
  }
  if (item.kind !== 'build') return null
  return (
    <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
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

export function MilestoneCard({ item }: { item: RoadmapMilestone }) {
  const alerting = item.state === 'slipped' || item.state === 'at-risk' || item.state === 'stranded'
  return (
    <details
      id={item.slug}
      className={cn(
        'group scroll-mt-16 rounded-md border bg-card px-3 py-2 transition-colors',
        alerting ? 'border-status-danger/40' : 'border-border hover:border-foreground/20'
      )}
    >
      <summary className="cursor-pointer list-none select-none">
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1 text-sm font-medium leading-snug">{item.name}</span>
          <StageDots stage={item.stage} />
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className={cn(
            'inline-flex items-center rounded border px-1.5 py-px text-[10px] font-medium',
            KIND_TONE[item.kind] ?? 'border-border text-muted-foreground'
          )}>
            {item.kind}
          </span>
          <StatePill state={item.state} />
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {item.target ?? 'no target'}
          </span>
          {item.waitingOn && (
            <Badge variant="secondary" className="text-[10px]">waiting on {item.waitingOn}</Badge>
          )}
        </div>

        <p className={cn('mt-1 text-xs leading-snug', alerting ? 'text-status-danger' : 'text-muted-foreground')}>
          {item.reason}
        </p>
      </summary>

      <div className="mt-3 space-y-3 border-t border-border pt-3">
        {(item.kind === 'demand' || item.kind === 'decision') && (
          <div>
            <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Proof</h4>
            <ProofList item={item} />
          </div>
        )}

        {(item.kind === 'build' || item.kind === 'handoff') && <EvidenceList item={item} />}

        {(item.unlocks.length > 0 || item.blockedOn.length > 0) && (
          <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
            {item.unlocks.length > 0 && (<>
              <dt className="text-muted-foreground">Unlocks</dt>
              <dd className="font-mono break-all">{item.unlocks.join(', ')}</dd>
            </>)}
            {item.blockedOn.length > 0 && (<>
              <dt className="text-muted-foreground">Blocked on</dt>
              <dd className="font-mono break-all">{item.blockedOn.join(', ')}</dd>
            </>)}
          </dl>
        )}

        {item.body && (
          <div className="border-t border-border pt-3">
            <MarkdownRenderer content={item.body} />
          </div>
        )}
      </div>
    </details>
  )
}
