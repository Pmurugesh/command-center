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
import React from 'react'
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

/**
 * The authored body is three `##` sections — Done when, Sources, Log — and
 * rendering them as one markdown blob is what made an expanded tile a wall.
 * They have different jobs: the definition of done is what you came to read,
 * sources are citations you check occasionally, the log is history. Split them
 * so each gets the weight it deserves.
 */
function splitBody(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  let key = ''
  let buf: string[] = []
  const flush = () => { if (key && buf.join('\n').trim()) out[key] = buf.join('\n').trim() }
  for (const line of body.split('\n')) {
    const h = /^##\s+(.+?)\s*$/.exec(line)
    if (h) { flush(); buf = []; key = h[1].toLowerCase() } else buf.push(line)
  }
  flush()
  return out
}

const countItems = (md?: string) => md ? (md.match(/^\s*-\s+/gm) ?? []).length : 0

/** A collapsed sub-section — available, checkable, out of the way. */
function Aside({ label, count, md }: { label: string; count: number; md?: string }) {
  if (!md) return null
  return (
    <details className="min-w-0">
      <summary className="cursor-pointer list-none select-none text-[10px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground">
        &#9656; {label} <span className="font-mono tabular-nums opacity-60">{count || ''}</span>
      </summary>
      <div className="mt-2 max-w-prose break-words text-xs [&_code]:break-all [&_li]:my-0.5 [&_ul]:list-disc [&_ul]:pl-4">
        <MarkdownRenderer content={md} />
      </div>
    </details>
  )
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

/**
 * A label above its value, never beside it. Inside a one-third-width tile a
 * label/value grid leaves the value ~68px, which is narrower than a repo path.
 * `break-words` is not optional here: an unbreakable path escapes the tile and
 * paints over the next column.
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="break-words font-mono">{children}</div>
    </div>
  )
}

function EvidenceList({ item }: { item: RoadmapMilestone }) {
  if (item.kind === 'handoff') {
    const { spec, landed, landedIn, consumedBy, pr } = item.handoff ?? {}
    return (
      <div className="min-w-0 space-y-1 text-xs">
        {/* The ref is not decoration: `merged` on an integration branch is a
            weaker claim than `merged` on the default branch, and the two must
            not read the same. */}
        <Field label="Handoff">
          {item.handoffState ?? 'unknown'}
          {item.handoffRef && <span className="text-muted-foreground"> at {item.handoffRef}</span>}
          {item.handoffFile && <span className="text-muted-foreground"> · {item.handoffFile}</span>}
        </Field>
        {landed && <Field label="Landed">{landed}</Field>}
        {landedIn && <Field label="Landed in">{landedIn}</Field>}
        {consumedBy && <Field label="Consumed by">{consumedBy}</Field>}
        {spec && <Field label="Spec">{spec}</Field>}
        {pr && <Field label="PR">{pr}</Field>}
      </div>
    )
  }
  if (item.kind !== 'build') return null
  return (
    <div className="min-w-0 space-y-1 text-xs">
      <Field label="Last human commit">
        {item.evidenceAgeDays == null ? 'unknown' : `${item.evidenceAgeDays}d ago`}
        {item.lastEvidenceAt && (
          <span className="ml-1.5 text-muted-foreground">{item.lastEvidenceAt.slice(0, 10)}</span>
        )}
      </Field>
      <Field label="Evidence">
        {item.evidence.length === 0
          ? <span className="text-muted-foreground">none declared</span>
          : item.evidence.map((e, i) => (
              <div key={i}>
                <span className="text-muted-foreground">{e.repo}</span> {e.path}
              </div>
            ))}
      </Field>
    </div>
  )
}

