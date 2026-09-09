/**
 * Roadmap check — regenerate `operations/roadmap/_status.md` (Phases 12 + 13).
 *
 * Phase 12 answered "are we on time?" from two numbers per initiative: days to
 * the target you set, and days since the last HUMAN commit touching the evidence
 * path. Phase 13 keeps both and adds the three things a direction layer needs:
 *
 *   proof       `demand` and `decision` milestones resolve against the CRM and
 *               against facts typed once — nine checks, no tenth, no model call.
 *   investment  human commits per ROW over 30 and 90 days, so "where is the
 *               effort actually going" stops being a guess.
 *   pull        contacts by stage and logged agency meetings per row, so the
 *               ranking can weight unlocks by whether anyone is asking.
 *
 * Four rules this script exists to obey, each learned from a real failure:
 *
 *  1. **Read `origin`, never a working tree.** The mini's contract-management
 *     clone was 98 days behind its own origin; Nexus was 12 behind. A check
 *     against working trees declares live initiatives dead.
 *  2. **Exclude machine commits — and machine CRM touches.** operations takes
 *     ~250 commits/90d of which the clear majority are janitor and cron writes.
 *     `crm/` is entirely machine-written, so a demand check filters by the log
 *     line's `via`, never by commit author: filtering by author there would
 *     exclude everything, and not filtering would count lead-sync as selling.
 *  3. **Absence renders unknown, never green.** A repo that will not fetch, a
 *     path that resolves to nothing — those are `error`, and `deriveState` turns
 *     them into `unknown`. A DoD no check can express is `proof: manual`, which
 *     renders needs-a-person. Neither is ever `on-track`.
 *  4. **A partial board is worse than a stale board.** Refuse to write from a
 *     machine missing any referenced repo, and exit 2.
 *
 * Runs daily ON THE MINI (always-on since the 2026-08-24 pmset fix, holds all
 * the clones). Writes only when a fingerprint of FACTS changes, so a daily cron
 * does not produce a daily commit.
 *
 * Run:  node --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/roadmap-check.ts [--dry]
 */
import fs from 'fs/promises'
import path from 'path'
import { execFile } from 'child_process'
import crypto from 'crypto'
import matter from 'gray-matter'
import { PATHS, REPO_CANDIDATES } from '../src/lib/paths.ts'
import { localDaysAgo } from '../src/lib/dates.ts'
import { runCommandArgs } from '../src/lib/shell.ts'
import {
  readAuthored, lintRoadmap, deriveState, deriveStage, rankBuildNext, topOpenByRow,
  pullScore, INVESTMENT_WINDOWS,
  type HandoffState, type ProofCheck, type ProofResult, type RoadmapRow,
  type RoadmapMilestone, type RowPull, type DerivedEntry,
} from '../src/lib/roadmap.ts'
import { stageAtLeast, wantsProduct } from '../src/lib/config.ts'
import {
  evalCheck, readContacts, readMeetings,
  type Contact, type Meeting, type ProofContext, type GitOps,
} from '../src/lib/roadmap-proof.ts'

const DRY = process.argv.includes('--dry')

/**
 * Commits that are not progress. Bots bump dependencies; the janitors commit
 * cron output and dashboard writes. Both move a path without anyone working on
 * it, which is precisely the false green this whole check exists to avoid.
 */
const BOT_AUTHORS = new Set([
  'renovate[bot]', 'dependabot[bot]', 'github-actions[bot]',
  'Paladin', 'Paladin (mac mini)', 'Paladin (macbook)',
])
const BOT_SUBJECTS = /^(auto|chore\(deps\)|crm: log touch|outreach: regenerate|leads:|intake:)\b|^auto\(/i

/** Same person, two spellings, one git identity that never got normalized. */
const AUTHOR_ALIASES: Record<string, string> = { 'AntarikshRamesh': 'Antariksh Ramesh' }
const canonAuthor = (a: string) => AUTHOR_ALIASES[a] ?? a

const days = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)

/**
 * A repo this machine simply does not have — distinct from one that failed to
 * fetch. The first is a fact about the MACHINE and makes the whole run partial;
 * the second is a fact about the WORLD and is worth recording as `unknown`.
 * Only the first blocks the write (see main).
 */
const NOT_CLONED = 'not cloned on this machine'

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true } catch { return false }
}

