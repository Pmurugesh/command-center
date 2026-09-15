/**
 * The send route's whole decision, as a function (wave 3, decision 1).
 *
 * RED-LINES rule 3 used to say no agent ever sends. The amended rule: a send
 * happens only on Pavan's explicit per-draft yes, executed by the dashboard's
 * send route, logged with via `dashboard` or `pavan-telegram`. This module IS
 * that route minus the HTTP wrapper, so scripts/send-test.ts can drive every
 * refusal without a server.
 *
 * Every condition below must hold or nothing is sent; the first failure names
 * itself. The body goes out exactly as stored — no field is interpolated at
 * send time, so what was reviewed is what leaves.
 */
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { PATHS } from './paths'
import { getContact } from './crm'
import { runCommandArgsResult } from './shell'
import { fileExists, safeSlug } from './store'
import {
  SENT_BY, findInternalLeaks, markDraftSent, readDraft,
  type FollowupDraft, type SentBy,
} from './followup'
import type { CrmContact } from '@/types'

/** The dashboard can send iff the intake mailbox's credentials exist on this machine. */
export async function isSendConfigured(): Promise<boolean> {
  return fileExists(PATHS.mailConfig)
}

export type SendOutcome =
  | { status: 200; body: FollowupDraft }
  | { status: 400 | 404 | 409 | 422 | 502 | 503; body: { error: string } }

/**
 * `{ "confirm": "<slug>" }`, optionally with `via`. The slug repeated is the
 * explicit yes: a client that posts to the URL by accident, or with the wrong
 * slug in hand, sends nothing. Any other key is refused rather than ignored.
 */
export function parseSendRequest(
  slug: string, body: unknown,
): { ok: true; sentBy: SentBy } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Body must be a JSON object: { "confirm": "<slug>" }' }
  }
  const b = body as Record<string, unknown>
  const unknown = Object.keys(b).filter(k => k !== 'confirm' && k !== 'via')
  if (unknown.length) return { ok: false, error: `Unexpected field(s): ${unknown.join(', ')}` }
  if (b.confirm !== slug) {
    return { ok: false, error: `confirm must repeat the draft slug exactly ("${slug}")` }
  }
  const via = b.via ?? 'dashboard'
  if (!(SENT_BY as readonly unknown[]).includes(via)) {
    return { ok: false, error: `via must be one of ${SENT_BY.join(', ')}` }
  }
  return { ok: true, sentBy: via as SentBy }
}

/** Every reason this draft must not go out now, as (status, reason); null when sendable. */
export function sendRefusal(
  draft: FollowupDraft, contact: CrmContact | null,
): { status: 404 | 409 | 422; error: string } | null {
  if (draft.status === 'sent') return { status: 409, error: `Already sent${draft.sentAt ? ` at ${draft.sentAt}` : ''}` }
  if (draft.ready !== true) return { status: 409, error: 'Draft is not marked ready' }
  if (!contact) return { status: 404, error: 'Contact not found for this draft' }

  const to = draft.to?.trim().toLowerCase()
  if (!to) return { status: 409, error: 'Draft has no recipient (to)' }
  const known = [contact.email, ...(contact.altEmails ?? [])]
    .filter((e): e is string => typeof e === 'string' && e.trim() !== '')
    .map(e => e.trim().toLowerCase())
  if (!known.includes(to)) {
    return { status: 409, error: `Recipient ${draft.to} is not the contact's email${contact.email ? ` (${contact.email})` : ''}` }
  }

  const leaks = findInternalLeaks(draft.body, contact)
  if (leaks.length) return { status: 422, error: `Body leaks internal content: ${leaks.join('; ')}` }

  for (const [field, text] of [['subject', draft.subject], ['body', draft.body]] as const) {
    if (text.includes('—')) return { status: 422, error: `${field} contains an em-dash; USER.md rule` }
  }
  return null
}

/**
 * The command that sends. `SEND_MAIL_CMD` (whitespace-split, no shell) lets a
 * test substitute `python3 scripts/send-mail.py --dry-run`; the default is the
 * real script beside this repo's other scripts.
 */
function sendCommand(): { file: string; args: string[] } {
  const env = process.env.SEND_MAIL_CMD?.trim()
  const parts = env ? env.split(/\s+/) : ['python3', path.resolve(process.cwd(), 'scripts/send-mail.py')]
  return { file: parts[0], args: parts.slice(1) }
}

const SEND_TIMEOUT_MS = 60_000

/**
 * Verify, send, record. Returns what the HTTP route should answer.
 *
 * A failed send leaves the draft exactly as it was (status draft, nothing
 * logged) and reports the script's one-line stderr; the draft is only marked
 * sent after the script has exited 0.
 */
export async function sendDraft(rawSlug: unknown, requestBody: unknown): Promise<SendOutcome> {
  const slug = safeSlug(rawSlug)
  if (!slug) return { status: 400, body: { error: 'Invalid draft slug' } }

  const req = parseSendRequest(slug, requestBody)
  if (!req.ok) return { status: 400, body: { error: req.error } }

  if (!(await isSendConfigured())) {
    return { status: 503, body: { error: `sending not configured: ${PATHS.mailConfig} is missing` } }
  }

  const draft = await readDraft(slug)
  if (!draft) return { status: 404, body: { error: 'Draft not found' } }
  const contact = await getContact(slug).catch(() => null)

  const refusal = sendRefusal(draft, contact)
  if (refusal) return { status: refusal.status, body: { error: refusal.error } }

  // The body travels by file so no shell, quoting or length limit touches it.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'send-draft-'))
  const bodyFile = path.join(dir, 'body.txt')
  let result
  try {
    await fs.writeFile(bodyFile, draft.body, { encoding: 'utf-8', mode: 0o600 })
    const { file, args } = sendCommand()
    result = await runCommandArgsResult(
      file, [...args, '--to', draft.to!, '--subject', draft.subject, '--body-file', bodyFile],
      SEND_TIMEOUT_MS,
    )
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }

  if (!result.ok) {
    const reason = result.stderr.split('\n').filter(Boolean).pop() ?? 'send-mail.py failed'
    return { status: 502, body: { error: reason } }
  }

  const last = result.stdout.split('\n').filter(Boolean).pop() ?? ''
  const messageId = /^<[^<>\s]+@[^<>\s]+>$/.test(last) ? last : undefined

  const sent = await markDraftSent(
    draft, { sentVia: 'send-route', messageId, sentBy: req.sentBy }, req.sentBy,
  )
  return { status: 200, body: sent }
}
