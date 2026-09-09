/**
 * Roadmap — the direction layer (Phase 13, on top of Phase 12's commitments).
 *
 * Phase 12 answered "are we on time?" for ten undated initiatives. This module
 * answers "what should I build next, and why?" by splitting each initiative in
 * two:
 *
 *   rows/<row>.md   a north star that does not move, plus the paths whose
 *                   movement counts as investment in it
 *   <milestone>.md  the 65 things that do move, each with ONE kind of proof
 *
 * Split, deliberately (the registry doctrine, applied to dates):
 *   authored  → operations/roadmap/{rows/*.md, <milestone>.md}
 *   derived   → operations/roadmap/_status.md (scripts/roadmap-check.ts)
 *
 * There is NO `status:` and NO `owner:` field anywhere. Pavan owns every
 * roadmap, so an owner column would be a constant; `waiting_on:` carries the
 * thing that actually varies. `done:` is a fact recorded once and every state
 * before it is computed — a hand-maintained status column is the exact thing
 * that goes stale and lies.
 *
 * Four kinds of milestone, four kinds of proof:
 *   build     human commits on an evidence path
 *   handoff   a literal that lands in someone else's repo, then a reference here
 *   demand    a CRM stage on a named contact, or a logged agency meeting
 *   decision  a fact typed once — a [RESOLVED] suffix, a field, a file, a flag
 *
 * Anything those cannot express is `proof: manual` and renders needs-a-person.
 * It never renders done. That is the whole reason the vocabulary is small.
 */
import fs from 'fs/promises'
import path from 'path'
import matter from 'gray-matter'
import { PATHS } from './paths'
import { stageAtLeast, wantsProduct, CRM_STAGE_ORDER, type CrmStage } from './config'

/** Evidence colder than this while a target is near means nobody is working. */
export const EVIDENCE_WARN_DAYS = 14
/** Cold this long with no near target is a milestone that has gone quiet. */
export const EVIDENCE_IDLE_DAYS = 30
/** A target this close is "now" — matches the Clock's window. */
export const TARGET_NEAR_DAYS = 14
/** `_status.md` older than this is not trustworthy; render unknown, never green. */
export const STATUS_STALE_DAYS = 10
/** Shipped and still standing after this long is `proven` without a second proof. */
export const PROVEN_CLEAN_DAYS = 30
/** Investment windows, in days. Two numbers: is it moving, and did it ever. */
export const INVESTMENT_WINDOWS = [30, 90] as const

export type RoadmapGroup = 'nexus' | 'platform' | 'suite' | 'internal' | 'web'
export type RowKind = 'product' | 'platform' | 'internal'
export type MilestoneKind = 'build' | 'handoff' | 'demand' | 'decision'
export type Horizon = 'now' | 'next' | 'later'

export const HORIZONS: readonly Horizon[] = ['now', 'next', 'later']
export const MILESTONE_KINDS: readonly MilestoneKind[] = ['build', 'handoff', 'demand', 'decision']

/**
 * The stage ladder — separate from `state`, and orthogonal to it.
 *
 * `state` answers "is this in trouble?"; `stage` answers "how far along is it?".
 * A milestone can be `no-target` (state) and `building` (stage) at once, which
 * is exactly the honest reading of most of this board on day one.
 */
export type Stage = 'framed' | 'committed' | 'building' | 'shipped' | 'proven'
export const STAGES: readonly Stage[] = ['framed', 'committed', 'building', 'shipped', 'proven']

/**
 * Derived states, worst first. `unknown` is load-bearing: a repo that would not
 * fetch, or a `_status.md` that never ran, must never render as on-track.
 * `needs-person` is Phase 13's addition — a DoD the proof vocabulary cannot
 * express is not a failure and not a success, it is a person's job.
 */
export type RoadmapState =
  | 'slipped' | 'at-risk' | 'unknown' | 'stranded'
  | 'idle' | 'no-target' | 'needs-person' | 'on-track' | 'active' | 'done'

/** Handoff lifecycle. `consumed` is the only state that means we got value. */
export type HandoffState = 'spec-sent' | 'pr-opened' | 'merged' | 'consumed' | 'unknown'

export interface EvidencePath {
  repo: string
  path: string
}

/**
 * The nine checks, and no tenth. Each is decidable from a file or a git tree
 * with no judgement and no model call — that is the entry requirement. A DoD
 * that needs a person is `proof: manual`, which is honest rather than absent.
 */
export type ProofCheck =
  | { check: 'file_exists'; path: string }
  | { check: 'frontmatter_field'; path: string; field: string; equals: unknown }
  | { check: 'decision_resolved'; path: string; contains: string }
  | { check: 'git_path_exists'; repo: string; path: string }
  | { check: 'git_grep'; repo: string; path?: string; pattern: string }
  | { check: 'flag_default'; repo: string; path: string; name: string; equals: unknown }
  | { check: 'contact_stage'; contact: string; at_least: string }
  | { check: 'contacts_count'; product: string; stage_at_least: string; count: number }
  | { check: 'meeting_logged'; agency: string; title_match: string; after?: string }

export const PROOF_CHECKS = [
  'file_exists', 'frontmatter_field', 'decision_resolved', 'git_path_exists',
  'git_grep', 'flag_default', 'contact_stage', 'contacts_count', 'meeting_logged',
] as const