/** First candidate path that is actually a git repo on this machine. */
const repoCache = new Map<string, string | null>()
async function resolveRepo(name: string): Promise<string | null> {
  if (repoCache.has(name)) return repoCache.get(name)!
  let found: string | null = null
  for (const c of REPO_CANDIDATES[name] ?? []) {
    if (await exists(path.join(c, '.git'))) { found = c; break }
  }
  repoCache.set(name, found)
  return found
}

const git = (repo: string, args: string[], timeout = 120_000) =>
  runCommandArgs('git', ['-C', repo, ...args], timeout)

/** origin's default branch, not ours — `main` is the fallback, not the assumption. */
const refCache = new Map<string, string>()
async function originRef(repo: string): Promise<string> {
  if (refCache.has(repo)) return refCache.get(repo)!
  const head = await git(repo, ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD'])
  const ref = head.trim() || 'origin/main'
  refCache.set(repo, ref)
  return ref
}

/**
 * Refs that count as "landed" beyond origin's default branch.
 *
 * The BidPro team merges to `staging` — 634 commits there in 90 days, and the
 * unified-bid plan landed there on 2026-09-08 — while `origin/main` moves
 * separately. Checking only the default ref made all five BidPro handoffs read
 * `unknown`: the right render for absence, and useless, because the answer was
 * one branch away. Pavan, 2026-09-08: "fetch staging too because i need to know
 * where progress is frequently."
 *
 * Deliberately a SHORT list of integration branches, not "every remote branch".
 * A literal sitting on somebody's abandoned feature branch is not landed, and
 * reporting it as merged would be worse than reporting nothing — the board's
 * whole contract is that green means something. Which ref matched is recorded
 * and shown, so `merged` on `staging` is never silently read as `merged` on
 * `main`.
 */
const INTEGRATION_REFS = ['staging']

/** Default branch first, then any integration branch this clone can actually see. */
const landedRefsCache = new Map<string, string[]>()
async function landedRefs(repo: string): Promise<string[]> {
  const hit = landedRefsCache.get(repo)
  if (hit) return hit
  const out = [await originRef(repo)]
  for (const name of INTEGRATION_REFS) {
    const ref = `origin/${name}`
    if (out.includes(ref)) continue
    // A single-branch clone cannot see it; scripts/mini/widen-clones.sh fixes
    // that on the mini, and until it runs the ref simply is not searched.
    if ((await git(repo, ['rev-parse', '--verify', '-q', ref])).trim()) out.push(ref)
  }
  landedRefsCache.set(repo, out)
  return out
}

const fetched = new Set<string>()
async function fetchOnce(repo: string): Promise<boolean> {
  if (fetched.has(repo)) return true
  // --prune keeps deleted remote branches from resolving; 5 min for Nexus.
  await runCommandArgs('git', ['-C', repo, 'fetch', '-q', '--prune', 'origin'], 300_000)
  // runCommandArgs returns '' on failure AND on quiet success, so probe the ref.
  const ok = Boolean((await git(repo, ['rev-parse', '--verify', '-q', await originRef(repo)])).trim())
  if (ok) fetched.add(repo)
  return ok
}

/** Resolve, fetch and ref in one step — `null` when the repo is unusable here. */
async function openRepo(name: string): Promise<{ dir: string; ref: string } | { error: string }> {
  const dir = await resolveRepo(name)
  if (!dir) return { error: `${name} ${NOT_CLONED}` }
  if (!await fetchOnce(dir)) return { error: `${name} could not fetch origin` }
  return { dir, ref: await originRef(dir) }
}

/** Field separator for git --format: a byte no commit subject or name contains. */
const SEP = '\x1f'

interface HumanCommit { at: string; author: string; subject: string; sha: string }

function parseCommits(out: string): HumanCommit[] {
  const rows: HumanCommit[] = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const [sha, at, author, subject = ''] = line.split(SEP)
    if (!sha || !at || !author) continue
    if (BOT_AUTHORS.has(author) || BOT_SUBJECTS.test(subject)) continue
    rows.push({ sha, at, author: canonAuthor(author), subject })
  }
  return rows
}

/**
 * The last commit on `ref` touching `paths` that a person actually made.
 *
 * Scans a window rather than asking git to filter: the exclusion is by author
 * AND subject, and `--invert-grep` cannot express both cleanly. 300 is far
 * beyond any real bot run on these paths.
 */
async function lastHumanCommit(repo: string, ref: string, paths: string[]): Promise<HumanCommit | null> {
  const out = await git(repo, [
    'log', '-n', '300', '--no-merges', `--format=%H${SEP}%aI${SEP}%an${SEP}%s`, ref, '--', ...paths,
  ])
  return parseCommits(out)[0] ?? null
}

