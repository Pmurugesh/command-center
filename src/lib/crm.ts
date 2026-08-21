/**
 * CRM store — the write layer for `operations/crm/contacts/`.
 *
 * Every surface (dashboard, API, Telegram agent, sync jobs) goes through this
 * module. That is deliberate and load-bearing: it is what keeps ten humans and
 * five agents behaving as ONE serialized writer, so the file store never has to
 * survive concurrent working-tree writers.
 *
 * Three guarantees this module owns:
 *   1. Atomic writes — temp file + rename, so a crash can never truncate a record.
 *   2. Cross-process mutual exclusion — a mkdir lock, because agents write from
 *      separate processes where an in-process mutex would be theatre.
 *   3. Semantic history — every write is a git commit describing what changed
 *      and who changed it, so `git log <contact>` IS the touch history. The
 *      janitor pushes; we never block a UI write on the network.
 */
import fs from 'fs/promises'
import path from 'path'
import matter from 'gray-matter'
import { PATHS } from './paths'
import { runCommandArgs } from './shell'
import { acquireLock as acquireStoreLock, atomicWrite, fileExists } from './store'
import {
  CRM_COLD_DAYS, CRM_TERMINAL_STAGES,
  normalizeCrmStage, normalizeCrmStatus,
} from './config'
import type {
  CrmContact, CrmContactUpdate, CrmContactView, CrmBuckets, CrmLogEntry,
} from '@/types'

const LOG_HEADING = '## Log'

// ── dates ───────────────────────────────────────────────────────────────────
// Everything is date-only (YYYY-MM-DD) in local time. Contact aging is measured
// in days, so timezone-correct calendar days matter more than instants.

export function today(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Whole days from `date` to today. Negative = date is in the future. */
function daysSince(date?: string): number | undefined {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined
  const [y, m, d] = date.split('-').map(Number)
  const then = new Date(y, m - 1, d).getTime()
  const [ty, tm, td] = today().split('-').map(Number)
  const now = new Date(ty, tm - 1, td).getTime()
  return Math.round((now - then) / 86_400_000)
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y, m - 1, d + days)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
}

// ── slugs ───────────────────────────────────────────────────────────────────

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/** Reject anything that could escape the contacts directory. */
function safeSlug(slug: string): string | null {
  if (!slug || slug.includes('/') || slug.includes('..') || slug.startsWith('.')) return null
  if (!/^[a-z0-9-]+$/.test(slug)) return null
  return slug
}

function contactPath(slug: string): string {
  return path.join(PATHS.crmContacts, `${slug}.md`)
}


// ── lock ────────────────────────────────────────────────────────────────────
// Delegates to the shared store primitives; see src/lib/store.ts for why mkdir.

async function acquireLock(): Promise<() => Promise<void>> {
  return acquireStoreLock(PATHS.crm, PATHS.crmContacts)
}

// ── parse / serialize ───────────────────────────────────────────────────────

/**
 * Strip the leading `# Name` heading. serialize() owns rendering that title
 * from the frontmatter, so notes must never carry it: otherwise every
 * read-modify-write round trip prepends another copy and records accrete one
 * title per edit, forever.
 */
function stripTitle(notes: string): string {
  return notes.replace(/^\s*#\s+[^\n]*\n?/, '').trim()
}

function parseLog(body: string): { notes: string; log: CrmLogEntry[] } {
  const idx = body.indexOf(LOG_HEADING)
  if (idx === -1) return { notes: stripTitle(body), log: [] }

  const notes = stripTitle(body.slice(0, idx))
  const log: CrmLogEntry[] = []

  for (const line of body.slice(idx + LOG_HEADING.length).split('\n')) {
    // - **YYYY-MM-DD** — text _(via source)_
    const m = line.match(/^-\s+\*\*(\d{4}-\d{2}-\d{2})\*\*\s+[—-]\s+(.*)$/)
    if (!m) continue
    let text = m[2].trim()
    let via: string | undefined
    const viaMatch = text.match(/\s*_\(via\s+([^)]+)\)_\s*$/)
    if (viaMatch) {
      via = viaMatch[1]
      text = text.slice(0, viaMatch.index).trim()
    }
    log.push({ date: m[1], text, via })
  }
  return { notes, log }
}

