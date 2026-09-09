/**
 * One milestone, as it appears in a horizon column.
 *
 * The design rule here is **only news gets ink**. The first cut of this page
 * rendered a coloured state chip on all 65 tiles — but 39 of them said
 * `no-target`, which on a board where nothing has a target is not information,
 * it is wallpaper. Sixty percent of the page's colour was carrying zero signal,
 * and the states that actually matter drowned in it.
 *
 * So: `kind` is a thin left edge (structure, low saturation — what sort of thing
 * this is), and `state` is a pill ONLY when it needs a human (slipped, at-risk,
 * stranded, needs-person, unknown, done). Everything else gets a small dot and
 * one compact fact. The full reason, the proof, the evidence and the log are all
 * still there — one click away, which is where detail belongs when there are
 * sixty-five of these on a page.
 *
 * Nothing here computes state. Every value comes from `_status.md` via
 * `listRoadmap` — the page is a renderer, and a board that computed its own
 * health from a working tree is exactly the failure this whole layer avoids.
 */
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

/** The bare dot, for states that are simply the norm on this board. */
const STATE_DOT: Record<RoadmapState, string> = {
  slipped: 'bg-status-danger', stranded: 'bg-status-danger', 'at-risk': 'bg-status-warning',
  unknown: 'bg-muted-foreground/40', idle: 'bg-status-warning/60',
  'no-target': 'bg-muted-foreground/40', 'needs-person': 'bg-status-info',
  'on-track': 'bg-status-success', active: 'bg-status-success', done: 'bg-status-success',
}

/**
 * States worth a pill. `no-target`, `idle`, `active` and `on-track` are the
 * board's resting states — 44 of 65 today — and a chip on each of them is the
 * clutter this page was drowning in.
 */
const NEWS: readonly RoadmapState[] = ['slipped', 'stranded', 'at-risk', 'needs-person', 'unknown', 'done']
const isNews = (s: RoadmapState) => NEWS.includes(s)

/** Structure, not alarm: a 2px edge saying what sort of proof this milestone has. */
const KIND_EDGE: Record<string, string> = {
  build: 'border-l-status-accent/50',
  handoff: 'border-l-status-info/50',
  demand: 'border-l-status-success/50',
  decision: 'border-l-status-warning/50',
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

/** Five dots, one per rung — a progress bar with no percentage, because a
 *  percentage would be a number nobody could defend. Kept low-contrast: it is
 *  reference, not a headline. */
function StageDots({ stage }: { stage: Stage }) {
  const at = STAGES.indexOf(stage)
  return (
    <span className="inline-flex shrink-0 items-center gap-[3px]" title={`stage: ${stage}`} aria-label={`stage ${stage}`}>
      {STAGES.map((s, i) => (
        <span key={s} className={cn('h-1 w-1 rounded-full', i <= at ? 'bg-foreground/45' : 'bg-border')} />
      ))}
    </span>
  )
}

/**
 * The one fact worth showing without expanding — chosen per kind, because the
 * useful number is different for each. Never the full reason: "Active (last
 * commit 1d ago) but no target date set" repeated forty times is noise.
 */
function compactFact(item: RoadmapMilestone): string | null {
  if (item.done) return `done ${item.done}`
  switch (item.kind) {
    case 'build':
      return item.evidenceAgeDays == null ? null : `${item.evidenceAgeDays}d`
    case 'handoff':
      return item.handoffState && item.handoffState !== 'unknown' ? item.handoffState : null
    case 'demand':
    case 'decision':
      if (item.proof === null) return null // the pill already says needs-person
      return item.proofTotal ? `proof ${item.proofTrue ?? 0}/${item.proofTotal}` : null
  }
}

function ProofList({ item }: { item: RoadmapMilestone }) {
  if (item.proof === null) {
    return (
      <p className="text-xs leading-relaxed text-muted-foreground">
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
          <span className={cn('mt-px font-mono', r.ok ? 'text-status-success' : 'text-muted-foreground')}>
            {r.ok ? '✓' : '✗'}
          </span>
          <span className="min-w-0">
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
      <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-[7rem_1fr]">
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
    <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-[7rem_1fr]">
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
  const fact = compactFact(item)
  const news = isNews(item.state)

  return (
    <details
      id={item.slug}
      className={cn(
        'group scroll-mt-16 rounded-r border-l-2 bg-card/40 py-1.5 pl-2.5 pr-2 transition-colors',
        'hover:bg-card',
        KIND_EDGE[item.kind] ?? 'border-l-border',
        alerting && 'bg-status-danger/[0.04]'
      )}
    >
      <summary className="cursor-pointer list-none select-none">
        <div className="flex items-start gap-2">
          {!news && (
            <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', STATE_DOT[item.state])} />
          )}
          <span className={cn(
            'min-w-0 flex-1 text-[13px] font-medium leading-snug',
            alerting && 'text-status-danger'
          )}>
            {item.name}
          </span>
          <StageDots stage={item.stage} />
        </div>

        {/* Second line only when there is something to say. On most tiles that
            is a single muted fact; on the ones that need a human, the pill. */}
        {(news || fact || item.target || item.waitingOn) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-0.5 text-[10px] text-muted-foreground">
            {news && <StatePill state={item.state} />}
            {item.target && <span className="font-mono tabular-nums">{item.target}</span>}
            {fact && <span className="font-mono">{fact}</span>}
            {item.waitingOn && <span>waiting on {item.waitingOn}</span>}
          </div>
        )}

        {/* The full sentence is reserved for trouble — everywhere else it
            repeats what the fact above already said. */}
        {alerting && (
          <p className="mt-1 text-[11px] leading-snug text-status-danger/90">{item.reason}</p>
        )}
      </summary>

      <div className="mt-3 space-y-3 border-t border-border pt-3">
        <p className="text-xs text-muted-foreground">
          <span className="font-mono">{item.kind}</span> · {item.horizon} · {item.reason}
        </p>

        {(item.kind === 'demand' || item.kind === 'decision') && (
          <div>
            <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Proof</h4>
            <ProofList item={item} />
          </div>
        )}

        {(item.kind === 'build' || item.kind === 'handoff') && <EvidenceList item={item} />}

        {(item.unlocks.length > 0 || item.blockedOn.length > 0) && (
          <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-[7rem_1fr]">
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

/** Exported for the Build-next list, which shows a pill only for the same
 *  news states — one rule, one place. */
export { isNews }
