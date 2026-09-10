/**
 * Follow-up drafting (Phase 11 + Phase 12/Outreach).
 *
 * Phase 11 introduced deterministic scaffolding: every line traces to a
 * field or a log entry, so the draft can never invent a commitment you
 * didn't make. Nothing here sends mail.
 *
 * Phase 12 adds:
 *   - Extended frontmatter: status, trigger_kind, trigger_ref, aging_since, sent_at
 *   - listDrafts(): reads crm/drafts/ and returns a priority-sorted queue
 *   - Write-on-first-generate: the first GET of a draft persists it so it
 *     immediately appears in the /outreach queue
 */

import fs from 'fs/promises'
import path from 'path'
import matter from 'gray-matter'
import { PATHS } from './paths'
import { runCommandArgs } from './shell'
import { getContact } from './crm'
import type { CrmContact, CrmLogEntry } from '@/types'

// ── types ────────────────────────────────────────────────────────────────────

export type DraftTriggerKind =
  | 'crm-due'
  | 'post-meeting'
  | 'bid-submitted'
  | 'cold-contact'
  | 'manual'

export interface FollowupDraft {
  slug: string
  subject: string
  body: string
  // Phase 12 additions — all optional for backwards compatibility
  to?: string               // recipient email (from contact.email)
  edited: boolean
  status?: 'draft' | 'sent'
  sentAt?: string           // ISO timestamp when marked sent
  triggerKind?: DraftTriggerKind
  triggerRef?: string       // meeting slug or bid slug that caused this
  agingSince?: string       // YYYY-MM-DD — when the need arose
  updatedAt?: string
  /** Who is sending. Not always Pavan — pindi-oeis.md is from Saravanan. */
  sender?: string
  /** INTERNAL context for the person personalising this draft, and input for a
   *  drafting agent. Never rendered into the body: this is where CRM shorthand
   *  such as next_action and blocked_on lives so it cannot leak into prose. */
  notes?: string
}

/** Enriched view for the /outreach queue: computed priority + contact info. */
export interface OutreachDraft extends FollowupDraft {
  status: 'draft' | 'sent'    // required (defaulted to 'draft' on read)
  priority: 'high' | 'medium' | 'low'
  agingDays?: number
  contactName?: string
  contactAgencyName?: string
}

// ── helpers ──────────────────────────────────────────────────────────────────

function draftPath(slug: string): string {
  return path.join(PATHS.crmDrafts, `${slug}.md`)
}

function firstName(name: string): string {
  return (name.trim().split(/\s+/)[0] || name).trim()
}

/** Whole calendar days from an ISO date string to today. */
function daysSince(iso?: string): number | undefined {
  if (!iso) return undefined
  const t = new Date(`${iso}T12:00:00Z`).getTime()
  if (Number.isNaN(t)) return undefined
  return Math.floor((Date.now() - t) / 86_400_000)
}

function computePriority(d: FollowupDraft, agingDays?: number): 'high' | 'medium' | 'low' {
  if (d.triggerKind === 'crm-due') return 'high'
  if (agingDays !== undefined && agingDays > 14) return 'high'
  if (agingDays !== undefined && agingDays > 7) return 'medium'
  return 'low'
}

function sortDrafts(a: OutreachDraft, b: OutreachDraft): number {
  const PRANK: Record<string, number> = { high: 0, medium: 1, low: 2 }
  const pr = (PRANK[a.priority] ?? 3) - (PRANK[b.priority] ?? 3)
  if (pr !== 0) return pr
  // Oldest aging first within the same priority tier.
  const aAge = a.agingSince ?? a.updatedAt ?? ''
  const bAge = b.agingSince ?? b.updatedAt ?? ''
  return aAge.localeCompare(bAge)
}

// ── build ─────────────────────────────────────────────────────────────────────