function serialize(c: CrmContact): string {
  // Only defined values reach the frontmatter, so absent fields stay absent
  // rather than littering every file with nulls.
  const fm: Record<string, unknown> = {
    name: c.name,
    title: c.title,
    email: c.email,
    phone: c.phone,
    agency: c.agency,
    agency_name: c.agencyName,
    product: c.product,
    owner: c.owner,
    tier: c.tier,
    stage: c.stage,
    status: c.status,
    blocked_on: c.blockedOn,
    last_touched: c.lastTouched,
    next_action: c.nextAction,
    next_action_due: c.nextActionDue,
    source: c.source,
    created: c.created,
  }
  for (const k of Object.keys(fm)) {
    if (fm[k] === undefined || fm[k] === null || fm[k] === '') delete fm[k]
  }

  const logLines = c.log.map(e =>
    `- **${e.date}** — ${e.text}${e.via ? ` _(via ${e.via})_` : ''}`)

  const body = [
    `# ${c.name}`,
    '',
    c.notes.trim(),
    '',
    LOG_HEADING,
    '',
    ...(logLines.length ? logLines : ['_(no entries yet)_']),
    '',
  ].join('\n')

  return matter.stringify(body, fm)
}

function hydrate(slug: string, raw: string): CrmContact {
  const { data, content } = matter(raw)
  const { notes, log } = parseLog(content)
  return {
    slug,
    name: String(data.name ?? slug),
    title: data.title ? String(data.title) : undefined,
    email: data.email ? String(data.email) : undefined,
    phone: data.phone ? String(data.phone) : undefined,
    agency: data.agency ? String(data.agency) : undefined,
    agencyName: data.agency_name ? String(data.agency_name) : undefined,
    product: data.product ? String(data.product) : undefined,
    owner: data.owner ? String(data.owner) : undefined,
    tier: data.tier ? String(data.tier) : undefined,
    stage: normalizeCrmStage(data.stage) ?? 'identified',
    status: normalizeCrmStatus(data.status) ?? 'active',
    blockedOn: data.blocked_on ? String(data.blocked_on) : undefined,
    lastTouched: data.last_touched ? String(data.last_touched) : undefined,
    nextAction: data.next_action ? String(data.next_action) : undefined,
    nextActionDue: data.next_action_due ? String(data.next_action_due) : undefined,
    source: data.source ? String(data.source) : undefined,
    created: data.created ? String(data.created) : undefined,
    notes,
    log,
  }
}

// ── git ─────────────────────────────────────────────────────────────────────

/**
 * Commit one contact file with a message saying what happened and who did it.
 * Deliberately does NOT push — the janitor LaunchAgent does that every 120s, so
 * a UI write never waits on the network. Failures are swallowed: losing history
 * on one write is bad, but refusing the user's edit because git hiccuped is worse.
 */
async function commitContact(slug: string, summary: string, via: string): Promise<void> {
  const rel = path.relative(PATHS.operationsRoot, contactPath(slug))
  try {
    await runCommandArgs('git', ['-C', PATHS.operationsRoot, 'add', '--', rel], 15_000)
    await runCommandArgs('git', [
      '-C', PATHS.operationsRoot, 'commit', '-q',
      '-m', `crm: ${summary}`,
      '-m', `contact: ${slug}\nvia: ${via}`,
      '--', rel,
    ], 15_000)
  } catch {
    // Nothing staged (no-op edit) or git unavailable. The janitor sweeps either way.
  }
}

/**
 * Commit the whole CRM tree in one go. For bulk writers that passed
 * `commit: false` and want a single history entry for the batch.
 */
export async function commitBatch(summary: string, via: string): Promise<void> {
  const rel = path.relative(PATHS.operationsRoot, PATHS.crm)
  try {
    await runCommandArgs('git', ['-C', PATHS.operationsRoot, 'add', '--', rel], 30_000)
    await runCommandArgs('git', [
      '-C', PATHS.operationsRoot, 'commit', '-q',
      '-m', `crm: ${summary}`, '-m', `via: ${via}`,
    ], 30_000)
  } catch { /* nothing staged, or git unavailable — janitor sweeps */ }
}

// ── read ────────────────────────────────────────────────────────────────────

