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

/**
 * Strip log entries that should never leave the company.
 * Repo paths, parenthetical bookkeeping, and internal system names
 * get filtered to a single external-safe sentence or empty string.
 */
function externalSafe(text: string): string {
  let t = text.trim()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;:])\s*([.!?])/g, '$2')
    .trim()

  const stop = t.search(/\.\s/)
  if (stop > 40) t = t.slice(0, stop + 1)

  if (/\b(repo|repository|\.md\b|docs\/|src\/|github|commit|branch|Nexus)\b/i.test(t)) return ''
  return t.trim()
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
 * Compose the scaffold. Each paragraph is omitted rather than guessed when the
 * store has nothing to say — a follow-up with an empty promise in it is worse
 * than a short one.
 */
export function buildDraft(contact: CrmContact, log: CrmLogEntry[] = []): FollowupDraft {
  const who = firstName(contact.name)
  const gap = daysSince(contact.lastTouched)

  const recent = [...log].sort((a, b) => b.date.localeCompare(a.date))

  const lastEmail = recent.find(l => l.via === 'email-in' || l.via === 'email-out')
  const quoted = lastEmail?.text.match(/"([^"]+)"/)?.[1]
  const subject = quoted
    ? (/^re:/i.test(quoted) ? quoted : `Re: ${quoted}`)
    : contact.agencyName
      ? `Following up — Infinite Solutions / ${contact.agencyName}`
      : 'Following up'

  const lines: string[] = [`Hi ${who},`, '']

  if (gap !== undefined && gap > 0) {
    lines.push(
      `It has been ${gap} day${gap === 1 ? '' : 's'} since we last spoke — wanted to pick this back up.`,
      ''
    )
  } else {
    lines.push('Wanted to pick this back up.', '')
  }

  const ADMIN = /^(seeded|imported|created|added|migrated|backfilled)\b/i
  const context = recent.find(l =>
    l.via !== 'email-in' && l.via !== 'email-out' && !ADMIN.test(l.text.trim())
  )
  if (context?.text.trim()) {
    const line = externalSafe(context.text)
    if (line) lines.push(`Where we left off: ${line}`, '')
  }

  if (contact.nextAction) {
    lines.push(`The next step we agreed was: ${contact.nextAction}`, '')
  }
  if (contact.blockedOn) {
    lines.push(`I know this is waiting on ${contact.blockedOn} — happy to help move that along.`, '')
  }

  lines.push(
    'Would a short call this week or next work? Happy to work around your calendar.',
    '',
    'Best,',
    'Pavan'
  )

  // Trigger metadata — crm-due if they have a blown next_action_due, manual otherwise.
  const overdue =
    contact.nextActionDue !== undefined &&
    (daysSince(contact.nextActionDue) ?? 0) > 0

  return {
    slug: contact.slug,
    to: contact.email,
    subject,
    body: lines.join('\n'),
    edited: false,
    status: 'draft',
    triggerKind: overdue ? 'crm-due' : 'manual',
    agingSince: contact.nextActionDue ?? contact.lastTouched,
  }
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
    }
  } catch {
    return null
  }
}

export async function writeDraft(d: FollowupDraft): Promise<FollowupDraft> {
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
