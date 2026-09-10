/**
 * The proof engine — nine checks, and no tenth.
 *
 * Separate from `scripts/roadmap-check.ts` for one reason: the script is an
 * orchestrator that talks to git and the filesystem, and a check nobody can
 * test in isolation is a check nobody should trust. Every git operation arrives
 * through `GitOps`, and every file read is rooted at an injected path, so the
 * whole vocabulary can be exercised against fixtures.
 *
 * The entry requirement for a check is that it be decidable with **no judgement
 * and no model call**. Anything that fails that bar is `proof: manual`, which
 * renders needs-a-person and can never read done. Sixteen of the sixty-five
 * milestones are manual today; that is the vocabulary working, not failing.
 *
 * Two coercion rules learned the hard way, both on 2026-09-08:
 *
 *   `equals: true` on a FRONTMATTER field means "present and truthy" — most
 *   definitions of done mean "the field is filled in", and the vocabulary has no
 *   comparison operator.
 *
 *   `equals: true` on a FLAG DEFAULT means the literal `true`. A source token is
 *   always a string, so the truthy reading would make `di_grounding_enabled:
 *   bool = False` pass. It did, for about ten minutes, until the first dry run.
 */
import fs from 'fs/promises'
import path from 'path'
import matter from 'gray-matter'
import { CRM_STAGES, NON_HUMAN_VIA, stageAtLeast, wantsProduct, type CrmStage } from './config'
import type { ProofCheck, ProofResult, HandoffState } from './roadmap'
import type { Meeting as CalendarEvent } from './calendar'

/** Git, as the proof engine needs it. The script supplies the real one; the
 *  tests supply a fake, which is the point of the seam. */
export interface GitOps {
  /** Resolve + fetch. `{ error }` when the repo is unusable on this machine. */
  /** `refs`, when present, are the landed refs in precedence order (default
   *  branch first, then integration branches such as `staging`). A proof is
   *  true at the first ref where it holds and says which; an `absent` proof
   *  must hold at every ref, because "gone from staging, still on main" is
   *  not gone. Absent `refs` → `[ref]` (the fakes, and older callers). */
  open(repo: string): Promise<{ dir: string; ref: string; refs?: string[] } | { error: string }>
  pathCount(dir: string, ref: string, paths: string[]): Promise<number>
  grep(dir: string, ref: string, needle: string, sub?: string): Promise<number>
  show(dir: string, ref: string, file: string): Promise<string | null>
}

export interface Contact {
  slug: string
  product?: string
  /** Additional products this person asked for — see `wantsProduct` in config. */
  interestedIn?: string[]
  stage: CrmStage
  /** A log line whose `via` is not machinery. `crm/` is janitor-written, so
   *  this — not commit authorship — is what distinguishes selling from import. */
  worked: boolean
}

export interface Meeting {
  slug: string
  title: string
  date: string
  category: string
  agency?: string
  contacts: string[]
}

export interface ProofContext {
  contacts: Contact[]
  meetings: Meeting[]
  /** Calendar events from the ICS feeds, over the window the check fetched.
   *  Absent (undefined) means the calendar was never read; empty means it was
   *  read and had nothing — the check distinguishes the two. */
  calendar?: CalendarEvent[]
  /** Per-feed fetch failures — a check must say "unreachable", never "not booked". */
  calendarErrors?: string[]
  /** The operations repo root; every `path:` in a check is relative to it. */
  root: string
  git: GitOps
}

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true } catch { return false }
}

/**
 * Resolve a dotted field, with `key[id]` addressing a list item by its `id`.
 * `phase0[price-list].done` is the shape `gtm/targets.md` actually uses, and
 * without list addressing half the decision proofs would have to be manual.
 */
export function resolveField(data: unknown, field: string): unknown {
  let cur: unknown = data
  for (const seg of field.split('.')) {
    if (cur == null) return undefined
    const m = /^([^[]+)\[([^\]]+)\]$/.exec(seg)
    if (m) {
      const list = (cur as Record<string, unknown>)[m[1]]
      if (!Array.isArray(list)) return undefined
      cur = list.find(e => e && typeof e === 'object' && String((e as Record<string, unknown>).id) === m[2])
    } else {
      if (typeof cur !== 'object') return undefined
      cur = (cur as Record<string, unknown>)[seg]
    }
  }
  return cur
}