export async function listContacts(): Promise<CrmContact[]> {
  if (!(await fileExists(PATHS.crmContacts))) return []
  const entries = await fs.readdir(PATHS.crmContacts)
  const files = entries.filter(f => f.endsWith('.md') && !f.startsWith('.'))

  const out = await Promise.all(files.map(async f => {
    try {
      return hydrate(f.replace(/\.md$/, ''), await fs.readFile(path.join(PATHS.crmContacts, f), 'utf-8'))
    } catch {
      return null   // one corrupt file must not blank the whole CRM
    }
  }))
  return out.filter((c): c is CrmContact => c !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function getContact(slug: string): Promise<CrmContact | null> {
  const safe = safeSlug(slug)
  if (!safe) return null
  const p = contactPath(safe)
  if (!(await fileExists(p))) return null
  try {
    return hydrate(safe, await fs.readFile(p, 'utf-8'))
  } catch {
    return null
  }
}

// ── derived views ───────────────────────────────────────────────────────────

function decorate(c: CrmContact): CrmContactView {
  const overdueBy = c.nextActionDue ? daysSince(c.nextActionDue) : undefined
  const sinceTouch = daysSince(c.lastTouched)
  const blockedFor = c.status === 'blocked' ? daysSince(c.lastTouched) : undefined
  return {
    ...c,
    daysOverdue: overdueBy !== undefined && overdueBy > 0 ? overdueBy : undefined,
    daysSinceTouch: sinceTouch,
    daysBlocked: blockedFor,
  }
}

function isLive(c: CrmContact): boolean {
  return c.status !== 'dormant' && !CRM_TERMINAL_STAGES.includes(c.stage)
}

/**
 * The morning view. Buckets are mutually exclusive and ordered by urgency, so a
 * contact appears exactly once and the top of the page is always the thing that
 * needs attention most. Blocked outranks overdue-by-date because a blocked item
 * cannot be worked at all until someone clears the blocker.
 */
export function bucketize(contacts: CrmContact[]): CrmBuckets {
  const live = contacts.filter(isLive).map(decorate)
  const t = today()

  const blocked = live.filter(c => c.status === 'blocked')
  const rest = live.filter(c => c.status !== 'blocked')

  const overdue = rest.filter(c => c.daysOverdue !== undefined)
  const dueToday = rest.filter(c => c.nextActionDue === t)
  const goingCold = rest.filter(c =>
    c.daysOverdue === undefined &&
    c.nextActionDue !== t &&
    c.daysSinceTouch !== undefined &&
    c.daysSinceTouch >= CRM_COLD_DAYS)

  const byOverdue = (a: CrmContactView, b: CrmContactView) => (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0)
  const byStale = (a: CrmContactView, b: CrmContactView) => (b.daysSinceTouch ?? 0) - (a.daysSinceTouch ?? 0)

  return {
    overdue: overdue.sort(byOverdue),
    blocked: blocked.sort(byStale),
    dueToday,
    goingCold: goingCold.sort(byStale),
    total: contacts.length,
  }
}

export async function getBuckets(): Promise<CrmBuckets> {
  return bucketize(await listContacts())
}

// ── write ───────────────────────────────────────────────────────────────────


/**
 * Persist a full record. Callers hold the lock; this does the bytes + history.
 * `commit: false` writes the file but skips git — for bulk operations (seed,
 * Granola batch sync) where one commit describing the batch beats N commits
 * describing each row. The caller is then responsible for committing.
 */
async function persist(
  c: CrmContact, summary: string, via: string, commit = true,
): Promise<CrmContact> {
  await atomicWrite(contactPath(c.slug), serialize(c))
  if (commit) await commitContact(c.slug, summary, via)
  return c
}

export async function createContact(
  input: Partial<CrmContact> & { name: string },
  via = 'dashboard',
  commit = true,
): Promise<CrmContact> {
  const release = await acquireLock()
  try {
    const base = slugify(input.name)
    if (!base) throw new Error('Contact name produces an empty slug')

    // Collision: disambiguate by agency, then by counter. Never silently merge
    // two humans into one file.
    let slug = base
    if (await fileExists(contactPath(slug))) {
      slug = input.agency ? `${base}-${slugify(input.agency)}` : base
      for (let i = 2; await fileExists(contactPath(slug)); i++) slug = `${base}-${i}`
    }

    const now = today()
    const contact: CrmContact = {
      slug,
      name: input.name,
      title: input.title,
      email: input.email,
      phone: input.phone,
      agency: input.agency,
      agencyName: input.agencyName,
      product: input.product,
      owner: input.owner,
      tier: input.tier,
      stage: input.stage ?? 'identified',
      status: input.status ?? 'active',
      blockedOn: input.blockedOn,
      lastTouched: input.lastTouched ?? now,
      nextAction: input.nextAction,
      nextActionDue: input.nextActionDue,
      source: input.source,
      created: input.created ?? now,
      notes: input.notes ?? '',
      log: input.log ?? [],
    }
    return await persist(contact, `add ${contact.name}`, via, commit)
  } finally {
    await release()
  }
}

/**
 * Patch a contact. `null` on an optional field clears it — which is how a
 * blocker gets removed, so "unblock" needs no special endpoint.
 */
export async function updateContact(
  slug: string, patch: CrmContactUpdate, via = 'dashboard', commit = true,
): Promise<CrmContact | null> {
  const release = await acquireLock()
  try {
    const current = await getContact(slug)
    if (!current) return null

    const changed: string[] = []
    const next: CrmContact = { ...current }

    const setStr = (key: keyof CrmContactUpdate, field: keyof CrmContact, label: string) => {
      if (!(key in patch)) return
      const v = patch[key] as string | null | undefined
      if (v === undefined) return
      const resolved = v === null || v === '' ? undefined : String(v)
      if (resolved === (current[field] as string | undefined)) return
      ;(next as unknown as Record<string, unknown>)[field] = resolved
      changed.push(resolved ? `${label}=${resolved}` : `cleared ${label}`)
    }

    setStr('name', 'name', 'name')
    setStr('title', 'title', 'title')
    setStr('email', 'email', 'email')
    setStr('phone', 'phone', 'phone')
    setStr('agency', 'agency', 'agency')
    setStr('agencyName', 'agencyName', 'agency_name')
    setStr('product', 'product', 'product')
    setStr('owner', 'owner', 'owner')
    setStr('tier', 'tier', 'tier')
    setStr('blockedOn', 'blockedOn', 'blocked_on')
    setStr('nextAction', 'nextAction', 'next_action')
    setStr('nextActionDue', 'nextActionDue', 'next_action_due')

    if (patch.stage) {
      const s = normalizeCrmStage(patch.stage)
      if (s && s !== current.stage) { next.stage = s; changed.push(`stage=${s}`) }
    }
    if (patch.status) {
      const s = normalizeCrmStatus(patch.status)
      if (s && s !== current.status) { next.status = s; changed.push(`status=${s}`) }
    }
    if (patch.notes !== undefined && patch.notes !== current.notes) {
      next.notes = patch.notes
      changed.push('notes')
    }

    // Setting a blocker implies blocked; clearing the last blocker implies active.
    // Inferring this here means no surface can produce the contradictory state
    // (status=blocked with nothing to point at) that made the CalHR miss invisible.
    if ('blockedOn' in patch) {
      if (next.blockedOn && next.status !== 'blocked') {
        next.status = 'blocked'; changed.push('status=blocked')
      } else if (!next.blockedOn && current.status === 'blocked') {
        next.status = 'active'; changed.push('status=active')
      }
    }

    if (!changed.length) return current
    return await persist(next, `${current.name}: ${changed.join(', ')}`, via, commit)
  } finally {
    await release()
  }
}

/**
 * Record a touch. This is the highest-frequency write in the system (Telegram
 * "log rouse called…"), so it does the bookkeeping the human would forget:
 * bumps last_touched, clears a satisfied next_action, and advances a contact
 * out of `identified` on first contact.
 */
export async function appendLog(
  slug: string,
  text: string,
  opts: { via?: string; date?: string; clearNextAction?: boolean } = {},
): Promise<CrmContact | null> {
  const via = opts.via ?? 'dashboard'
  const release = await acquireLock()
  try {
    const current = await getContact(slug)
    if (!current) return null

    const date = opts.date ?? today()
    const next: CrmContact = {
      ...current,
      lastTouched: date,
      log: [...current.log, { date, text, via }],
    }
    if (current.stage === 'identified') next.stage = 'contacted'
    if (opts.clearNextAction) {
      next.nextAction = undefined
      next.nextActionDue = undefined
    }

    const preview = text.length > 50 ? `${text.slice(0, 50)}…` : text
    return await persist(next, `log touch — ${current.name}: ${preview}`, via)
  } finally {
    await release()
  }
}

/** Push a contact's next action out by N days, keeping it on the radar. */
export async function snoozeContact(
  slug: string, days: number, via = 'dashboard',
): Promise<CrmContact | null> {
  const base = today()
  return updateContact(slug, { nextActionDue: addDays(base, days) }, via)
}