export interface RoadmapMilestone {
  slug: string
  name: string
  row: string
  kind: MilestoneKind
  horizon: Horizon
  /** `handoff` and anything gated on a person: who holds the ball. */
  waitingOn?: string
  target?: string // YYYY-MM-DD — only ever set by Pavan
  done?: string   // YYYY-MM-DD — recorded once, never maintained
  unlocks: string[]
  blockedOn: string[]
  evidence: EvidencePath[]
  handoff?: { spec?: string; landed?: string; consumedBy?: string; pr?: string }
  /** `null` when the file says `proof: manual`; `[]` when it declares none. */
  proof: ProofCheck[] | null
  proven: ProofCheck[]
  body: string

  // ── derived (joined from _status.md; undefined when it has not run) ──
  daysToTarget?: number
  /** Days since the last *human* commit touching any evidence path on origin. */
  evidenceAgeDays?: number
  lastEvidenceAt?: string
  handoffState?: HandoffState
  /** Which ref the handoff literal was found at — `origin/main` or an
   *  integration branch. Shown, so `merged` on staging is never read as main. */
  handoffRef?: string
  handoffAgeDays?: number
  proofTrue?: number
  proofTotal?: number
  /** Per-check results, in declaration order — rendered on expand. */
  proofResults?: ProofResult[]
  provenTrue?: number
  provenTotal?: number
  state: RoadmapState
  stage: Stage
  /** Why the state is what it is — rendered verbatim, so it must read as prose. */
  reason: string
}

export interface ProofResult {
  check: string
  ok: boolean
  detail: string
}

export interface RowPull {
  /** Contacts for this row's product, bucketed by stage. */
  byStage: Record<string, number>
  total: number
  /** Contacts at `contacted` or beyond — the only ones that mean anything. */
  warm: number
  /** `category: agency` meetings in the last 90 days touching this row. */
  meetings90: number
  /** Raw weighted score; `rankBuildNext` normalizes across rows. */
  score: number
}

export interface RoadmapRow {
  slug: string
  name: string
  group: RoadmapGroup
  kind: RowKind
  /** group `nexus` only — joins to operations/products/<slug>.md and the CRM. */
  product?: string
  northStar: string
  strategy?: string
  repos: string[]
  evidence: EvidencePath[]
  body: string

  // ── derived ──
  investment?: Record<number, number> // window in days → human commit count
  pull?: RowPull
  /** Slug of this row's highest-ranked open milestone — the local "do this". */
  nextMilestone?: string
  milestones: RoadmapMilestone[]
}

export interface RoadmapStatus {
  generatedAt?: string
  /** Last successful run from the log — set even when the run changed nothing. */
  lastRunAt?: string
  stale: boolean
  ran: boolean
  items: Record<string, DerivedEntry>
  rows: Record<string, DerivedRow>
  ranking: RankedMilestone[]
  lint: string[]
}

export interface DerivedEntry {
  slug: string
  evidenceAgeDays?: number | null
  lastEvidenceAt?: string | null
  handoffState?: HandoffState
  /** Which ref the literal was found at. Present only when merged/consumed. */
  handoffRef?: string
  handoffAgeDays?: number | null
  handoffAt?: string | null
  proofTrue?: number | null
  proofTotal?: number | null
  proofResults?: ProofResult[]
  provenTrue?: number | null
  provenTotal?: number | null
  /** Set when the repo could not be fetched or read — forces `unknown`. */
  error?: string
}

export interface DerivedRow {
  slug: string
  investment?: Record<number, number>
  pull?: RowPull
  nextMilestone?: string
}

export interface RankedMilestone {
  slug: string
  name: string
  row: string
  score: number
  reason: string
}

/**
 * Ages are computed from the stored timestamps at read time, so a status file
 * written on Monday still says the right number on Thursday — and the check
 * only has to rewrite the file when a FACT changes, not when a day passes.
 * The stored `*_age_days` are a fallback for entries with no timestamp.
 */
export function withLiveAges(d: DerivedEntry, now = new Date()): DerivedEntry {
  const age = (iso?: string | null) => {
    if (!iso) return undefined
    const t = new Date(iso).getTime()
    return isNaN(t) ? undefined : Math.floor((now.getTime() - t) / 86_400_000)
  }
  return {
    ...d,
    evidenceAgeDays: age(d.lastEvidenceAt) ?? d.evidenceAgeDays,
    handoffAgeDays: age(d.handoffAt) ?? d.handoffAgeDays,
  }
}

/** ISO time of the last successful roadmap-check run, from its log. Null when
 *  there is none — normal on the MacBook, where the check refuses to run. */
export async function lastRoadmapCheck(): Promise<string | null> {
  try {
    const lines = (await fs.readFile(PATHS.roadmapCheckLog, 'utf-8')).trim().split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = /^(\S+) ok\b/.exec(lines[i])
      if (m) return m[1]
    }
    return null
  } catch {
    return null
  }
}

export function daysBetween(from: Date, toDate: string): number {
  const [y, m, d] = toDate.split('-').map(Number)
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()
  return Math.round((new Date(y, m - 1, d).getTime() - a) / 86_400_000)
}

/**
 * The single definition of "how are we doing" — imported by both the page and
 * roadmap-check, so the board and the generated report can never disagree.
 *
 * Order matters. `done` short-circuits; a missing derivation is `unknown`
 * before it is anything reassuring; a real slip outranks everything else.
 *
 * The `build` and `handoff` branches are Phase 12's, unchanged — their ten
 * cases are pinned by tests. `demand` and `decision` are Phase 13's addition.
 */