export function MilestoneCard({ item, rank, isNext }: {
  item: RoadmapMilestone
  /** Its position in the global Build-next list, when it is in the top ten. */
  rank?: number
  /** The highest-ranked open milestone in its own row. */
  isNext?: boolean
}) {
  const alerting = item.state === 'slipped' || item.state === 'at-risk' || item.state === 'stranded'
  const fact = compactFact(item)
  const news = isNews(item.state)
  const sections = splitBody(item.body)

  return (
    <details
      id={item.slug}
      className={cn(
        'group min-w-0 overflow-hidden scroll-mt-24 rounded-r border-l-2 bg-card/40 py-1.5 pl-2.5 pr-2 transition-colors',
        'hover:bg-card',
        KIND_EDGE[item.kind] ?? 'border-l-border',
        alerting && 'bg-status-danger/[0.04]',
        // The landing mark for a Build-next click. Pure CSS, so it works with
        // JavaScript off and survives a reload of a deep link.
        'target:bg-status-accent/10 target:ring-1 target:ring-status-accent/50',
        isNext && 'bg-card'
      )}
    >
      <summary className="cursor-pointer list-none select-none">
        <div className="flex items-start gap-2">
          {rank !== undefined ? (
            // The number from Build next, carried onto the tile — so a jump
            // lands somewhere that says out loud which item you clicked.
            <span
              className="mt-px inline-flex h-4 shrink-0 items-center rounded bg-status-accent/15 px-1 font-mono text-[10px] font-medium tabular-nums text-status-accent"
              title={`#${rank} in Build next`}
            >
              {rank}
            </span>
          ) : !news && (
            <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', STATE_DOT[item.state])} />
          )}
          <span className={cn(
            'min-w-0 flex-1 text-[13px] font-medium leading-snug',
            alerting && 'text-status-danger'
          )}>
            {item.name}
          </span>
          {isNext && rank === undefined && (
            <span className="mt-px shrink-0 rounded border border-border px-1 text-[9px] uppercase tracking-wide text-muted-foreground">
              next
            </span>
          )}
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

      <div className="mt-2.5 border-t border-border pt-2.5">
        {/* Deliberately ONE column. A tile always sits inside a one-third-width
            horizon column, so its width has nothing to do with the viewport's —
            an `xl:` two-column split gave ~100px sub-columns at 1400px and the
            evidence paths overflowed into the next column. This wants a
            container query or nothing, and nothing reads fine. */}
        <div className="space-y-3">
          <div className="min-w-0">
            {sections['done when'] && (
              <>
                <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Done when
                </h4>
                <div className="max-w-prose break-words text-xs leading-relaxed [&_code]:break-all [&_p]:my-1">
                  <MarkdownRenderer content={sections['done when']} />
                </div>
              </>
            )}
          </div>

          <div className="min-w-0 space-y-3">
            {(item.kind === 'demand' || item.kind === 'decision') && (
              <div>
                <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Proof</h4>
                <ProofList item={item} />
              </div>
            )}

            {(item.kind === 'build' || item.kind === 'handoff') && <EvidenceList item={item} />}

            {(item.unlocks.length > 0 || item.blockedOn.length > 0) && (
              <div className="min-w-0 space-y-1 text-xs">
                {item.unlocks.length > 0 && <Field label="Unlocks">{item.unlocks.join(', ')}</Field>}
                {item.blockedOn.length > 0 && <Field label="Blocked on">{item.blockedOn.join(', ')}</Field>}
              </div>
            )}
          </div>
        </div>

        {(sections['sources'] || sections['log']) && (
          <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 border-t border-border/60 pt-2.5">
            <Aside label="Sources" count={countItems(sections['sources'])} md={sections['sources']} />
            <Aside label="Log" count={countItems(sections['log'])} md={sections['log']} />
          </div>
        )}

        <p className="mt-3 text-[10px] text-muted-foreground/70">
          <span className="font-mono">{item.kind}</span> &middot; {item.horizon} &middot; {item.reason}
        </p>
      </div>
    </details>
  )
}

/** Exported for the Build-next list, which shows a pill only for the same
 *  news states — one rule, one place. */
export { isNews }