/** For parsed YAML, where `true` means "present and filled in". */
export function fieldMatches(actual: unknown, expected: unknown): boolean {
  if (expected === true) return actual != null && actual !== false && actual !== '' && actual !== 0
  if (expected === false) return actual === false || actual == null || actual === '' || actual === 0
  return String(actual).trim().toLowerCase() === String(expected).trim().toLowerCase()
}

/** For a token lifted out of source, where `true` means the literal `true`. */
export function literalMatches(actual: string, expected: unknown): boolean {
  return actual.replace(/['"]/g, '').trim().toLowerCase() === String(expected).trim().toLowerCase()
}

/** Same shape the dashboard's decision queue scans for. One per line. */
export const DECISION_LINE = /^\s*(?:[-*]\s+)?\[DECISION\]\s*:?\s*(.+)$/

/** A flag name is authored text; treat it as a literal, not a pattern. */
export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ── CRM readers ─────────────────────────────────────────────────────────────

/**
 * Contacts, read directly rather than through `src/lib/crm.ts`.
 *
 * The app's reader normalizes an unknown stage down to `identified`, which is
 * right for a UI (never crash on bad data) and wrong for a proof: a stage the
 * schema does not know must not silently read as the coldest one. Here an
 * unrecognized stage is dropped and NAMED, so it surfaces instead of lying —
 * which is how `verbal-commitment` sat unnoticed for two weeks.
 */
export async function readContacts(root: string, warn: (s: string) => void): Promise<Contact[]> {
  const dir = path.join(root, 'crm/contacts')
  const names = await fs.readdir(dir).catch(() => [] as string[])
  const out: Contact[] = []
  for (const n of names) {
    if (!n.endsWith('.md') || n.startsWith('.')) continue
    const slug = n.replace(/\.md$/, '')
    try {
      const { data, content } = matter(await fs.readFile(path.join(dir, n), 'utf-8'))
      const raw = typeof data.stage === 'string' ? data.stage.trim().toLowerCase() : 'identified'
      if (!(CRM_STAGES as readonly string[]).includes(raw)) {
        warn(`contact ${slug}: stage ${JSON.stringify(raw)} is not in CRM_STAGES`)
        continue
      }
      // `- **YYYY-MM-DD** — text _(via source)_`
      let worked = false
      for (const line of content.split('\n')) {
        if (!/^-\s+\*\*\d{4}-\d{2}-\d{2}\*\*\s+—/.test(line)) continue
        const via = /_\(via\s+([^)]+)\)_\s*$/.exec(line)?.[1]
        if (!via || !NON_HUMAN_VIA.has(via)) { worked = true; break }
      }
      out.push({
        slug,
        product: typeof data.product === 'string' ? data.product : undefined,
        interestedIn: Array.isArray(data.interested_in)
          ? data.interested_in.map(String)
          : undefined,
        stage: raw as CrmStage,
        worked,
      })
    } catch { warn(`contact ${slug}: unreadable`) }
  }
  return out
}

export async function readMeetings(root: string): Promise<Meeting[]> {
  const dir = path.join(root, 'crm/meetings')
  const names = await fs.readdir(dir).catch(() => [] as string[])
  const out: Meeting[] = []
  for (const n of names) {
    if (!n.endsWith('.md') || n.startsWith('.')) continue
    const d = /^(\d{4}-\d{2}-\d{2})/.exec(n)
    if (!d) continue
    try {
      const { data } = matter(await fs.readFile(path.join(dir, n), 'utf-8'))
      out.push({
        slug: n.replace(/\.md$/, ''),
        title: typeof data.title === 'string' ? data.title : n,
        date: typeof data.date === 'string' ? data.date : d[1],
        category: typeof data.category === 'string' ? data.category : 'other',
        agency: typeof data.agency === 'string' ? data.agency : undefined,
        contacts: Array.isArray(data.contacts)
          ? data.contacts.filter((c: unknown) => typeof c === 'string')
          : [],
      })
    } catch { /* unreadable meeting — skip, never break the check */ }
  }
  return out
}

/**
 * Evaluate a count-shaped git question at the landed refs. Present: true at
 * the first ref with a hit, reported. Absent: must be zero at EVERY ref, and
 * the first ref that still has it is the one reported.
 */
async function atLandedRefs(
  r: { ref: string; refs?: string[] },
  absent: boolean | undefined,
  count: (ref: string) => Promise<number>,
): Promise<{ ok: boolean; ref: string; value: number }> {
  const refs = r.refs?.length ? r.refs : [r.ref]
  let last = { ok: false, ref: refs[0], value: 0 }
  for (const ref of refs) {
    const n = await count(ref)
    if (absent ? n > 0 : n > 0) return { ok: !absent, ref, value: n }
    last = { ok: Boolean(absent), ref, value: n }
  }
  return last
}

// ── the ten checks ──────────────────────────────────────────────────────────

/**
 * One check → one verdict, with a sentence saying why.
 *
 * Every branch returns a `detail` naming the thing it looked at, because a proof
 * nobody can audit is a status field with extra steps. A check that cannot run
 * (repo absent) is `ok: false` WITH the reason — never a silent pass.
 */
export async function evalCheck(c: ProofCheck, ctx: ProofContext): Promise<ProofResult> {
  const opsFile = (p: string) => path.join(ctx.root, p.replace(/^operations\//, ''))

  switch (c.check) {
    case 'file_exists': {
      const ok = await exists(opsFile(c.path))
      return { check: c.check, ok, detail: `${c.path} ${ok ? 'exists' : 'does not exist'}` }
    }

    case 'frontmatter_field': {
      const f = opsFile(c.path)
      if (!await exists(f)) return { check: c.check, ok: false, detail: `${c.path} does not exist` }
      try {
        const { data } = matter(await fs.readFile(f, 'utf-8'))
        const actual = resolveField(data, c.field)
        return {
          check: c.check,
          ok: fieldMatches(actual, c.equals),
          detail: `${c.path} ${c.field} = ${JSON.stringify(actual ?? null)} (want ${JSON.stringify(c.equals)})`,
        }
      } catch {
        return { check: c.check, ok: false, detail: `${c.path} has unreadable frontmatter` }
      }
    }

    case 'decision_resolved': {
      const f = opsFile(c.path)
      if (!await exists(f)) return { check: c.check, ok: false, detail: `${c.path} does not exist` }
      const text = await fs.readFile(f, 'utf-8')
      const lines = text.split('\n').filter(l => DECISION_LINE.test(l) && l.includes(c.contains))
      if (lines.length === 0) {
        return { check: c.check, ok: false, detail: `no [DECISION] line in ${c.path} contains "${c.contains}"` }
      }
      const open = lines.filter(l => !/\[RESOLVED\b/.test(l))
      return {
        check: c.check,
        ok: open.length === 0,
        detail: open.length === 0
          ? `all ${lines.length} matching [DECISION] line(s) in ${c.path} are resolved`
          : `${open.length} of ${lines.length} matching [DECISION] line(s) in ${c.path} still open`,
      }
    }

    case 'git_path_exists': {
      const r = await ctx.git.open(c.repo)
      if ('error' in r) return { check: c.check, ok: false, detail: r.error }
      const { ok, ref, value: n } = await atLandedRefs(r, c.absent, ref => ctx.git.pathCount(r.dir, ref, [c.path]))
      return {
        check: c.check, ok,
        detail: `${c.repo} ${c.path}: ${n} file(s) at ${ref}${c.absent ? ' (want none)' : ''}`,
      }
    }

    case 'git_grep': {
      const r = await ctx.git.open(c.repo)
      if ('error' in r) return { check: c.check, ok: false, detail: r.error }
      const { ok, ref, value: n } = await atLandedRefs(r, c.absent, ref => ctx.git.grep(r.dir, ref, c.pattern, c.path))
      return {
        check: c.check, ok,
        detail: `${c.repo}: "${c.pattern}" in ${n} file(s)${c.path ? ` under ${c.path}` : ''} at ${ref}${c.absent ? ' (want none)' : ''}`,
      }
    }

    case 'flag_default': {
      const r = await ctx.git.open(c.repo)
      if ('error' in r) return { check: c.check, ok: false, detail: r.error }
      // The flag is read at the first landed ref that has the file; a default
      // flipped on staging but not yet released reads as flipped, at staging.
      let src: string | null = null
      let ref = r.ref
      for (const candidate of r.refs ?? [r.ref]) {
        src = await ctx.git.show(r.dir, candidate, c.path)
        ref = candidate
        if (src) break
      }
      if (!src) return { check: c.check, ok: false, detail: `${c.repo} ${c.path} not readable at ${(r.refs ?? [r.ref]).join(' or ')}` }
      // `name: bool = True` (Python settings), `export const name = true` (TS).
      // The default is the first token after the `=` on the declaration line;
      // an optional declaration keyword may precede the name, or the four repos
      // that are not Python would never match.
      const re = new RegExp(
        '^\\s*(?:(?:export|public|readonly|const|let|var)\\s+)*' +
        escapeRe(c.name) + '\\s*(?::[^=\\n]+)?=\\s*([^\\s#,;)]+)', 'm')
      const m = re.exec(src)
      if (!m) return { check: c.check, ok: false, detail: `${c.name} not declared in ${c.repo} ${c.path}` }
      // literalMatches, NOT fieldMatches — see the module header.
      return {
        check: c.check,
        ok: literalMatches(m[1], c.equals),
        detail: `${c.repo} ${c.path}: ${c.name} = ${m[1]} (want ${c.equals}) at ${ref}`,
      }
    }

    case 'contact_stage': {
      const found = ctx.contacts.find(x => x.slug === c.contact)
      if (!found) return { check: c.check, ok: false, detail: `no CRM contact ${c.contact}` }
      const floor = c.at_least as CrmStage
      const warm = stageAtLeast(found.stage, floor)
      // Stage alone is not demand: a stage set by lead-sync with no human ever
      // having spoken to them proves nothing.
      return {
        check: c.check,
        ok: warm && found.worked,
        detail: `${c.contact} at ${found.stage} (want ≥ ${floor})` +
          (warm && !found.worked ? ' — but no human-`via` log line' : ''),
      }
    }

    case 'contacts_count': {
      const floor = c.stage_at_least as CrmStage
      const hits = ctx.contacts.filter(x =>
        wantsProduct(x, c.product) && x.worked && stageAtLeast(x.stage, floor))
      return {
        check: c.check,
        ok: hits.length >= c.count,
        detail: `${hits.length} human-worked ${c.product} contact(s) at ≥ ${floor} (want ${c.count})`,
      }
    }

    case 'meeting_logged': {
      let re: RegExp
      try { re = new RegExp(c.title_match, 'i') } catch {
        return { check: c.check, ok: false, detail: `title_match ${JSON.stringify(c.title_match)} is not a regex` }
      }
      // `category: agency` is part of the check, not an extra condition: an
      // internal meeting ABOUT an agency is not a meeting WITH one.
      const hits = ctx.meetings.filter(m =>
        m.category === 'agency' &&
        m.agency === c.agency &&
        re.test(m.title) &&
        (!c.after || m.date > c.after))
      const where = `/${c.title_match}/${c.after ? ` after ${c.after}` : ''}`
      return {
        check: c.check,
        ok: hits.length > 0,
        detail: hits.length > 0
          ? `${hits.length} agency meeting(s) for ${c.agency} matching ${where}: ${hits.map(h => h.slug).join(', ')}`
          : `no agency meeting for ${c.agency} matching ${where}`,
      }
    }
    case 'calendar_event': {
      let re: RegExp
      try { re = new RegExp(c.title_match, 'i') } catch {
        return { check: c.check, ok: false, detail: `title_match ${JSON.stringify(c.title_match)} is not a regex` }
      }
      const domain = c.attendee_domain?.trim().toLowerCase()
      const where = `/${c.title_match}/${domain ? ` with @${domain}` : ''}${c.after ? ` after ${c.after}` : ''}${c.before ? ` before ${c.before}` : ''}`
      // Absence renders unknown, never green — and never a confident red either.
      // A calendar that was not read, or whose feeds all failed, is not "no
      // invite"; it is "could not look", and the detail must say so.
      if (!ctx.calendar) {
        return { check: c.check, ok: false, detail: `calendar not read this run — cannot decide ${where}` }
      }
      if (ctx.calendar.length === 0 && ctx.calendarErrors?.length) {
        return { check: c.check, ok: false, detail: `calendar unreachable (${ctx.calendarErrors.join('; ')}) — cannot decide ${where}` }
      }
      const hits = ctx.calendar.filter(ev => {
        const day = ev.startAt.slice(0, 10)
        return re.test(ev.title) && (!c.after || day > c.after) && (!c.before || day < c.before)
          && (!domain || ev.attendees.some(a => a.toLowerCase().endsWith(`@${domain}`)))
      })
      return {
        check: c.check,
        ok: hits.length > 0,
        detail: hits.length > 0
          ? `${hits.length} calendar event(s) matching ${where}: ${hits.slice(0, 3).map(h => `${h.startAt.slice(0, 10)} ${h.title}`).join(' · ')}`
          : `no calendar event matching ${where}`,
      }
    }
  }
  return { check: (c as { check: string }).check, ok: false, detail: 'unknown check' }
}

// ── handoffs ────────────────────────────────────────────────────────────────

/**
 * Git, as the HANDOFF check needs it — a second seam, deliberately not folded
 * into `GitOps`.
 *
 * The nine proof checks want one ref per repo. A handoff wants *several*: the
 * BidPro team merges to `staging` while `origin/main` moves separately, so
 * "landed" has to be asked of each integration branch in turn and the answer has
 * to say which one. Widening `GitOps.open` to return a list would have touched
 * all nine working, tested checks to serve one that had no tests at all — the
 * wrong direction. One implementation object in the script satisfies both.
 *
 * This interface exists because until 2026-09-08 `checkHandoff` reached for git
 * directly and could not be tested. Five milestones ran through it — every
 * BidPro handoff, the thing Pavan most needs frequent visibility into — with
 * zero coverage.
 */
export interface HandoffOps {
  /**
   * Resolve and fetch. `refs` is the default branch first, then any integration
   * branch this clone can actually see; `narrow` means the clone is
   * single-branch and other branches were never fetched.
   */
  open(repo: string): Promise<{ dir: string; refs: string[]; narrow: boolean } | { error: string }>
  /** Files containing `needle` at `ref`, filtered by git pathspecs — a path to
   *  look under, `:!…` exclusions, or both. Absent means the whole tree. */
  grep(dir: string, ref: string, needle: string, pathspec?: string[]): Promise<string[]>
  /** ISO instant when `needle` FIRST appeared at `ref` within `pathspec`, or null. */
  firstSeen(dir: string, ref: string, needle: string, pathspec?: string[]): Promise<string | null>
  /** Last-commit ISO instant of a spec path in operations; null when absent. */
  specAt(relPath: string): Promise<string | null>
}

export interface HandoffCheck {
  state?: HandoffState
  ageDays?: number | null
  at?: string | null
  /** Which ref the literal was found at. Set with `merged` and `consumed` —
   *  consumed is merged plus a reference here, so their ref still applies. */
  ref?: string | null
  /** The first CODE file the literal was found in at `ref`. Shown, so a match
   *  can be read for what it is — a migration is landed, a fixture is not. */
  file?: string | null
  error?: string
}

/** The handoff's own frontmatter — narrowed so a test need not build a whole milestone. */
export interface HandoffSpec {
  spec?: string
  landed?: string
  /** A path prefix on THEIR side that `landed` must appear under. */
  landedIn?: string
  consumedBy?: string
  pr?: string
}

/**
 * Prose never counts as landed.
 *
 * On 2026-09-08 all four BidPro handoff literals — `status_changed_at`,
 * `bid_plan_items`, `response_blocks`, `claim_gate_runs` — read `merged` on
 * their `staging`, in the same second. Every one was matching
 * `docs/unified-bid-system-plan.md`: OUR plan, PR'd into THEIR repo. The spec
 * that names a table is not the table. The README already said "a LITERAL
 * string in THEIR code, not prose"; this is the engine enforcing it. `landed_in`
 * narrows further when a repo's fixtures or seeds also name the thing.
 */
export const PROSE_PATHSPECS: readonly string[] = [':!*.md', ':!*.mdx', ':!*.txt', ':!*.rst', ':!docs']

export const codePathspec = (within?: string): string[] =>
  within ? [within, ...PROSE_PATHSPECS] : [...PROSE_PATHSPECS]

const ageInDays = (iso: string, now: Date) =>
  Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000)

/**
 * Handoff state, mechanically. `landed` must be a literal string that appears in
 * their code (a route, an export, a table name), never prose — a claim that
 * cites evidence can be checked.
 *
 * Order is the whole design, strongest evidence first — and each state implies
 * the one below it:
 *
 *   consumed  merged, AND our repo references what they shipped. The only
 *             state that means the handoff produced value rather than motion.
 *   merged    the literal exists in CODE on one of their integration refs.
 *   pr-opened they have a PR out.
 *   spec-sent we wrote the spec and nothing has come back.
 *   unknown   nothing is resolvable — never green.
 *
 * `consumed` used to be decided from our repo alone, before theirs was looked
 * at. Our wire type declares every field we ASKED for, so a placeholder typed
 * on day zero would have read as the handoff paying off.
 */
export async function evalHandoff(
  h: HandoffSpec,
  rowRepos: string[],
  ops: HandoffOps,
  now: Date = new Date(),
): Promise<HandoffCheck> {
  const { spec, landed, landedIn, consumedBy, pr } = h
  const repoName = rowRepos[0]
  if (!repoName) return { error: 'No repo declared on the row' }

  if (landed) {
    const r = await ops.open(repoName)
    if ('error' in r) return { error: r.error }

    const where = codePathspec(landedIn)
    for (const ref of r.refs) {
      const files = await ops.grep(r.dir, ref, landed, where)
      if (files.length === 0) continue
      const at = await ops.firstSeen(r.dir, ref, landed, where)
      const found = { ageDays: at ? ageInDays(at, now) : null, at, ref, file: files[0] }

      // Merged is the floor; consumed is only ever claimed on top of it. Ask
      // OUR repo whether it references what they shipped — under the declared
      // path, and never in prose there either. Merged-but-unconsumed is the
      // worst outcome on this board — they did the work and nothing picked it
      // up — so the two must not blur.
      if (consumedBy) {
        const cc = await ops.open('command-center')
        if (!('error' in cc)) {
          for (const ours of cc.refs) {
            if ((await ops.grep(cc.dir, ours, landed, codePathspec(consumedBy))).length > 0) {
              return { state: 'consumed', ...found }
            }
          }
        }
      }
      return { state: 'merged', ...found }
    }

    // Not in code. Say WHERE we looked: "not resolved" is a mystery, this is a
    // fact. It matters twice over — the mini's qual_table_automations clone was
    // single-branch on `main` while that team works on `staging`; and a literal
    // that IS present, but only in prose, is the exact false positive this
    // check exists to refuse, so it gets named rather than folded into absence.
    if (!pr && !spec) {
      for (const ref of r.refs) {
        const elsewhere = await ops.grep(r.dir, ref, landed)
        if (elsewhere.length === 0) continue
        return {
          error: landedIn
            ? `"${landed}" found at ${ref} in ${repoName} only outside ${landedIn} (${elsewhere[0]})`
            : `"${landed}" appears only in prose at ${ref} in ${repoName} (${elsewhere[0]}) — ` +
              'a document that names it is not a landing',
        }
      }
      return {
        error: `"${landed}" not found in code at ${r.refs.join(' or ')} in ${repoName}` +
          (r.narrow ? ' — and this clone is single-branch, so no other branch was searched' : ''),
      }
    }
  }

  if (pr) return { state: 'pr-opened' }

  if (spec) {
    const at = await ops.specAt(spec)
    if (at === null) return { error: `Spec ${spec} not found` }
    return { state: 'spec-sent', ageDays: at ? ageInDays(at, now) : null, at: at || null }
  }

  return { state: 'unknown' }
}