export function deriveState(
  item: Pick<RoadmapMilestone, 'kind' | 'target' | 'done'>,
  derived: DerivedEntry | undefined,
  statusRan: boolean,
  now = new Date()
): { state: RoadmapState; reason: string; daysToTarget?: number } {
  if (item.done) return { state: 'done', reason: `Done ${item.done}` }

  const daysToTarget = item.target ? daysBetween(now, item.target) : undefined

  // A slip is a fact about a date we set, knowable without any repo access.
  if (daysToTarget !== undefined && daysToTarget < 0) {
    return {
      state: 'slipped',
      reason: `Target ${item.target} passed ${-daysToTarget}d ago, not marked done`,
      daysToTarget,
    }
  }

  if (!statusRan) {
    return { state: 'unknown', reason: 'roadmap-check has not run', daysToTarget }
  }
  if (derived?.error) {
    return { state: 'unknown', reason: derived.error, daysToTarget }
  }

  if (item.kind === 'handoff') {
    const hs = derived?.handoffState ?? 'unknown'
    if (hs === 'unknown') return { state: 'unknown', reason: 'Handoff state not resolved', daysToTarget }
    if (hs === 'consumed') return { state: 'done', reason: 'Landed and consumed', daysToTarget }
    const age = derived?.handoffAgeDays
    // Shipped on their side and unused on ours is the worst handoff outcome:
    // it looks finished from every angle except the one that matters.
    if (hs === 'merged') {
      return {
        state: 'stranded',
        reason: age != null
          ? `Merged ${age}d ago, still not consumed here`
          : 'Merged, still not consumed here',
        daysToTarget,
      }
    }
    return {
      state: age != null && age >= EVIDENCE_IDLE_DAYS ? 'idle' : 'active',
      reason: age != null ? `${hs.replace('-', ' ')} — ${age}d ago` : hs.replace('-', ' '),
      daysToTarget,
    }
  }

  if (item.kind === 'demand' || item.kind === 'decision') {
    const total = derived?.proofTotal
    const yes = derived?.proofTrue ?? 0
    // `proof: manual` arrives as total 0 with the manual marker; either way a
    // milestone with nothing to check is a person's job, never a green row.
    if (total == null) {
      return { state: 'unknown', reason: 'Proof not evaluated', daysToTarget }
    }
    if (total === 0) {
      return {
        state: 'needs-person',
        reason: 'No machine proof exists for this — someone has to look',
        daysToTarget,
      }
    }
    if (yes === total) {
      return { state: 'done', reason: `Proof satisfied (${yes}/${total})`, daysToTarget }
    }
    if (daysToTarget !== undefined && daysToTarget <= TARGET_NEAR_DAYS) {
      return yes > 0
        ? { state: 'on-track', reason: `Due in ${daysToTarget}d, proof ${yes}/${total}`, daysToTarget }
        : { state: 'at-risk', reason: `Due in ${daysToTarget}d, no part of the proof is true yet`, daysToTarget }
    }
    if (daysToTarget === undefined) {
      return {
        state: 'no-target',
        reason: `Proof ${yes}/${total} — no target date set`,
        daysToTarget,
      }
    }
    return yes > 0
      ? { state: 'active', reason: `Proof ${yes}/${total}, ${daysToTarget}d to target`, daysToTarget }
      : { state: 'idle', reason: `No part of the proof is true yet, ${daysToTarget}d to target`, daysToTarget }
  }

  const age = derived?.evidenceAgeDays
  if (age == null) {
    return { state: 'unknown', reason: 'No evidence path resolved', daysToTarget }
  }

  if (daysToTarget !== undefined && daysToTarget <= TARGET_NEAR_DAYS) {
    return age >= EVIDENCE_WARN_DAYS
      ? {
          state: 'at-risk',
          reason: `Due in ${daysToTarget}d, no commits on the evidence path in ${age}d`,
          daysToTarget,
        }
      : { state: 'on-track', reason: `Due in ${daysToTarget}d, last commit ${age}d ago`, daysToTarget }
  }

  if (age >= EVIDENCE_IDLE_DAYS) {
    return {
      state: 'idle',
      reason: `No commits on the evidence path in ${age}d`,
      daysToTarget,
    }
  }

  if (daysToTarget === undefined) {
    return { state: 'no-target', reason: `Active (last commit ${age}d ago) but no target date set`, daysToTarget }
  }

  return { state: 'active', reason: `Last commit ${age}d ago, ${daysToTarget}d to target`, daysToTarget }
}

/**
 * How far along, on a ladder that only ever goes up.
 *
 * Highest rung reached wins, so a milestone with both a target and movement is
 * `building`, not `committed`. `proven` is deliberately hard: a second proof
 * that someone else consumed the thing, or thirty days standing after `done` —
 * because "shipped" and "worked" are different claims and Phase 12's stranded
 * handoff is the standing proof that conflating them costs three months.
 */