/** Human commit SHAs on `ref` in the last `window` days, optionally path-scoped. */
async function humanCommitShas(
  repo: string, ref: string, window: number, paths: string[] = []
): Promise<Set<string>> {
  const args = [
    'log', '--no-merges', `--since=${window} days ago`, `--format=%H${SEP}%aI${SEP}%an${SEP}%s`, ref,
  ]
  if (paths.length) args.push('--', ...paths)
  const out = await git(repo, args, 180_000)
  return new Set(parseCommits(out).map(c => c.sha))
}

/**
 * Does `needle` appear anywhere in the tree at `ref`? Returns the file count.
 *
 * Not `runCommandArgs`: `git grep` exits 1 for "no matches", which that helper
 * treats as a failed command and logs. Here a zero count is the single most
 * important answer the check can give — it is what proves contract-management's
 * endpoint is unconsumed — so it must return quietly, not as an error. Any
 * exit code above 1 is a real failure and still throws.
 */
async function grepAtRef(repo: string, ref: string, needle: string, sub?: string): Promise<number> {
  const args = ['-C', repo, 'grep', '-l', '--fixed-strings', needle, ref]
  if (sub) args.push('--', sub)
  return new Promise((resolve, reject) => {
    execFile('git', args, { timeout: 120_000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      const code = (err as { code?: number } | null)?.code
      if (err && code !== 1) return reject(err)
      resolve(stdout.split('\n').filter(Boolean).length)
    })
  })
}

/** When did `needle` first land on `ref`? Pickaxe over the whole history. */
async function whenLanded(repo: string, ref: string, needle: string): Promise<string | null> {
  const out = await git(repo, ['log', '--reverse', '--format=%aI', '-S', needle, ref], 180_000)
  return out.split('\n').filter(Boolean)[0]?.trim() ?? null
}

/** One file's contents at `ref` — for reading a flag default without checkout. */
async function showAtRef(repo: string, ref: string, file: string): Promise<string | null> {
  const out = await git(repo, ['show', `${ref}:${file}`], 60_000)
  return out.trim() ? out : null
}

async function pathCount(repo: string, ref: string, paths: string[]): Promise<number> {
  if (!paths.length) return 0
  const out = await git(repo, ['ls-tree', '-r', '--name-only', ref, '--', ...paths])
  return out.split('\n').filter(Boolean).length
}

/**
 * Git, as the proof engine needs it — the real implementation of the seam that
 * makes the nine checks testable. Everything reads `origin` after a fetch.
 */
const GIT: GitOps = {
  open: openRepo,
  pathCount,
  grep: grepAtRef,
  show: showAtRef,
}

// ── per-milestone checks ────────────────────────────────────────────────────

interface Checked {
  slug: string
  evidence_age_days?: number | null
  last_evidence_at?: string | null
  last_evidence_author?: string | null
  handoff_state?: HandoffState
  handoff_age_days?: number | null
  handoff_at?: string | null
  /** The ref the literal was found at — `origin/main` or an integration branch. */
  handoff_ref?: string | null
  proof_true?: number
  proof_total?: number
  proof_results?: ProofResult[]
  proven_true?: number
  proven_total?: number
  error?: string
}

type Milestone = Awaited<ReturnType<typeof readAuthored>>['milestones'][number]

async function checkBuild(a: Milestone): Promise<Checked> {
  if (a.evidence.length === 0) return { slug: a.slug, error: 'No evidence path declared' }

  const byRepo = new Map<string, string[]>()
  for (const e of a.evidence) byRepo.set(e.repo, [...(byRepo.get(e.repo) ?? []), e.path])

  let newest: HumanCommit | null = null
  const errors: string[] = []
  for (const [repoName, paths] of byRepo) {
    const r = await openRepo(repoName)
    if ('error' in r) { errors.push(r.error); continue }
    // A path that matches nothing at the ref is a stale evidence pointer, which
    // is a defect in the roadmap file — not a milestone with no activity.
    if (await pathCount(r.dir, r.ref, paths) === 0) {
      errors.push(`${repoName}: evidence path matches nothing at ${r.ref}`)
      continue
    }
    const c = await lastHumanCommit(r.dir, r.ref, paths)
    if (c && (!newest || c.at > newest.at)) newest = c
  }

  if (!newest) {
    return { slug: a.slug, error: errors.join('; ') || 'No human commit found in the last 300 commits' }
  }
  return {
    slug: a.slug,
    evidence_age_days: days(newest.at),
    last_evidence_at: newest.at,
    last_evidence_author: newest.author,
  }
}