/**
 * Compose the scaffold.
 *
 * HARD RULE: no CRM field written for an internal reader may appear in the
 * body.
 *
 * The previous template broke that rule twice, unguarded. `nextAction` went out
 * as "The next step we agreed was: {…}" — where the real values on disk are
 * things like "Personal follow-up — upsell", "Call — offer free 30-day pilot",
 * "Warm product path — services client with no product conversation started"
 * and "Confirm current status — six meetings through Feb 2026, then silence".
 * `blockedOn` went out as "I know this is waiting on {…}" — and two contacts
 * carry `blocked_on: product one-pager does not exist`. Both bypassed
 * externalSafe() entirely, which in any case only screens for repo paths.
 *
 * It also opened with "It has been {n} days since we last spoke", which leads
 * with your own neglect and — being frozen at write time — was wrong within a
 * week (christine-lci.md still says 187 when the true figure is 196).
 *
 * So the internal facts now travel in frontmatter `notes`, where the person
 * personalising the draft can read them and a drafting agent can use them as
 * input. What is left in the body is deliberately short: a greeting, one
 * concrete ask with real dates, a sign-off. A four-line email that cannot
 * embarrass you beats a seven-line one that can.
 */
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/**
 * The next Tue–Fri block that is at least two days out, as prose.
 * Concrete dates are the single biggest difference between the generated
 * drafts and the one good hand-written one in the store.
 */
export function nextAvailabilityWindow(now = new Date()): string {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  start.setDate(start.getDate() + 2)
  // Advance to Tuesday (2). A Tue start keeps Monday free for the week's own mess.
  while (start.getDay() !== 2) start.setDate(start.getDate() + 1)
  const end = new Date(start)
  end.setDate(end.getDate() + 3) // Friday

  const sameMonth = start.getMonth() === end.getMonth()
  const range = sameMonth
    ? `${MONTHS[start.getMonth()]} ${start.getDate()}–${end.getDate()}`
    : `${MONTHS[start.getMonth()]} ${start.getDate()} – ${MONTHS[end.getMonth()]} ${end.getDate()}`
  return `Tuesday through Friday (${range})`
}

export function buildDraft(
  contact: CrmContact, log: CrmLogEntry[] = [], now = new Date(),
): FollowupDraft {
  const who = firstName(contact.name)

  const recent = [...log].sort((a, b) => b.date.localeCompare(a.date))
  const lastEmail = recent.find(l => l.via === 'email-in' || l.via === 'email-out')
  const quoted = lastEmail?.text.match(/"([^"]+)"/)?.[1]
  // Threading on the real prior subject carries the shared context implicitly,
  // which is why the body no longer has to try to restate it.
  const subject = quoted
    ? (/^re:/i.test(quoted) ? quoted : `Re: ${quoted}`)
    : contact.agencyName
      ? `Following up — Infinite Solutions / ${contact.agencyName}`
      : 'Following up'

  const body = [
    `Hi ${who},`,
    '',
    'Wanted to pick this back up — would a short call make sense?',
    '',
    `I have time ${nextAvailabilityWindow(now)} if any of those work, and I am happy to fit around your calendar.`,
    '',
    'Best,',
    'Pavan',
  ].join('\n')

  // Internal-only. Assembled for the human editing the draft, never sent.
  const ADMIN = /^(seeded|imported|created|added|migrated|backfilled)\b/i
  const context = recent.find(l =>
    l.via !== 'email-in' && l.via !== 'email-out' && !ADMIN.test(l.text.trim())
  )
  const notes = [
    // owner can be several people ('Ganapathy, Rani') and is the ACCOUNT owner,
    // not the sender — so it is surfaced here for the human rather than being
    // guessed into the signature.
    contact.owner ? `CRM owner: ${contact.owner} — confirm who should send` : '',
    contact.nextAction ? `Next action (internal): ${contact.nextAction}` : '',
    contact.blockedOn ? `Blocked on (internal): ${contact.blockedOn}` : '',
    context?.text.trim() ? `Last logged: ${context.text.trim()}` : '',
    lastEmail ? `Last email: ${lastEmail.date}` : '',
    'Generic scaffold — personalise before sending.',
  ].filter(Boolean).join('\n')

  const overdue =
    contact.nextActionDue !== undefined &&
    (daysSince(contact.nextActionDue) ?? 0) > 0

  return {
    slug: contact.slug,
    to: contact.email,
    subject,
    body,
    edited: false,
    status: 'draft',
    triggerKind: overdue ? 'crm-due' : 'manual',
    agingSince: contact.nextActionDue ?? contact.lastTouched,
    sender: 'Pavan',
    notes,
  }
}