export function deriveStage(
  m: Pick<RoadmapMilestone, 'kind' | 'target' | 'done'>,
  derived: DerivedEntry | undefined,
  now = new Date()
): Stage {
  const provenTotal = derived?.provenTotal ?? 0
  const provenTrue = derived?.provenTrue ?? 0
  if (provenTotal > 0 && provenTrue === provenTotal) return 'proven'
  if (m.done && daysBetween(now, m.done) <= -PROVEN_CLEAN_DAYS) return 'proven'

  if (m.done) return 'shipped'
  const proofTotal = derived?.proofTotal ?? 0
  const proofTrue = derived?.proofTrue ?? 0
  if (proofTotal > 0 && proofTrue === proofTotal) return 'shipped'
  if (derived?.handoffState === 'consumed') return 'shipped'

  if (derived?.evidenceAgeDays != null && derived.evidenceAgeDays < EVIDENCE_IDLE_DAYS) return 'building'
  if (derived?.handoffState === 'pr-opened' || derived?.handoffState === 'merged') return 'building'
  if (proofTrue > 0) return 'building'

  if (m.target) return 'committed'
  return 'framed'
}

// ── build-next ranking ──────────────────────────────────────────────────────

/** Stage weight for pull. `identified` is worth nothing: it means a name on a
 *  list, and 95 of 104 contacts are sitting at it. */
const PULL_STAGE_WEIGHT: Record<string, number> = {
  identified: 0, contacted: 1, 'meeting-booked': 2, 'demo-given': 3,
  'pilot-discussion': 4, 'verbal-commitment': 5, won: 6,
  lost: 0, disqualified: 0,
}

/**
 * The two ways a row's effort and its demand can disagree — deliberately mirrors.
 *
 * `investedWithoutPull` is effort with nobody asking. `demandWithoutInvestment`
 * is the opposite and the more expensive one: somebody warm is asking and
 * nobody is building. Pavan named the second himself on 2026-09-08 — "if I need
 * more resources then I need more and I need to hire or fire depending on the
 * need" — and asked for the squeeze to be surfaced **without the board tracking
 * people**. So this reads only commits and demand, the two things it already
 * derives, and says nothing about who. The read that the answer is a person
 * stays his.
 *
 * Both are gated on `product`. That gate is load-bearing: a row with no product
 * has no demand column at all, so both flags would be meaningless there — and
 * BidPro's `pull 0` in particular is now correct BY DEFINITION (Pavan confirmed
 * it internal, 2026-09-08), not a finding.
 *
 * The thresholds, and why they are these:
 *
 * - `pull >= 5` is one contact at `verbal-commitment` — someone has actually
 *   said yes — or an equivalent mix. Below that, "demand" is a meeting or two
 *   and quiet is a defensible answer.
 * - `inv30 < 10` is under roughly two human commits a week: a row nobody is
 *   actively building, as opposed to one being built slowly.
 *
 * Checked against the real board rather than picked in the abstract: it fires on
 * Attest (8 commits / pull 9), Steward (6 / 17) and Milestone (7 / 14) and on
 * nothing else. Those are exactly the rows behind Pavan's own sentence — "the
 * two products with warm agencies got 18 between them".
 */
export const DEMAND_FLOOR_SCORE = 5
export const QUIET_COMMITS_30D = 10

export interface RowSignals {
  /** Effort with nobody asking. */
  investedWithoutPull: boolean
  /** Somebody warm is asking and nobody is building — the squeeze. */
  demandWithoutInvestment: boolean
}

export function rowSignals(row: Pick<RoadmapRow, 'product' | 'investment' | 'pull'>): RowSignals {
  const scored = Boolean(row.product)
  const inv30 = row.investment?.[30] ?? 0
  const inv90 = row.investment?.[90] ?? 0
  const score = row.pull?.score ?? 0
  return {
    investedWithoutPull: scored && inv90 >= 20 && score === 0,
    demandWithoutInvestment:
      scored && score >= DEMAND_FLOOR_SCORE && inv30 < QUIET_COMMITS_30D,
  }
}

export function pullScore(byStage: Record<string, number>, meetings90: number): number {
  let s = 0
  for (const [stage, n] of Object.entries(byStage)) s += (PULL_STAGE_WEIGHT[stage] ?? 0) * n
  return s + 2 * meetings90
}

/** Everything reachable from `slug` through `unlocks`, excluding itself. */
export function reachableThroughUnlocks(
  slug: string,
  unlocksBySlug: Map<string, string[]>
): Set<string> {
  const seen = new Set<string>()
  const stack = [...(unlocksBySlug.get(slug) ?? [])]
  while (stack.length) {
    const next = stack.pop()!
    if (next === slug || seen.has(next)) continue
    seen.add(next)
    for (const u of unlocksBySlug.get(next) ?? []) stack.push(u)
  }
  return seen
}

const OPEN_STAGES: readonly Stage[] = ['framed', 'committed', 'building']

/**
 * Build next, deterministically.
 *
 *   score = reach × (1 + mean normalized pull of the rows those milestones sit
 *           in) + urgency
 *
 * `reach` counts only OPEN milestones, so unlocking work that is already done
 * earns nothing. Pull is normalized across rows so a row with three warm
 * contacts cannot be swamped by one with ninety cold ones. Urgency is the only
 * term that can move a leaf milestone to the top, and on a board with no target
 * dates it reduces to "Pavan is holding the ball" — which is the honest answer.
 *
 * No model call, no weighting anyone has to trust: ties break on slug.
 */
export function rankBuildNext(
  rows: RoadmapRow[],
  now = new Date(),
  limit = 10
): RankedMilestone[] {
  return rankAllOpen(rows, now).slice(0, limit)
}

