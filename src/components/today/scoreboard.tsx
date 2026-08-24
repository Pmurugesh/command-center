/**
 * The scoreboard: progress against the declared campaign, not inventory counts.
 *
 * Replaces the old counter strip ("Active bids: 4" is inventory) and absorbs
 * MomentumCard. "Demos 0/3, 12 days left" is a scoreboard — it says whether the
 * campaign is being lost while there is still time to fix it. Targets come from
 * operations gtm/targets.md; every number here is either derived from records
 * or manually attested in that file.
 */
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { Momentum } from '@/lib/insights'
import type { CampaignScore } from '@/lib/gtm'

function Delta({ value, previous }: { value: number; previous: number }) {
  if (value === previous) {
    return <span className="flex items-center gap-1 text-xs text-muted-foreground"><Minus className="h-3 w-3" />flat</span>
  }
  const up = value > previous
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <span className={`flex items-center gap-1 text-xs ${up ? 'text-emerald-400' : 'text-red-400'}`}>
      <Icon className="h-3 w-3" />
      {up ? '+' : ''}{value - previous} vs prior wk
    </span>
  )
}

function Tile({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 font-mono text-3xl font-semibold tabular-nums leading-none">{children}</p>
        {sub && <div className="mt-1.5 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  )
}

// n/target with a muted denominator; goes amber when the window is closing and
// the number is still short — behind-with-time is calm, behind-without-time is not.
function Ratio({ actual, target, closing }: { actual: number; target: number; closing: boolean }) {
  const behind = actual < target
  return (
    <span className={closing && behind ? 'text-status-warning' : undefined}>
      {actual}
      <span className="text-xl text-muted-foreground">/{target}</span>
    </span>
  )
}

interface ScoreboardProps {
  momentum: Momentum | null
  score: CampaignScore
}

export function Scoreboard({ momentum, score }: ScoreboardProps) {
  const touches = momentum?.metrics.find(m => m.label === 'Touches')
  const quiet = momentum?.quiet ?? true
  const days = momentum?.daysSinceLastTouch ?? null

  const touchTile = (
    <Tile label="Touches" sub={touches && <Delta value={touches.value} previous={touches.previous} />}>
      <span className={quiet ? 'text-status-warning' : undefined}>{touches?.value ?? 0}</span>
    </Tile>
  )

  const { targets } = score
  if (!targets) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5 md:gap-4">
        {touchTile}
        <Card className="md:col-span-4">
          <CardContent className="flex h-full items-center p-4">
            <p className="text-sm text-muted-foreground">
              No campaign targets set. Add <code className="rounded bg-muted px-1 py-0.5 text-xs">gtm/targets.md</code>{' '}
              to operations to track meetings, demos, and pilot progress here.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const closing = score.daysLeft !== null && score.daysLeft <= 7
  const phase0Done = targets.phase0.filter(p => p.done).length
  const nextGate = targets.phase0.find(p => !p.done)

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5 md:gap-4">
        {touchTile}
        <Tile label="Meetings" sub="agency, this campaign">
          <Ratio actual={score.meetingsHeld} target={targets.meetings} closing={closing} />
        </Tile>
        <Tile label="Demos" sub="delivered">
          <Ratio actual={score.demosGiven} target={targets.demos} closing={closing} />
        </Tile>
        <Tile label="Pilot LOI" sub="signed">
          <Ratio actual={targets.loiActual} target={targets.loi} closing={closing} />
        </Tile>
        <div className="col-span-2 md:col-span-1">
          <Tile
            label="Phase 0"
            sub={nextGate ? `Next: ${nextGate.label}` : 'All gates cleared'}
          >
            <span className={nextGate ? 'text-status-warning' : 'text-status-success'}>
              {phase0Done}
              <span className="text-xl text-muted-foreground">/{targets.phase0.length}</span>
            </span>
          </Tile>
        </div>
      </div>
      {/* The honest line, carried over from MomentumCard: a quiet week says so
          out loud, and the campaign clock keeps counting either way. */}
      <p className={`text-xs ${quiet ? 'text-amber-400' : 'text-muted-foreground'}`}>
        {targets.campaign} · ends {targets.end} · {score.daysLeft}d left
        {' — '}
        {days === null
          ? 'no outbound touch has ever been logged.'
          : quiet
            ? `nothing logged in 7 days; last touch ${days}d ago.`
            : `last touch ${days === 0 ? 'today' : `${days}d ago`}.`}
      </p>
    </div>
  )
}