// ── the invariant ─────────────────────────────────────────────────────────────

/**
 * Scaffolding that only the old template produced. A human writing an email by
 * hand does not type these, so matching one means generated text leaked.
 */
const TEMPLATE_TELLS: { re: RegExp; why: string }[] = [
  { re: /It has been \d+ days? since we last spoke/i, why: 'opens with a day count (leads with neglect, and freezes stale)' },
  { re: /The next step we agreed was:/i,               why: 'asserts an agreement that may not exist, and pastes internal shorthand' },
  { re: /Where we left off:/i,                         why: 'template label leaking into prose' },
  { re: /I know this is waiting on /i,                 why: 'pastes the internal blocked_on field' },
]

/** Repo and system names that must never reach a customer. */
const SYSTEM_TELL = /\b(repo|repository|docs\/|src\/|github|commit|branch|Nexus)\b|\.md\b/i

/**
 * Every reason this body must not be sent. Empty array == safe to persist.
 *
 * This exists because the invariant "no internal field reaches the body" was
 * previously only a comment, and the template violated it in two places for
 * months — one of those emails was actually sent (robert-cdt-mmbi, 2026-09-01).
 * A rule the code does not enforce is a rule the code does not have.
 */
export function findInternalLeaks(
  body: string, contact?: Pick<CrmContact, 'nextAction' | 'blockedOn'> | null,
): string[] {
  const leaks: string[] = []

  for (const { re, why } of TEMPLATE_TELLS) {
    if (re.test(body)) leaks.push(why)
  }

  // Verbatim CRM shorthand. Short values are skipped: "Email — demo request"
  // is common enough phrasing that a human could legitimately write it, while
  // "Warm product path — services client with no product conversation started"
  // could only have been pasted.
  for (const [field, value] of [
    ['next_action', contact?.nextAction],
    ['blocked_on', contact?.blockedOn],
  ] as const) {
    const v = value?.trim()
    if (v && v.length >= 12 && body.includes(v)) {
      leaks.push(`contains the internal ${field} verbatim: "${v}"`)
    }
  }

  if (SYSTEM_TELL.test(body)) leaks.push('names a repo, path or internal system')

  return leaks
}

// ── read / write ──────────────────────────────────────────────────────────────

export async function readDraft(slug: string): Promise<FollowupDraft | null> {
  try {
    const raw = await fs.readFile(draftPath(slug), 'utf-8')
    const { data, content } = matter(raw)
    return {
      slug,
      subject: typeof data.subject === 'string' ? data.subject : '',
      body: content.trim(),
      to: typeof data.to === 'string' ? data.to : undefined,
      edited: data.edited === true,
      status: data.status === 'sent' ? 'sent' : 'draft',
      sentAt: typeof data.sent_at === 'string' ? data.sent_at : undefined,
      triggerKind: typeof data.trigger_kind === 'string'
        ? data.trigger_kind as DraftTriggerKind
        : undefined,
      triggerRef: typeof data.trigger_ref === 'string' ? data.trigger_ref : undefined,
      agingSince: typeof data.aging_since === 'string' ? data.aging_since : undefined,
      updatedAt: typeof data.updated_at === 'string' ? data.updated_at : undefined,
      sender: typeof data.sender === 'string' ? data.sender : undefined,
      notes: typeof data.notes === 'string' ? data.notes : undefined,
    }
  } catch {
    return null
  }
}