/**
 * The highest-scoring OPEN milestone in each row, by the same ranking Build
 * next uses.
 *
 * Build next is a global top ten, so eight of twelve rows have nothing in it —
 * and a reader inside a row card had no way to tell which of its nine tiles
 * mattered most without scrolling back to the top. This answers that locally
 * without inventing a second notion of importance.
 */
export function topOpenByRow(rows: RoadmapRow[], now = new Date()): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of rankAllOpen(rows, now)) {
    if (!(r.row in out)) out[r.row] = r.slug // already sorted, so first wins
  }
  return out
}

function rankAllOpen(
  rows: RoadmapRow[],
  now: Date
): RankedMilestone[] {
  const milestones = rows.flatMap(r => r.milestones)
  const bySlug = new Map(milestones.map(m => [m.slug, m]))
  const unlocksBySlug = new Map(milestones.map(m => [m.slug, m.unlocks]))
  const rowBySlug = new Map(rows.map(r => [r.slug, r]))

  const maxPull = Math.max(0, ...rows.map(r => r.pull?.score ?? 0))
  const norm = (rowSlug: string) => {
    if (maxPull <= 0) return 0
    return (rowBySlug.get(rowSlug)?.pull?.score ?? 0) / maxPull
  }

  const open = milestones.filter(m => OPEN_STAGES.includes(m.stage))

  const ranked = open.map(m => {
    const reachable = Array.from(reachableThroughUnlocks(m.slug, unlocksBySlug))
      .map(s => bySlug.get(s))
      .filter((x): x is RoadmapMilestone => Boolean(x) && OPEN_STAGES.includes(x!.stage))
    const reach = reachable.length

    const pullRows = [m.row, ...reachable.map(x => x.row)]
    const meanPull = pullRows.reduce((a, r) => a + norm(r), 0) / pullRows.length

    let urgency = 0
    const bits: string[] = []
    if (m.daysToTarget !== undefined && m.daysToTarget < 0) {
      urgency += 3
      bits.push(`overdue ${-m.daysToTarget}d`)
    } else if (m.daysToTarget !== undefined && m.daysToTarget <= TARGET_NEAR_DAYS) {
      urgency += 2
      bits.push(`due in ${m.daysToTarget}d`)
    }
    if (m.waitingOn && /pavan/i.test(m.waitingOn)) {
      urgency += 1
      bits.push('waiting on you')
    }

    const score = reach * (1 + meanPull) + urgency
    const reason = [
      reach > 0 ? `unlocks ${reach} milestone${reach === 1 ? '' : 's'}` : 'unlocks nothing yet',
      meanPull > 0 ? `pull ${meanPull.toFixed(2)}` : null,
      ...bits,
    ].filter(Boolean).join(' · ')

    return { slug: m.slug, name: m.name, row: m.row, score, reason }
  })

  return ranked.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))
}

// ── parsing ─────────────────────────────────────────────────────────────────

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []
}