/**
 * Handoff state, mechanically. `landed` must be a literal string that appears
 * in their code (a route, an export), not prose — this is the verify-claims
 * mechanic: a claim that cites evidence can be checked.
 */
async function checkHandoff(a: Milestone, rowRepos: string[]): Promise<Checked> {
  const { spec, landed, consumedBy, pr } = a.handoff ?? {}
  const repoName = rowRepos[0]
  if (!repoName) return { slug: a.slug, error: 'No repo declared on the row' }

  if (landed) {
    // Consumed? Ask OUR repo whether it actually references what they shipped.
    if (consumedBy) {
      const cc = await openRepo('command-center')
      if (!('error' in cc) && await grepAtRef(cc.dir, cc.ref, landed, consumedBy) > 0) {
        return { slug: a.slug, handoff_state: 'consumed' }
      }
    }
    const r = await openRepo(repoName)
    if ('error' in r) return { slug: a.slug, error: r.error }
    const refs = await landedRefs(r.dir)
    for (const ref of refs) {
      if (await grepAtRef(r.dir, ref, landed) === 0) continue
      const at = await whenLanded(r.dir, ref, landed)
      return {
        slug: a.slug,
        handoff_state: 'merged',
        handoff_age_days: at ? days(at) : null,
        handoff_at: at,
        handoff_ref: ref,
      }
    }
    // Not found — say WHERE we looked, because "not resolved" is a mystery and
    // this is a fact. It matters here: the mini's qual_table_automations clone
    // is single-branch (`+refs/heads/main:refs/remotes/origin/main`), so the
    // five BidPro handoffs are checked against `main` while that team works on
    // `staging`. The board must not imply the work is missing when the truth is
    // that this machine cannot see the branch it is on.
    if (!pr && !spec) {
      const specs = (await git(r.dir, ['config', '--get-all', 'remote.origin.fetch']))
        .split('\n').filter(Boolean)
      // An ABSENT refspec is git's default, which is every branch — only an
      // explicit single-branch spec is narrow.
      const narrow = specs.length > 0 && !specs.some(x => x.includes('/*'))
      return {
        slug: a.slug,
        error: `"${landed}" not found at ${refs.join(' or ')} in ${repoName}` +
          (narrow ? ' — and this clone is single-branch, so no other branch was searched' : ''),
      }
    }
  }

  if (pr) return { slug: a.slug, handoff_state: 'pr-opened' }

  if (spec) {
    const abs = path.join(PATHS.operationsRoot, spec.replace(/^operations\//, ''))
    if (await exists(abs)) {
      const at = (await git(PATHS.operationsRoot, [
        'log', '-1', '--format=%aI', 'HEAD', '--', path.relative(PATHS.operationsRoot, abs),
      ])).trim()
      return { slug: a.slug, handoff_state: 'spec-sent', handoff_age_days: at ? days(at) : null, handoff_at: at || null }
    }
    return { slug: a.slug, error: `Spec ${spec} not found` }
  }

  return { slug: a.slug, handoff_state: 'unknown' }
}

async function checkProof(a: Milestone, ctx: ProofContext): Promise<Checked> {
  // `proof: manual` parses to null — nothing to evaluate, and that is the
  // answer: needs-a-person. Zero of zero, never a pass.
  if (a.proof === null) return { slug: a.slug, proof_true: 0, proof_total: 0, proof_results: [] }

  const results: ProofResult[] = []
  for (const c of a.proof) results.push(await evalCheck(c, ctx))

  const proven: ProofResult[] = []
  for (const c of a.proven) proven.push(await evalCheck(c, ctx))

  return {
    slug: a.slug,
    proof_true: results.filter(r => r.ok).length,
    proof_total: results.length,
    proof_results: results,
    ...(proven.length ? { proven_true: proven.filter(r => r.ok).length, proven_total: proven.length } : {}),
  }
}

// ── per-row derivation ──────────────────────────────────────────────────────

/**
 * Investment: human commits on the row's evidence paths, per window.
 *
 * A `platform` row is the COMPLEMENT — every human commit in its repos that did
 * NOT touch any product row's paths. Without that, the ~300 platform commits a
 * quarter are invisible and every product row reads inflated by sweeps that
 * merely passed through its files.
 */
async function rowInvestment(
  row: RoadmapRow, productPaths: Map<string, string[]>
): Promise<{ investment: Record<number, number>; errors: string[] }> {
  const investment: Record<number, number> = {}
  const errors: string[] = []

  const byRepo = new Map<string, string[]>()
  for (const e of row.evidence) byRepo.set(e.repo, [...(byRepo.get(e.repo) ?? []), e.path])

  for (const w of INVESTMENT_WINDOWS) {
    let total = 0
    for (const [repoName, paths] of byRepo) {
      const r = await openRepo(repoName)
      if ('error' in r) { if (w === INVESTMENT_WINDOWS[0]) errors.push(r.error); continue }
      if (row.kind === 'platform') {
        const all = await humanCommitShas(r.dir, r.ref, w)
        const product = await humanCommitShas(r.dir, r.ref, w, productPaths.get(repoName) ?? [])
        for (const sha of product) all.delete(sha)
        total += all.size
      } else {
        total += (await humanCommitShas(r.dir, r.ref, w, paths)).size
      }
    }
    investment[w] = total
  }
  return { investment, errors }
}

/**
 * Pull: is anyone asking for this?
 *
 * `byStage` is the honest inventory — every contact who WANTS the row's product,
 * bucketed. The SCORE counts only human-worked contacts, because a stage set by
 * lead-sync is an import, not interest, and `identified` is weighted zero
 * because 95 of 104 contacts sit there. Meetings are the strongest signal in
 * the set and are worth two stage-points each.
 *
 * "Wants" is `wantsProduct`, not `product ===`: one contact can ask for several
 * products, so these row totals deliberately do NOT partition the book. A person
 * asking for three things is demand for three rows, and counting them once would
 * be the bug this replaced.
 */
function rowPull(row: RoadmapRow, contacts: Contact[], meetings: Meeting[], now: Date): RowPull {
  const empty: RowPull = { byStage: {}, total: 0, warm: 0, meetings90: 0, score: 0 }
  if (!row.product) return empty

  const mine = contacts.filter(c => wantsProduct(c, row.product!))
  const byStage: Record<string, number> = {}
  for (const c of mine) byStage[c.stage] = (byStage[c.stage] ?? 0) + 1

  const worked = mine.filter(c => c.worked)
  const workedByStage: Record<string, number> = {}
  for (const c of worked) workedByStage[c.stage] = (workedByStage[c.stage] ?? 0) + 1

  const cutoff = localDaysAgo(90, now)
  const slugs = new Set(mine.map(c => c.slug))
  const meetings90 = meetings.filter(m =>
    m.category === 'agency' && m.date >= cutoff && m.contacts.some(s => slugs.has(s))).length

  return {
    byStage,
    total: mine.length,
    warm: worked.filter(c => stageAtLeast(c.stage, 'contacted')).length,
    meetings90,
    score: pullScore(workedByStage, meetings90),
  }
}

// ── emit ────────────────────────────────────────────────────────────────────

const STATE_MARK: Record<string, string> = {
  slipped: '🔴', stranded: '🔴', 'at-risk': '🟠', unknown: '⚪',
  idle: '🟡', 'no-target': '🟡', 'needs-person': '🔵',
  'on-track': '🟢', active: '🟢', done: '✅',
}
const STAGE_DOTS = (stage: string) => {
  const order = ['framed', 'committed', 'building', 'shipped', 'proven']
  const i = order.indexOf(stage)
  return '●'.repeat(i + 1) + '○'.repeat(Math.max(0, 4 - i))
}

/** One line per run, outside git — the page reads the last `ok` for freshness. */
async function logRun(line: string): Promise<void> {
  if (DRY) return
  try {
    await fs.mkdir(path.dirname(PATHS.roadmapCheckLog), { recursive: true })
    await fs.appendFile(PATHS.roadmapCheckLog, `${new Date().toISOString()} ${line}\n`)
  } catch { /* a logging failure must not fail a check */ }
}

const yaml = (v: unknown) => JSON.stringify(v)

async function main() {
  const now = new Date()
  const { rows, milestones } = await readAuthored()
  if (rows.length === 0 || milestones.length === 0) {
    console.error(`No roadmap rows/milestones in ${PATHS.roadmap}`)
    process.exit(1)
  }

  // ── lint first: a board with a dangling unlocks ranks the wrong work ──
  const warnings: string[] = []
  const lint = lintRoadmap(rows, milestones)

  const contacts = await readContacts(PATHS.operationsRoot, s => warnings.push(s))
  const meetings = await readMeetings(PATHS.operationsRoot)
  const ctx: ProofContext = { contacts, meetings, root: PATHS.operationsRoot, git: GIT }

  const rowBySlug = new Map(rows.map(r => [r.slug, r]))

  const checked: Checked[] = []
  for (const m of milestones) {
    if (m.kind === 'handoff') {
      checked.push(await checkHandoff(m, rowBySlug.get(m.row)?.repos ?? []))
    } else if (m.kind === 'demand' || m.kind === 'decision') {
      checked.push(await checkProof(m, ctx))
    } else {
      checked.push(await checkBuild(m))
    }
  }
  const bySlug = new Map(checked.map(c => [c.slug, c]))

  // Every product row's paths, per repo — the platform row subtracts these.
  const productPaths = new Map<string, string[]>()
  for (const r of rows) {
    if (r.kind !== 'product') continue
    for (const e of r.evidence) {
      productPaths.set(e.repo, [...(productPaths.get(e.repo) ?? []), e.path])
    }
  }

  const rowErrors: string[] = []
  for (const r of rows) {
    const { investment, errors } = await rowInvestment(r, productPaths)
    r.investment = investment
    r.pull = rowPull(r, contacts, meetings, now)
    rowErrors.push(...errors)
  }

  // ── join: exactly what the page will compute, computed once here ──
  const full: RoadmapMilestone[] = milestones.map(m => {
    const d = bySlug.get(m.slug)!
    const derived: DerivedEntry = {
      slug: m.slug,
      evidenceAgeDays: d.evidence_age_days,
      lastEvidenceAt: d.last_evidence_at,
      handoffState: d.handoff_state,
      handoffRef: d.handoff_ref ?? undefined,
      handoffAgeDays: d.handoff_age_days,
      proofTrue: d.proof_true,
      proofTotal: d.proof_total,
      provenTrue: d.proven_true,
      provenTotal: d.proven_total,
      error: d.error,
    }
    const { state, reason, daysToTarget } = deriveState(m, derived, true, now)
    // `derived` carries nulls (the on-disk shape distinguishes "checked, nothing
    // found" from "not checked"); the rendered milestone carries undefined.
    return {
      ...m,
      daysToTarget,
      evidenceAgeDays: derived.evidenceAgeDays ?? undefined,
      lastEvidenceAt: derived.lastEvidenceAt ?? undefined,
      handoffState: derived.handoffState,
      handoffAgeDays: derived.handoffAgeDays ?? undefined,
      proofTrue: derived.proofTrue ?? undefined,
      proofTotal: derived.proofTotal ?? undefined,
      proofResults: d.proof_results,
      provenTrue: derived.provenTrue ?? undefined,
      provenTotal: derived.provenTotal ?? undefined,
      state,
      stage: deriveStage(m, derived, now),
      reason,
    }
  })

  for (const r of rows) r.milestones = full.filter(m => m.row === r.slug)
  const ranking = rankBuildNext(rows, now, 10)
  // Same scoring, applied per row — Build next is a global top ten, so most
  // rows have nothing in it and need a local answer.
  const nextByRow = topOpenByRow(rows, now)

  const order = ['slipped', 'stranded', 'at-risk', 'unknown', 'idle', 'no-target', 'needs-person', 'on-track', 'active', 'done']
  const sorted = [...full].sort((x, y) =>
    order.indexOf(x.state) - order.indexOf(y.state) ||
    (x.target ?? '9999').localeCompare(y.target ?? '9999') ||
    x.name.localeCompare(y.name)
  )

  // What counts as a change: a fact, not a day. The page recomputes ages from
  // the stored timestamps, so this file only needs rewriting when a human
  // commit landed, a handoff moved, a proof flipped, a repo stopped resolving,
  // a target was edited, or a state crossed a threshold. Without this, a daily
  // cron commits every day as every age ticks.
  const fingerprint = crypto.createHash('sha1').update(JSON.stringify(
    [...full].sort((x, y) => x.slug.localeCompare(y.slug)).map(m => {
      const d = bySlug.get(m.slug)!
      return [
        m.slug, m.target ?? null, m.done ?? null, m.state, m.stage,
        d.last_evidence_at ?? null, d.handoff_state ?? null, d.handoff_at ?? null,
        d.handoff_ref ?? null,
        d.proof_true ?? null, d.proof_total ?? null, d.error ?? null,
      ]
    }).concat(
      rows.map(r => [
        r.slug, JSON.stringify(r.investment ?? {}), JSON.stringify(r.pull ?? {}),
        nextByRow[r.slug] ?? null,
      ]) as never[]
    ).concat([lint as never])
  )).digest('hex').slice(0, 12)

  const fm = [
    '---',
    `generated_at: '${now.toISOString()}'`,
    `fingerprint: ${fingerprint}`,
    ...(lint.length ? ['lint:', ...lint.map(e => `  - ${yaml(e)}`)] : ['lint: []']),
    'rows:',
    ...rows.flatMap(r => [
      `  - slug: ${r.slug}`,
      ...(nextByRow[r.slug] ? [`    next_milestone: ${nextByRow[r.slug]}`] : []),
      '    investment:',
      ...INVESTMENT_WINDOWS.map(w => `      d${w}: ${r.investment?.[w] ?? 0}`),
      '    pull:',
      `      total: ${r.pull?.total ?? 0}`,
      `      warm: ${r.pull?.warm ?? 0}`,
      `      meetings_90: ${r.pull?.meetings90 ?? 0}`,
      `      score: ${r.pull?.score ?? 0}`,
      ...(Object.keys(r.pull?.byStage ?? {}).length
        ? ['      by_stage:', ...Object.entries(r.pull!.byStage).map(([k, v]) => `        ${k}: ${v}`)]
        : ['      by_stage: {}']),
    ]),
    'ranking:',
    ...ranking.flatMap(x => [
      `  - slug: ${x.slug}`,
      `    name: ${yaml(x.name)}`,
      `    row: ${x.row}`,
      `    score: ${x.score.toFixed(3)}`,
      `    reason: ${yaml(x.reason)}`,
    ]),
    'checked:',
    ...checked.flatMap(c => [
      `  - slug: ${c.slug}`,
      ...(c.evidence_age_days != null ? [`    evidence_age_days: ${c.evidence_age_days}`] : []),
      ...(c.last_evidence_at ? [`    last_evidence_at: '${c.last_evidence_at}'`] : []),
      ...(c.last_evidence_author ? [`    last_evidence_author: ${yaml(c.last_evidence_author)}`] : []),
      ...(c.handoff_state ? [`    handoff_state: ${c.handoff_state}`] : []),
      ...(c.handoff_age_days != null ? [`    handoff_age_days: ${c.handoff_age_days}`] : []),
      ...(c.handoff_at ? [`    handoff_at: '${c.handoff_at}'`] : []),
      ...(c.handoff_ref ? [`    handoff_ref: ${c.handoff_ref}`] : []),
      ...(c.proof_total != null ? [`    proof_true: ${c.proof_true}`, `    proof_total: ${c.proof_total}`] : []),
      ...(c.proven_total != null ? [`    proven_true: ${c.proven_true}`, `    proven_total: ${c.proven_total}`] : []),
      ...(c.proof_results?.length
        ? ['    proof_results:', ...c.proof_results.flatMap(r => [
            `      - check: ${r.check}`,
            `        ok: ${r.ok}`,
            `        detail: ${yaml(r.detail)}`,
          ])]
        : []),
      ...(c.error ? [`    error: ${yaml(c.error)}`] : []),
    ]),
    '---',
  ].join('\n')

  const body = [
    '',
    '# Roadmap status — DERIVED. DO NOT HAND-EDIT.',
    '',
    '<!-- Generated by command-center scripts/roadmap-check.ts, daily on the mini.',
    '     Authored rows (north star, investment paths) and milestones (definition of',
    '     done, proof) live beside this file; they are never written here. -->',
    '',
    ...(lint.length ? [
      `## ⛔ Lint — ${lint.length} error${lint.length === 1 ? '' : 's'}`, '',
      ...lint.map(e => `- ${e}`), '',
    ] : []),
    ...(warnings.length ? ['## Warnings', '', ...warnings.map(w => `- ${w}`), ''] : []),
    '## Build next',
    '',
    '| # | milestone | row | score | why |',
    '|---:|---|---|---:|---|',
    ...ranking.map((x, i) => `| ${i + 1} | **${x.name}** | ${x.row} | ${x.score.toFixed(2)} | ${x.reason} |`),
    '',
    '## Rows',
    '',
    '| row | group | investment 30d / 90d | contacts | warm | meetings 90d | pull |',
    '|---|---|---:|---:|---:|---:|---:|',
    ...rows.map(r =>
      `| **${r.name}** | ${r.group} | ${r.investment?.[30] ?? 0} / ${r.investment?.[90] ?? 0} | ` +
      `${r.pull?.total ?? 0} | ${r.pull?.warm ?? 0} | ${r.pull?.meetings90 ?? 0} | ${r.pull?.score ?? 0} |`
    ),
    '',
    '## Milestones',
    '',
    '| | milestone | row | kind | horizon | stage | target | state | why |',
    '|---|---|---|---|---|---|---|---|---|',
    ...sorted.map(m =>
      `| ${STATE_MARK[m.state] ?? '⚪'} | **${m.name}** | ${m.row} | ${m.kind} | ${m.horizon} | ` +
      `\`${STAGE_DOTS(m.stage)}\` ${m.stage} | ${m.target ?? '—'} | ${m.state} | ${m.reason} |`
    ),
    '',
    `_${rows.length} rows, ${sorted.length} milestones. Evidence age and investment count only`,
    'human commits on `origin` — bot and janitor commits are excluded, because a path a',
    'machine writes to is green forever and tells you nothing. Demand counts only contacts',
    'with a human `via` log line, for the same reason: `crm/` is machine-written._',
    '',
  ].join('\n')

  const next = `${fm}\n${body}`
  const prev = await fs.readFile(PATHS.roadmapStatus, 'utf-8').catch(() => '')

  /**
   * A machine that cannot see every repo must not publish a board.
   *
   * `_status.md` is one file written by two machines. The mini holds all the
   * clones; the MacBook is missing contract-management and both websites, so a
   * run there resolves them to `unknown` and — via the janitor's `git add -A` —
   * quietly replaces the mini's correct board with a degraded one. That already
   * happened once on 2026-09-08 during development.
   *
   * A partial board is worse than a stale board: it renders as current health.
   * So refuse, name the repos, and leave what is there alone. `--dry` still
   * prints, which is all a developer on the wrong machine actually needs.
   */
  const missingRepos = new Set<string>()
  for (const c of checked) {
    if (c.error?.includes(NOT_CLONED)) missingRepos.add(c.error)
    for (const r of c.proof_results ?? []) if (r.detail.includes(NOT_CLONED)) missingRepos.add(r.detail)
  }
  for (const e of rowErrors) if (e.includes(NOT_CLONED)) missingRepos.add(e)

  if (missingRepos.size > 0 && !DRY) {
    console.error(
      `roadmap-check: refusing to write — ${missingRepos.size} referenced repo(s) ` +
      `are not on this machine:`
    )
    for (const m of missingRepos) console.error(`  ${m}`)
    console.error('Run this on the mini, which holds every clone. (--dry prints anyway.)')
    await logRun(`refused missing=${missingRepos.size}`)
    process.exit(2)
  }

  // The lint is not advisory. A dangling `unlocks:` silently demotes real work
  // in the ranking, so a board that fails it must not be published.
  if (lint.length > 0 && !DRY) {
    console.error(`roadmap-check: refusing to write — ${lint.length} lint error(s):`)
    for (const e of lint) console.error(`  ${e}`)
    await logRun(`refused lint=${lint.length}`)
    process.exit(3)
  }

  // A file without a fingerprint is the pre-fingerprint format: rewrite once.
  const prevFingerprint = /^fingerprint: (\w+)$/m.exec(prev)?.[1]
  if (prevFingerprint === fingerprint) {
    console.log('roadmap-check: no change')
    await logRun('ok unchanged')
    return
  }

  if (DRY) {
    console.log(next)
    if (lint.length) console.error(`\n⛔ ${lint.length} lint error(s) — a real run would refuse to write.`)
    if (missingRepos.size) console.error(`\n(${missingRepos.size} repo(s) missing here; a real run would exit 2.)`)
    return
  }

  await fs.mkdir(PATHS.roadmap, { recursive: true })
  await fs.writeFile(PATHS.roadmapStatus, next, 'utf-8')
  await logRun(`ok changed rows=${rows.length} milestones=${sorted.length}`)
  console.log(`roadmap-check: wrote ${rows.length} rows, ${sorted.length} milestones`)
  console.log('\nBuild next:')
  ranking.forEach((x, i) => console.log(`  ${i + 1}. ${x.name} — ${x.reason}`))
  for (const w of warnings) console.warn(`  warn: ${w}`)
}

await main().catch(async (e: unknown) => {
  await logRun(`fail ${String(e).replace(/\s+/g, ' ').slice(0, 160)}`)
  console.error(e)
  process.exit(1)
})
