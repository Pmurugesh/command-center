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
  type RoadmapMilestone, type RowPull, type DerivedEntry, type RankedMilestone,
} from '../src/lib/roadmap.ts'
import { getMeetingsInWindow } from '../src/lib/calendar.ts'
import { stageAtLeast, wantsProduct } from '../src/lib/config.ts'
import {
  evalCheck, evalHandoff, readContacts, readMeetings,
  type Contact, type Meeting, type ProofContext, type GitOps, type HandoffOps,
} from '../src/lib/roadmap-proof.ts'

const DRY = process.argv.includes('--dry')
/**
 * `--quiet` is the watcher's mode (Phase 14): recompute the board, write the
 * file, log the run — and say nothing on stdout, so nothing is announced and
 * the "last announced top objective" is not advanced. The 08:00 cron and the
 * Rescore button run without it and speak: one message a morning, plus one
 * whenever a person asks. Pavan, 2026-09-09: "maybe I don't need constant
 * monitoring" — right: the BOARD should be constant, the MESSAGES should not.
 */
const QUIET = process.argv.includes('--quiet')
const ANNOUNCED_TOP = path.join(PATHS.roadmapCheckLog, '..', '..', 'state', 'roadmap-announced-top.json')

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
  // LIST the remote branches and intersect, rather than probing each one with
  // `rev-parse --verify`. Probing works — runCommandArgs swallows the non-zero
  // exit — but it logs `Command failed: git … origin/staging` for every repo
  // that simply has no staging branch, which is most of them. A cron log that
  // cries wolf on every run is a log nobody reads when something real breaks.
  const remote = new Set(
    (await git(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin']))
      .split('\n').map(x => x.trim()).filter(Boolean))
  for (const name of INTEGRATION_REFS) {
    const ref = `origin/${name}`
    // A single-branch clone cannot see it; scripts/mini/widen-clones.sh fixes
    // that on the mini, and until it runs the ref simply is not searched.
    if (!out.includes(ref) && remote.has(ref)) out.push(ref)
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

interface HumanCommit { at: string; author: string; subject: string; sha: string; ref?: string }

/**
 * Every branch on origin except the `HEAD` symref (which would name the same
 * commits twice under a different ref). Phase 14: the evidence scan reads all
 * of them, so a push to `claude/x` or `staging` is movement the moment it is
 * pushed. Nothing here decides "landed" — that stays with `landedRefs`.
 */
const ALL_ORIGIN = ['--exclude=refs/remotes/origin/HEAD', '--remotes=origin']

function parseCommits(out: string, withRef = false): HumanCommit[] {
  const rows: HumanCommit[] = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const parts = line.split(SEP)
    const [sha, at, author] = parts
    const ref = withRef ? parts[3] : undefined
    const subject = (withRef ? parts[4] : parts[3]) ?? ''
    if (!sha || !at || !author) continue
    if (BOT_AUTHORS.has(author) || BOT_SUBJECTS.test(subject)) continue
    rows.push({
      sha, at, author: canonAuthor(author), subject,
      ...(ref ? { ref: ref.replace(/^refs\/remotes\//, '') } : {}),
    })
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
/**
 * Has `sha` landed on `ref`? `%S` names the ref git happened to reach a commit
 * from first, so a commit on main that is ALSO on the branch it came from can
 * be reported as "on claude/x". Proved on the mini 2026-09-09: PR #47's commits
 * read as on their branch an hour after merging. Reachability is the fact.
 */
function isAncestor(repo: string, sha: string, ref: string): Promise<boolean> {
  return new Promise(resolve => {
    execFile('git', ['-C', repo, 'merge-base', '--is-ancestor', sha, ref], { timeout: 60_000 }, err => resolve(!err))
  })
}

async function lastHumanCommit(repo: string, paths: string[]): Promise<HumanCommit | null> {
  // `--source` fills %S with the ref each commit was reached from, so the
  // board can say "on claude/x" — a branch is movement, never a landing.
  const out = await git(repo, [
    'log', '-n', '300', '--no-merges', '--source', `--format=%H${SEP}%aI${SEP}%an${SEP}%S${SEP}%s`,
    ...ALL_ORIGIN, '--', ...paths,
  ])
  return parseCommits(out, true)[0] ?? null
}

/** Human commit SHAs on `ref` in the last `window` days, optionally path-scoped. */
async function humanCommitShas(
  repo: string, window: number, paths: string[] = []
): Promise<Set<string>> {
  // A Set of SHAs: a commit reachable from three branches is one commit.
  const args = [
    'log', '--no-merges', `--since=${window} days ago`, `--format=%H${SEP}%aI${SEP}%an${SEP}%s`, ...ALL_ORIGIN,
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
/** Files containing `needle` at `ref`, filtered by git pathspecs (`:!…` excludes). */
async function grepFilesAtRef(repo: string, ref: string, needle: string, pathspec: string[] = []): Promise<string[]> {
  const args = ['-C', repo, 'grep', '-l', '--fixed-strings', needle, ref]
  if (pathspec.length) args.push('--', ...pathspec)
  return new Promise((resolve, reject) => {
    execFile('git', args, { timeout: 120_000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      const code = (err as { code?: number } | null)?.code
      if (err && code !== 1) return reject(err)
      // `git grep <ref>` prefixes every path with `<ref>:`; strip it so the
      // path can be recorded and read as a path.
      resolve(stdout.split('\n').filter(Boolean)
        .map(l => l.startsWith(`${ref}:`) ? l.slice(ref.length + 1) : l))
    })
  })
}

/** The count form the nine proof checks use — `sub` is one pathspec. */
const grepAtRef = async (repo: string, ref: string, needle: string, sub?: string) =>
  (await grepFilesAtRef(repo, ref, needle, sub ? [sub] : [])).length

/** When did `needle` first land on `ref` within `pathspec`? Pickaxe over the whole history. */
async function whenLanded(repo: string, ref: string, needle: string, pathspec: string[] = []): Promise<string | null> {
  const args = ['log', '--reverse', '--format=%aI', '-S', needle, ref]
  if (pathspec.length) args.push('--', ...pathspec)
  const out = await git(repo, args, 180_000)
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
/**
 * Proofs read the landed refs — main first, then `staging` where it exists —
 * the same refs a handoff literal is searched at. Found 2026-09-09 drafting
 * BidPro's build milestones: their team integrates on staging and releases to
 * main in batches (29 commits behind that day), so a proof read at main alone
 * would flip weeks after the work was done. A branch is still never a landing.
 */
async function openForProof(name: string): Promise<{ dir: string; ref: string; refs: string[] } | { error: string }> {
  const r = await openRepo(name)
  if ('error' in r) return r
  return { ...r, refs: await landedRefs(r.dir) }
}

const GIT: GitOps = {
  open: openForProof,
  pathCount,
  grep: grepAtRef,
  show: showAtRef,
}

/** The handoff seam's real implementation. Every git-specific decision — which
 *  refs count, what "narrow" means, where a spec lives — is HERE, so
 *  `evalHandoff` holds only the logic and a fake can drive all of it. */
const HANDOFF: HandoffOps = {
  async open(name) {
    const r = await openRepo(name)
    if ('error' in r) return r
    const specs = (await git(r.dir, ['config', '--get-all', 'remote.origin.fetch']))
      .split('\n').filter(Boolean)
    // An ABSENT refspec is git's default, which is every branch — only an
    // explicit single-branch spec is narrow.
    return {
      dir: r.dir,
      refs: await landedRefs(r.dir),
      narrow: specs.length > 0 && !specs.some(x => x.includes('/*')),
    }
  },
  grep: grepFilesAtRef,
  firstSeen: whenLanded,
  async specAt(relPath) {
    const abs = path.join(PATHS.operationsRoot, relPath.replace(/^operations\//, ''))
    if (!await exists(abs)) return null
    return (await git(PATHS.operationsRoot, [
      'log', '-1', '--format=%aI', 'HEAD', '--', path.relative(PATHS.operationsRoot, abs),
    ])).trim()
  },
}

// ── per-milestone checks ────────────────────────────────────────────────────

interface Checked {
  slug: string
  evidence_age_days?: number | null
  last_evidence_at?: string | null
  last_evidence_author?: string | null
  /** Only when the newest evidence commit is on a non-default branch. */
  last_evidence_ref?: string | null
  handoff_state?: HandoffState
  handoff_age_days?: number | null
  handoff_at?: string | null
  /** The ref the literal was found at — `origin/main` or an integration branch. */
  handoff_ref?: string | null
  /** The code file it was found in at that ref. */
  handoff_file?: string | null
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
  let newestDefaultRef = ''
  let newestDir = ''
  const errors: string[] = []
  for (const [repoName, paths] of byRepo) {
    const r = await openRepo(repoName)
    if ('error' in r) { errors.push(r.error); continue }
    const c = await lastHumanCommit(r.dir, paths)
    if (!c) {
      // A path that matches nothing at the default ref AND has no commit on any
      // branch is a stale evidence pointer — a defect in the roadmap file, not
      // a milestone with no activity. A path that exists only on a branch is
      // simply new work, and the commit above already found it.
      errors.push(await pathCount(r.dir, r.ref, paths) === 0
        ? `${repoName}: evidence path matches nothing at ${r.ref} or any branch`
        : `${repoName}: no human commit on the evidence path in the last 300`)
      continue
    }
    if (!newest || c.at > newest.at) { newest = c; newestDefaultRef = r.ref; newestDir = r.dir }
  }

  if (!newest) {
    return { slug: a.slug, error: errors.join('; ') || 'No human commit found in the last 300 commits' }
  }
  // Landed on the default branch → no ref, whatever %S said. On an integration
  // branch (staging) → name THAT, not the feature branch it came in on: "on
  // origin/staging" tells Pavan it is merged and unreleased, which is the fact
  // he acts on. Otherwise the ref git reached it from is a branch it is on.
  let ref: string | undefined
  for (const candidate of await landedRefs(newestDir)) {
    if (await isAncestor(newestDir, newest.sha, candidate)) { ref = candidate; break }
  }
  const onBranch = ref === undefined
    ? (newest.ref && newest.ref !== 'origin/HEAD' && newest.ref !== newestDefaultRef ? newest.ref : undefined)
    : (ref === newestDefaultRef ? undefined : ref)
  return {
    slug: a.slug,
    evidence_age_days: days(newest.at),
    last_evidence_at: newest.at,
    last_evidence_author: newest.author,
    ...(onBranch ? { last_evidence_ref: onBranch } : {}),
  }
}

/**
 * Handoff state — a thin adapter now. The logic lives in `evalHandoff` in
 * roadmap-proof.ts behind the `HandoffOps` seam, so it can be tested against a
 * fake instead of five real clones. Until 2026-09-08 it lived here, reached for
 * git directly, and had no tests at all.
 */
async function checkHandoff(a: Milestone, rowRepos: string[]): Promise<Checked> {
  const r = await evalHandoff(a.handoff ?? {}, rowRepos, HANDOFF)
  return {
    slug: a.slug,
    ...(r.state ? { handoff_state: r.state } : {}),
    ...(r.ageDays !== undefined ? { handoff_age_days: r.ageDays } : {}),
    ...(r.at !== undefined ? { handoff_at: r.at } : {}),
    ...(r.ref ? { handoff_ref: r.ref } : {}),
    ...(r.file ? { handoff_file: r.file } : {}),
    ...(r.error ? { error: r.error } : {}),
  }
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
        const all = await humanCommitShas(r.dir, w)
        const product = await humanCommitShas(r.dir, w, productPaths.get(repoName) ?? [])
        for (const sha of product) all.delete(sha)
        total += all.size
      } else {
        total += (await humanCommitShas(r.dir, w, paths)).size
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
/**
 * The delta is the message. The cron announces stdout to the team's Telegram,
 * and "the top objective moved" is the one line a person picking up work
 * needs — the table is for the board. Compared against the last ANNOUNCED top,
 * not the previous file: the watcher rewrites the file all day in `--quiet`
 * mode, and the morning message must still say what moved since yesterday.
 */
async function announceDelta(top: RankedMilestone | undefined): Promise<void> {
  if (QUIET || DRY || !top) return
  let last: { slug?: string; name?: string } = {}
  try { last = JSON.parse(await fs.readFile(ANNOUNCED_TOP, 'utf-8')) } catch { /* first announce */ }
  if (last.slug && last.slug !== top.slug) {
    console.log(`Build next moved: ${last.name ?? last.slug} → ${top.name} (${top.reason})`)
  } else {
    console.log(`Build next: ${top.name} (${top.reason})`)
  }
  await fs.mkdir(path.dirname(ANNOUNCED_TOP), { recursive: true })
  await fs.writeFile(ANNOUNCED_TOP, JSON.stringify({ slug: top.slug, name: top.name, at: new Date().toISOString() }), 'utf-8')
}

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

  // The calendar is fetched once, and only when a milestone asks for it — the
  // check must not grow a network dependency for boards that never use it.
  // −90/+180 days: a demo booked last quarter or next is inside the window.
  const declares = (m: Milestone, check: string) =>
    [...(m.proof ?? []), ...m.proven].some(c => c.check === check)
  if (milestones.some(m => declares(m, 'calendar_event'))) {
    const DAY = 86_400_000
    const cal = await getMeetingsInWindow(now.getTime() - 90 * DAY, now.getTime() + 180 * DAY)
    ctx.calendar = cal.meetings
    ctx.calendarErrors = cal.configured ? cal.errors : ['no calendar feeds configured']
    for (const e of ctx.calendarErrors) warnings.push(`calendar: ${e}`)
  }

  const rowBySlug = new Map(rows.map(r => [r.slug, r]))

  const checked: Checked[] = []
  for (const m of milestones) {
    let c: Checked
    if (m.kind === 'handoff') {
      c = await checkHandoff(m, rowBySlug.get(m.row)?.repos ?? [])
    } else if (m.kind === 'demand' || m.kind === 'decision') {
      c = await checkProof(m, ctx)
    } else {
      c = await checkBuild(m)
    }
    // Phase 14: build and handoff milestones may ALSO declare a proof. Activity
    // and landing are measured as before; the proof, when fully true, is what
    // lets `deriveState` say done without a typed date.
    if ((m.kind === 'build' || m.kind === 'handoff') && ((m.proof?.length ?? 0) > 0 || m.proven.length > 0)) {
      const p = await checkProof(m, ctx)
      c = {
        ...c,
        proof_true: p.proof_true, proof_total: p.proof_total, proof_results: p.proof_results,
        ...(p.proven_total != null ? { proven_true: p.proven_true, proven_total: p.proven_total } : {}),
      }
    }
    checked.push(c)
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
      lastEvidenceRef: d.last_evidence_ref ?? undefined,
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
      lastEvidenceRef: derived.lastEvidenceRef ?? undefined,
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
        d.last_evidence_at ?? null, d.last_evidence_ref ?? null, d.handoff_state ?? null, d.handoff_at ?? null,
        d.handoff_ref ?? null, d.handoff_file ?? null,
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
      ...(c.last_evidence_ref ? [`    last_evidence_ref: ${yaml(c.last_evidence_ref)}`] : []),
      ...(c.handoff_state ? [`    handoff_state: ${c.handoff_state}`] : []),
      ...(c.handoff_age_days != null ? [`    handoff_age_days: ${c.handoff_age_days}`] : []),
      ...(c.handoff_at ? [`    handoff_at: '${c.handoff_at}'`] : []),
      ...(c.handoff_ref ? [`    handoff_ref: ${c.handoff_ref}`] : []),
      ...(c.handoff_file ? [`    handoff_file: ${yaml(c.handoff_file)}`] : []),
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
    'human commits on ANY `origin/*` branch (proof and handoffs read main + staging only) — bot and janitor commits are excluded, because a path a',
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
    if (!QUIET) console.log('roadmap-check: no change')
    await announceDelta(ranking[0])
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
  await logRun(`ok changed rows=${rows.length} milestones=${sorted.length}${ranking[0] ? ` top=${ranking[0].slug}` : ''}`)
  if (!QUIET) console.log(`roadmap-check: wrote ${rows.length} rows, ${sorted.length} milestones`)
  await announceDelta(ranking[0])
  if (QUIET) return
  console.log('\nBuild next:')
  ranking.forEach((x, i) => console.log(`  ${i + 1}. ${x.name} — ${x.reason}`))
  for (const w of warnings) console.warn(`  warn: ${w}`)
}

await main().catch(async (e: unknown) => {
  await logRun(`fail ${String(e).replace(/\s+/g, ' ').slice(0, 160)}`)
  console.error(e)
  process.exit(1)
})