/** Frontmatter dates parse as Date via YAML; normalize both spellings. */
function ymd(v: unknown): string | undefined {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`
  }
  const s = str(v)
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined
}

export function parseEvidence(v: unknown): EvidencePath[] {
  if (!Array.isArray(v)) return []
  return v.flatMap(e => {
    if (!e || typeof e !== 'object') return []
    const repo = str((e as Record<string, unknown>).repo)
    const p = str((e as Record<string, unknown>).path)
    return repo && p ? [{ repo, path: p }] : []
  })
}

/** `proof: manual` → null (needs a person). A list → the checks it declares. */
export function parseProof(v: unknown): ProofCheck[] | null {
  if (typeof v === 'string') return v.trim().toLowerCase() === 'manual' ? null : []
  if (!Array.isArray(v)) return []
  return v.flatMap(e => {
    if (!e || typeof e !== 'object') return []
    const c = e as Record<string, unknown>
    const check = str(c.check)
    if (!check || !(PROOF_CHECKS as readonly string[]).includes(check)) return []
    return [{ ...c, check } as ProofCheck]
  })
}

// ── reading the derived half ────────────────────────────────────────────────

function num(v: unknown): number | null {
  return typeof v === 'number' && isFinite(v) ? v : null
}

/** Read `_status.md`'s frontmatter — the derived half. Absent is a legal state. */
export async function readStatus(): Promise<RoadmapStatus> {
  const empty: RoadmapStatus = { ran: false, stale: true, items: {}, rows: {}, ranking: [], lint: [] }
  let raw: string
  try {
    raw = await fs.readFile(PATHS.roadmapStatus, 'utf-8')
  } catch {
    return empty
  }
  try {
    const { data } = matter(raw)
    const generatedAt = str(data.generated_at)
    // Freshness is "when did the check last RUN", not "when did the file last
    // change" — a quiet fortnight with no new commits is not a stale board.
    const lastRunAt = (await lastRoadmapCheck()) ?? undefined
    const freshAt = lastRunAt && (!generatedAt || lastRunAt > generatedAt) ? lastRunAt : generatedAt
    const ageDays = freshAt
      ? (Date.now() - new Date(freshAt).getTime()) / 86_400_000
      : Infinity

    const items: Record<string, DerivedEntry> = {}
    for (const e of Array.isArray(data.checked) ? data.checked : []) {
      if (!e || typeof e !== 'object') continue
      const r = e as Record<string, unknown>
      const slug = str(r.slug)
      if (!slug) continue
      items[slug] = {
        slug,
        evidenceAgeDays: num(r.evidence_age_days),
        lastEvidenceAt: str(r.last_evidence_at) ?? null,
        handoffState: str(r.handoff_state) as HandoffState | undefined,
        handoffRef: str(r.handoff_ref),
        handoffAgeDays: num(r.handoff_age_days),
        handoffAt: str(r.handoff_at) ?? null,
        proofTrue: num(r.proof_true),
        proofTotal: num(r.proof_total),
        proofResults: Array.isArray(r.proof_results)
          ? (r.proof_results as unknown[]).flatMap(p => {
              if (!p || typeof p !== 'object') return []
              const q = p as Record<string, unknown>
              return [{ check: String(q.check ?? '?'), ok: Boolean(q.ok), detail: String(q.detail ?? '') }]
            })
          : undefined,
        provenTrue: num(r.proven_true),
        provenTotal: num(r.proven_total),
        error: str(r.error),
      }
    }

    const rows: Record<string, DerivedRow> = {}
    for (const e of Array.isArray(data.rows) ? data.rows : []) {
      if (!e || typeof e !== 'object') continue
      const r = e as Record<string, unknown>
      const slug = str(r.slug)
      if (!slug) continue
      const inv: Record<number, number> = {}
      if (r.investment && typeof r.investment === 'object') {
        for (const [k, v] of Object.entries(r.investment as Record<string, unknown>)) {
          const w = Number(k.replace(/\D/g, ''))
          if (isFinite(w) && typeof v === 'number') inv[w] = v
        }
      }
      const p = (r.pull ?? {}) as Record<string, unknown>
      rows[slug] = {
        slug,
        nextMilestone: str(r.next_milestone),
        investment: Object.keys(inv).length ? inv : undefined,
        pull: r.pull
          ? {
              byStage: (p.by_stage ?? {}) as Record<string, number>,
              total: Number(p.total ?? 0),
              warm: Number(p.warm ?? 0),
              meetings90: Number(p.meetings_90 ?? 0),
              score: Number(p.score ?? 0),
            }
          : undefined,
      }
    }

    const ranking: RankedMilestone[] = (Array.isArray(data.ranking) ? data.ranking : []).flatMap(e => {
      if (!e || typeof e !== 'object') return []
      const r = e as Record<string, unknown>
      const slug = str(r.slug)
      return slug
        ? [{ slug, name: str(r.name) ?? slug, row: str(r.row) ?? '', score: Number(r.score ?? 0), reason: str(r.reason) ?? '' }]
        : []
    })

    return {
      generatedAt,
      lastRunAt,
      ran: true,
      // A check that has not run in over a week is not evidence of health.
      stale: !isFinite(ageDays) || ageDays > STATUS_STALE_DAYS,
      items,
      rows,
      ranking,
      lint: strList(data.lint),
    }
  } catch {
    return empty
  }
}

/** Worst first — the board is read top-down and the top must be the problem. */
const STATE_RANK: Record<RoadmapState, number> = {
  slipped: 0, stranded: 1, 'at-risk': 2, unknown: 3,
  idle: 4, 'no-target': 5, 'needs-person': 6, 'on-track': 7, active: 8, done: 9,
}

export function compareMilestones(a: RoadmapMilestone, b: RoadmapMilestone): number {
  return STATE_RANK[a.state] - STATE_RANK[b.state] ||
    (a.target ?? '9999').localeCompare(b.target ?? '9999') ||
    a.name.localeCompare(b.name)
}

// ── reading the authored half ───────────────────────────────────────────────

const SKIP = (n: string) =>
  !n.endsWith('.md') || n.startsWith('_') || n.startsWith('.') || n === 'README.md'

export function parseRow(filename: string, raw: string): RoadmapRow | null {
  const { data, content } = matter(raw)
  const slug = str(data.slug) ?? filename.replace(/\.md$/, '')
  return {
    slug,
    name: str(data.name) ?? slug,
    group: (str(data.group) ?? 'internal') as RoadmapGroup,
    kind: (str(data.kind) ?? 'internal') as RowKind,
    product: str(data.product),
    northStar: str(data.north_star) ?? '',
    strategy: str(data.strategy),
    repos: strList(data.repos),
    evidence: parseEvidence(data.evidence),
    body: content.trim(),
    milestones: [],
  }
}

export function parseMilestone(filename: string, raw: string): Omit<
  RoadmapMilestone, 'state' | 'stage' | 'reason'
> | null {
  const { data, content } = matter(raw)
  const slug = str(data.slug) ?? filename.replace(/\.md$/, '')
  const row = str(data.row)
  if (!row) return null // a milestone with no row is not a milestone
  const h = (data.handoff ?? {}) as Record<string, unknown>
  const kind = (str(data.kind) ?? 'build') as MilestoneKind
  return {
    slug,
    name: str(data.name) ?? slug,
    row,
    kind,
    horizon: (HORIZONS.includes(str(data.horizon) as Horizon) ? str(data.horizon) : 'later') as Horizon,
    waitingOn: str(data.waiting_on),
    target: ymd(data.target),
    done: ymd(data.done),
    unlocks: strList(data.unlocks),
    blockedOn: strList(data.blocked_on),
    evidence: parseEvidence(data.evidence),
    handoff: kind === 'handoff'
      ? { spec: str(h.spec), landed: str(h.landed), consumedBy: str(h.consumed_by), pr: str(h.pr) }
      : undefined,
    proof: parseProof(data.proof),
    proven: parseProof(data.proven) ?? [],
    body: content.trim(),
  }
}

/** Every authored file, parsed but not yet joined to the derived half. */
export async function readAuthored(): Promise<{
  rows: RoadmapRow[]
  milestones: Omit<RoadmapMilestone, 'state' | 'stage' | 'reason'>[]
}> {
  const rows: RoadmapRow[] = []
  const milestones: Omit<RoadmapMilestone, 'state' | 'stage' | 'reason'>[] = []

  const rowNames = await fs.readdir(path.join(PATHS.roadmap, 'rows')).catch(() => [] as string[])
  for (const n of rowNames) {
    if (SKIP(n)) continue
    try {
      const raw = await fs.readFile(path.join(PATHS.roadmap, 'rows', n), 'utf-8')
      const r = parseRow(n, raw)
      if (r) rows.push(r)
    } catch { /* corrupt frontmatter — skip the file, never the board */ }
  }

  const names = await fs.readdir(PATHS.roadmap).catch(() => [] as string[])
  for (const n of names) {
    if (SKIP(n)) continue
    try {
      const raw = await fs.readFile(path.join(PATHS.roadmap, n), 'utf-8')
      const m = parseMilestone(n, raw)
      if (m) milestones.push(m)
    } catch { /* same */ }
  }

  return { rows, milestones }
}

// ── the lint ────────────────────────────────────────────────────────────────

/**
 * Five invariants, checked inside the run so a broken board fails loudly rather
 * than rendering plausibly. A dangling `unlocks:` is the dangerous one: the
 * ranking multiplies by reach, so one typo silently demotes real work.
 */
export function lintRoadmap(
  rows: RoadmapRow[],
  milestones: Pick<RoadmapMilestone,
    'slug' | 'row' | 'kind' | 'unlocks' | 'blockedOn' | 'evidence' | 'proof'>[]
): string[] {
  const errors: string[] = []
  const rowSlugs = new Set(rows.map(r => r.slug))
  const slugs = new Set(milestones.map(m => m.slug))

  for (const r of rows) {
    if (!r.northStar) errors.push(`row ${r.slug}: no north_star`)
  }

  for (const m of milestones) {
    if (!rowSlugs.has(m.row)) errors.push(`${m.slug}: row "${m.row}" does not exist`)
    for (const u of m.unlocks) {
      if (!slugs.has(u)) errors.push(`${m.slug}: unlocks "${u}" does not exist`)
    }
    for (const b of m.blockedOn) {
      if (!slugs.has(b)) errors.push(`${m.slug}: blocked_on "${b}" does not exist`)
    }
    if (m.kind === 'build' && m.evidence.length === 0) {
      errors.push(`${m.slug}: kind build with no evidence path`)
    }
    if ((m.kind === 'demand' || m.kind === 'decision') && m.proof !== null && m.proof.length === 0) {
      errors.push(`${m.slug}: kind ${m.kind} with no proof (use \`proof: manual\` if none exists)`)
    }
    // A pattern that will not compile is an AUTHORING error, not an unknown.
    // Caught 2026-09-08: `attest-oeis-demo` carried `(?i)(demo|walkthrough…)`,
    // a Python inline flag JavaScript rejects, so the milestone rendered
    // `unknown` with the reason buried in `checked:` — indistinguishable from a
    // repo that is not cloned. Absence renders unknown; a typo should render
    // loud, at lint time, before the board ever shows it.
    for (const c of m.proof ?? []) {
      if (!('title_match' in c) || typeof c.title_match !== 'string') continue
      try { new RegExp(c.title_match) } catch {
        errors.push(`${m.slug}: title_match ${JSON.stringify(c.title_match)} is not a regex`)
      }
    }
  }

  // Cycles in `unlocks` would make `reachableThroughUnlocks` meaningless and the
  // ranking arbitrary. Iterative DFS with a colour map — no recursion depth risk.
  const graph = new Map(milestones.map(m => [m.slug, m.unlocks.filter(u => slugs.has(u))]))
  const colour = new Map<string, 0 | 1 | 2>()
  for (const start of Array.from(graph.keys())) {
    if (colour.get(start)) continue
    const stack: { node: string; i: number }[] = [{ node: start, i: 0 }]
    colour.set(start, 1)
    const path: string[] = [start]
    while (stack.length) {
      const top = stack[stack.length - 1]
      const kids = graph.get(top.node) ?? []
      if (top.i >= kids.length) {
        colour.set(top.node, 2)
        stack.pop()
        path.pop()
        continue
      }
      const next = kids[top.i++]
      const c = colour.get(next) ?? 0
      if (c === 1) {
        errors.push(`cycle in unlocks: ${path.slice(path.indexOf(next)).concat(next).join(' → ')}`)
        continue
      }
      if (c === 0) {
        colour.set(next, 1)
        path.push(next)
        stack.push({ node: next, i: 0 })
      }
    }
  }

  return errors
}