export async function writeDraft(d: FollowupDraft): Promise<FollowupDraft> {
  // Refuse to persist a body that would embarrass us. Every path that creates a
  // draft — dashboard, API, or an agent writing through this module — goes
  // through here, so this is where the invariant is cheapest to hold.
  const subject = await getContact(d.slug).catch(() => null)
  const leaks = findInternalLeaks(d.body, subject)
  if (leaks.length > 0) {
    throw new Error(
      `Refusing to write draft "${d.slug}" — it leaks internal content:\n` +
      leaks.map(l => `  · ${l}`).join('\n'),
    )
  }

  await fs.mkdir(PATHS.crmDrafts, { recursive: true })
  const next = { ...d, updatedAt: new Date().toISOString() }

  // Build frontmatter — omit undefined fields so the YAML stays clean.
  const meta: Record<string, unknown> = {
    slug: next.slug,
    subject: next.subject,
    edited: next.edited,
    updated_at: next.updatedAt,
  }
  if (next.to) meta.to = next.to
  if (next.status) meta.status = next.status
  if (next.sentAt) meta.sent_at = next.sentAt
  if (next.triggerKind) meta.trigger_kind = next.triggerKind
  if (next.triggerRef) meta.trigger_ref = next.triggerRef
  if (next.agingSince) meta.aging_since = next.agingSince
  if (next.sender) meta.sender = next.sender
  if (next.notes) meta.notes = next.notes

  const fileContent = matter.stringify(`\n${next.body.trim()}\n`, meta)
  await fs.writeFile(draftPath(next.slug), fileContent, 'utf-8')

  const rel = path.relative(PATHS.operationsRoot, draftPath(next.slug))
  const action = next.status === 'sent' ? 'sent' : next.edited ? 'edit' : 'draft'
  try {
    await runCommandArgs('git', ['-C', PATHS.operationsRoot, 'add', '--', rel], 15_000)
    await runCommandArgs('git', [
      '-C', PATHS.operationsRoot, 'commit', '-q',
      '-m', `crm: ${action} follow-up — ${next.slug}`,
      '-m', 'via: dashboard',
      '--', rel,
    ], 15_000)
  } catch { /* nothing staged or git unavailable — janitor sweeps */ }
  return next
}

/**
 * The saved draft if one exists, otherwise a freshly built scaffold.
 * A draft you edited is never silently regenerated out from under you.
 *
 * Phase 12: first-time generation writes to disk immediately so the draft
 * shows up in the /outreach queue the moment you first view it.
 */
export async function getOrBuildDraft(
  contact: CrmContact, log: CrmLogEntry[] = [],
): Promise<FollowupDraft> {
  const existing = await readDraft(contact.slug)
  // Human edits are sacrosanct — never regenerate over them.
  if (existing?.edited) return existing
  // Unedited existing draft: return as-is, don't regenerate on every view.
  if (existing) return existing
  // First view: build and persist to the queue.
  const fresh = buildDraft(contact, log)
  return await writeDraft(fresh)
}

// ── queue ─────────────────────────────────────────────────────────────────────

/**
 * Read all drafts from crm/drafts/, enrich with contact info, compute
 * priority, and return them sorted: open (high→low, oldest first) then sent
 * (newest first).
 */
export async function listDrafts(): Promise<OutreachDraft[]> {
  let files: string[]
  try {
    files = await fs.readdir(PATHS.crmDrafts)
  } catch {
    return []
  }

  const slugs = files
    .filter(f => f.endsWith('.md') && !f.startsWith('.'))
    .map(f => f.replace(/\.md$/, ''))

  const drafts = await Promise.all(
    slugs.map(async (slug): Promise<OutreachDraft | null> => {
      const d = await readDraft(slug)
      if (!d) return null

      // Best-effort contact enrichment — getContact is a plain file read, no lock.
      let contactName: string | undefined
      let contactAgencyName: string | undefined
      let resolvedTo = d.to
      try {
        const contact = await getContact(slug)
        if (contact) {
          contactName = contact.name
          contactAgencyName = contact.agencyName
          if (!resolvedTo) resolvedTo = contact.email
        }
      } catch { /* enrichment optional — draft queue still works */ }

      const agingDays = d.agingSince ? daysSince(d.agingSince) : undefined
      const priority = computePriority(d, agingDays)

      return {
        ...d,
        to: resolvedTo,
        status: d.status ?? 'draft',
        priority,
        agingDays: agingDays !== undefined && agingDays >= 0 ? agingDays : undefined,
        contactName,
        contactAgencyName,
      }
    })
  )

  const valid = drafts.filter((d): d is OutreachDraft => d !== null)
  const open = valid.filter(d => d.status === 'draft').sort(sortDrafts)
  const sent = valid
    .filter(d => d.status === 'sent')
    .sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))

  return [...open, ...sent]
}
