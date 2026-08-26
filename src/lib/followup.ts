/**
 * Follow-up drafting (Phase 11).
 *
 * "Touch: Robert Payne — 27d overdue" told you WHO and HOW LATE, then left you
 * with a blank compose window. This assembles the draft from what the store
 * already knows: the last few log entries, the agreed next action, and whatever
 * is blocking.
 *
 * DETERMINISTIC, not generated. Every line traces to a field or a log entry, so
 * the draft can never invent a commitment you didn't make — the one failure
 * mode that would make this worse than a blank page. It is a scaffold with the
 * facts already in it; the judgement stays yours, and you edit before sending.
 *
 * Nothing here sends mail. The draft is saved for you to copy.
 */

import fs from 'fs/promises'
import path from 'path'
import matter from 'gray-matter'
import { PATHS } from './paths'
import { runCommandArgs } from './shell'
import type { CrmContact, CrmLogEntry } from '@/types'

export interface FollowupDraft {
  slug: string
  subject: string
  body: string
  /** True when the file on disk was edited — never clobber a human edit. */
  edited: boolean
  updatedAt?: string
}

function draftPath(slug: string): string {
  return path.join(PATHS.crmDrafts, `${slug}.md`)
}

function firstName(name: string): string {
  return (name.trim().split(/\s+/)[0] || name).trim()
}

function daysSince(iso?: string): number | undefined {
  if (!iso) return undefined
  const t = new Date(`${iso}T12:00:00Z`).getTime()
  if (Number.isNaN(t)) return undefined
  return Math.floor((Date.now() - t) / 86_400_000)
}

/**
 * Log entries are written for US, and carry things that must never reach a
 * government contact: parenthetical bookkeeping ("date approximate — never
 * recorded"), repo paths, internal file references. Take the first sentence,
 * drop the asides, and bail out entirely if what's left still looks internal.
 * The draft is edited before sending, but the default must be safe on its own —
 * the failure here is an embarrassing email to a client, not a bad UI.
 */
function externalSafe(text: string): string {
  let t = text.trim()
    .replace(/\([^)]*\)/g, ' ')                    // parenthetical asides
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')               // removing an aside leaves " ," behind
    .replace(/([,;:])\s*([.!?])/g, '$2')           // and sometimes doubled punctuation
    .trim()

  // First sentence only — enough to jog memory, short enough to read.
  const stop = t.search(/\.\s/)
  if (stop > 40) t = t.slice(0, stop + 1)

  // Anything still pointing at our own internals is not shareable.
  if (/\b(repo|repository|\.md\b|docs\/|src\/|github|commit|branch|Nexus)\b/i.test(t)) return ''
  return t.trim()
}

/**
 * Compose the scaffold. Each paragraph is omitted rather than guessed when the
 * store has nothing to say — a follow-up with an empty promise in it is worse
 * than a short one.
 */
export function buildDraft(contact: CrmContact, log: CrmLogEntry[] = []): FollowupDraft {
  const who = firstName(contact.name)
  const gap = daysSince(contact.lastTouched)

  // Newest first, so "most recent" means what it says.
  const recent = [...log].sort((a, b) => b.date.localeCompare(a.date))

  // Subject: continue the last email thread when we know it, so the reply
  // threads rather than starting a cold one.
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

  // The most recent substantive entry is the context both sides remember.
  // Administrative provenance ("seeded from a badge scan") is NOT that — it
  // describes how the row got into the CRM, not anything that happened between
  // us, and opening a follow-up with it reads as a form letter. When there is
  // nothing substantive, say nothing: an omitted line beats a misleading one.
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

  return { slug: contact.slug, subject, body: lines.join('\n'), edited: false }
}

export async function readDraft(slug: string): Promise<FollowupDraft | null> {
  try {
    const raw = await fs.readFile(draftPath(slug), 'utf-8')
    const { data, content } = matter(raw)
    return {
      slug,
      subject: typeof data.subject === 'string' ? data.subject : '',
      body: content.trim(),
      edited: data.edited === true,
      updatedAt: typeof data.updated_at === 'string' ? data.updated_at : undefined,
    }
  } catch {
    return null
  }
}

export async function writeDraft(d: FollowupDraft): Promise<FollowupDraft> {
  await fs.mkdir(PATHS.crmDrafts, { recursive: true })
  const next = { ...d, updatedAt: new Date().toISOString() }
  const body = matter.stringify(`\n${next.body.trim()}\n`, {
    slug: next.slug,
    subject: next.subject,
    edited: next.edited,
    updated_at: next.updatedAt,
  })
  await fs.writeFile(draftPath(next.slug), body, 'utf-8')

  const rel = path.relative(PATHS.operationsRoot, draftPath(next.slug))
  try {
    await runCommandArgs('git', ['-C', PATHS.operationsRoot, 'add', '--', rel], 15_000)
    await runCommandArgs('git', [
      '-C', PATHS.operationsRoot, 'commit', '-q',
      '-m', `crm: ${next.edited ? 'edit' : 'draft'} follow-up — ${next.slug}`,
      '-m', 'via: dashboard',
      '--', rel,
    ], 15_000)
  } catch { /* nothing staged or git unavailable — janitor sweeps */ }
  return next
}

/**
 * The saved draft if one exists, otherwise a freshly built scaffold.
 * A draft you edited is never silently regenerated out from under you.
 */
export async function getOrBuildDraft(
  contact: CrmContact, log: CrmLogEntry[] = [],
): Promise<FollowupDraft> {
  const existing = await readDraft(contact.slug)
  if (existing?.edited) return existing
  return existing ?? buildDraft(contact, log)
}