// ── the join ────────────────────────────────────────────────────────────────

/** Group order on the page — Nexus products first, web last. */
export const GROUP_ORDER: RoadmapGroup[] = ['nexus', 'platform', 'suite', 'internal', 'web']

/**
 * The whole board: authored rows and milestones joined to the derived half,
 * with every state, stage and reason computed here so the page can only render
 * what the check already decided.
 */
export async function listRoadmap(now = new Date()): Promise<RoadmapRow[]> {
  const [{ rows, milestones }, status] = await Promise.all([readAuthored(), readStatus()])

  const byRow = new Map(rows.map(r => [r.slug, r]))
  for (const base of milestones) {
    const stored = status.items[base.slug]
    const derived = stored ? withLiveAges(stored, now) : undefined
    const { state, reason, daysToTarget } = deriveState(base, derived, status.ran, now)
    const full: RoadmapMilestone = {
      ...base,
      daysToTarget,
      evidenceAgeDays: derived?.evidenceAgeDays ?? undefined,
      lastEvidenceAt: derived?.lastEvidenceAt ?? undefined,
      handoffState: derived?.handoffState,
      handoffAgeDays: derived?.handoffAgeDays ?? undefined,
      proofTrue: derived?.proofTrue ?? undefined,
      proofTotal: derived?.proofTotal ?? undefined,
      proofResults: derived?.proofResults,
      provenTrue: derived?.provenTrue ?? undefined,
      provenTotal: derived?.provenTotal ?? undefined,
      state,
      stage: deriveStage(base, derived, now),
      reason,
    }
    byRow.get(base.row)?.milestones.push(full)
  }

  for (const r of rows) {
    const d = status.rows[r.slug]
    r.investment = d?.investment
    r.pull = d?.pull
    r.nextMilestone = d?.nextMilestone
    r.milestones.sort(compareMilestones)
  }

  return rows.sort((a, b) =>
    GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) ||
    a.name.localeCompare(b.name)
  )
}

/** Every milestone, flat — what the Clock and the Moves queue consume. */
export function allMilestones(rows: RoadmapRow[]): RoadmapMilestone[] {
  return rows.flatMap(r => r.milestones).sort(compareMilestones)
}

/** The states that belong in front of Pavan rather than on a page he visits.
 *  `needs-person` is deliberately absent: a manual proof is a standing fact,
 *  not news, and Today is for things that changed. */
export function roadmapAlerts(milestones: RoadmapMilestone[]): RoadmapMilestone[] {
  return milestones.filter(m =>
    m.state === 'slipped' || m.state === 'at-risk' || m.state === 'stranded')
}

// ── demand → Today ──────────────────────────────────────────────────────────

/** A contact this warm is a real buying signal, not a name on a list. */
const DEMAND_FLOOR: CrmStage = 'demo-given'
/** Fresh enough to still be the reason to pick up work today. */
export const DEMAND_FRESH_DAYS = 14

export interface DemandSignal {
  row: string
  rowName: string
  /** The warmest recently-touched contact wanting this row's product. */
  contactName: string
  stage: CrmStage
  daysAgo: number
  /** The highest-ranked open `now` milestone in that row — the thing to build. */
  next?: RoadmapMilestone
}

/**
 * Rows where somebody just got warm and there is open work to do about it.
 *
 * Today's queue was built entirely for trouble — slipped, at-risk, stranded —
 * so good news was silent: a contact reaching `won` produced no Move and no
 * Clock row, even though it is the strongest build-next signal on the board.
 * This is the other half.
 *
 * Deliberately read from the LIVE CRM rather than from `_status.md`. Pull in the
 * status file is a snapshot with no history, so "who just got warm" is not
 * derivable from it — and adding history to make it derivable would be a worse
 * trade than reading two fields off a contact.
 *
 * Machine-set stages do not count, for the same reason they do not count
 * anywhere else on this board: `crm/` is janitor-written.
 */
export function roadmapDemandSignals(
  rows: RoadmapRow[],
  contacts: {
    name: string; product?: string; interestedIn?: string[]
    stage: CrmStage; lastTouched?: string; worked: boolean
  }[],
  now = new Date()
): DemandSignal[] {
  const out: DemandSignal[] = []
  for (const row of rows) {
    if (!row.product) continue
    const warm = contacts
      .filter(c =>
        wantsProduct(c, row.product!) &&
        c.worked &&
        stageAtLeast(c.stage, DEMAND_FLOOR) &&
        c.lastTouched &&
        -daysBetween(now, c.lastTouched) <= DEMAND_FRESH_DAYS &&
        -daysBetween(now, c.lastTouched) >= 0)
      // Warmest first, then most recent — one signal per row, not a list.
      .sort((a, b) =>
        CRM_STAGE_ORDER.indexOf(b.stage) - CRM_STAGE_ORDER.indexOf(a.stage) ||
        (b.lastTouched ?? '').localeCompare(a.lastTouched ?? ''))
    const c = warm[0]
    if (!c) continue

    // Only worth surfacing if there is something to DO about it.
    const open = row.milestones.filter(m =>
      m.horizon === 'now' && (m.stage === 'framed' || m.stage === 'committed' || m.stage === 'building'))
    if (open.length === 0) continue

    out.push({
      row: row.slug,
      rowName: row.name,
      contactName: c.name,
      stage: c.stage,
      daysAgo: -daysBetween(now, c.lastTouched!),
      next: open.sort(compareMilestones)[0],
    })
  }
  return out.sort((a, b) =>
    CRM_STAGE_ORDER.indexOf(b.stage) - CRM_STAGE_ORDER.indexOf(a.stage) || a.daysAgo - b.daysAgo)
}
