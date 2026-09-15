/**
 * Send route tests — the refusal matrix and the one path that sends.
 *
 * Run:  node --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/send-test.ts
 *
 * Wave 3, decision 1: the dashboard may send a verified draft on Pavan's
 * explicit per-draft yes. "Verified" is a list, and each item on it is a case
 * here: a draft that is not ready, addressed to someone other than the
 * contact, leaking an internal field, carrying an em-dash, already sent, or
 * asked for without the slug repeated, sends nothing and says why. The
 * success path substitutes `send-mail.py --dry-run` through SEND_MAIL_CMD and
 * checks the draft, the CRM log and the follow-up window afterwards. The
 * failure path runs the real script against a closed port and checks the
 * draft is untouched.
 *
 * The store reads its root from HOME at import time, so HOME is pointed at a
 * scratch directory before any module loads.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'send-test-'))
process.env.HOME = home
const opsDir = path.join(home, 'repos/operations')
const contactsDir = path.join(opsDir, 'crm/contacts')
const draftsDir = path.join(opsDir, 'crm/drafts')
const mailEnv = path.join(home, '.config/command-center/mail.env')
await fs.mkdir(contactsDir, { recursive: true })
await fs.mkdir(draftsDir, { recursive: true })
await fs.mkdir(path.dirname(mailEnv), { recursive: true })
// A real repo, so the per-write commits are exercised rather than swallowed.
execFileSync('git', ['-C', opsDir, 'init', '-q'])
execFileSync('git', ['-C', opsDir, 'config', 'user.email', 'send-test@example.invalid'])
execFileSync('git', ['-C', opsDir, 'config', 'user.name', 'send-test'])

const SCRIPT = path.join(repo, 'scripts/send-mail.py')
const DRY = `python3 ${SCRIPT} --dry-run`
process.env.SEND_MAIL_CMD = DRY

async function configure(extra = ''): Promise<void> {
  await fs.writeFile(mailEnv, [
    'IMAP_HOST=mail.example.test', 'IMAP_USER=pavanm@example.test', 'IMAP_PASSWORD=not-a-real-password',
    'IMAP_FOLDERS=INBOX,INBOX.Sent', 'SEND_BCC=crm@example.test', extra, '',
  ].join('\n'), { mode: 0o600 })
}
await configure()

const { sendDraft, sendRefusal, parseSendRequest } = await import('../src/lib/send-mail.ts')
const { readDraft, markDraftSent } = await import('../src/lib/followup.ts')
const { getContact, addDays, today } = await import('../src/lib/crm.ts')
const { SENT_NEXT_ACTION, FOLLOWUP_WINDOW_DAYS, outboundSubjectOf } = await import('../src/lib/scribe-rules.ts')

const NEXT_ACTION = 'Warm product path — services client with no product conversation started'

async function seedContact(slug: string, opts: { email?: string; altEmails?: string[] } = {}): Promise<void> {
  const lines = ['---', `name: Contact ${slug}`, 'agency: cdt', 'agency_name: CDT', 'stage: contacted', 'status: active',
    `next_action: ${NEXT_ACTION}`, "next_action_due: '2026-07-29'"]
  if (opts.email) lines.push(`email: ${opts.email}`)
  if (opts.altEmails?.length) lines.push('alt_emails:', ...opts.altEmails.map(e => `  - ${e}`))
  lines.push('---', `# Contact ${slug}`, '', 'notes', '', '## Log', '', '- **2026-07-20** — email to them: "Prep agenda" _(via email-out)_', '')
  await fs.writeFile(path.join(contactsDir, `${slug}.md`), lines.join('\n'))
}

/** Written raw so a case can seed exactly the file an agent or a hand might have left. */
async function seedDraft(slug: string, fm: Record<string, unknown>, body: string): Promise<void> {
  const meta = { slug, subject: 'Re: Prep agenda', edited: true, status: 'draft', ...fm }
  const yaml = Object.entries(meta)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? JSON.stringify(v) : String(v)}`)
  await fs.writeFile(path.join(draftsDir, `${slug}.md`), ['---', ...yaml, '---', '', body, ''].join('\n'))
}

const CLEAN_BODY = 'Hi Robert,\n\nWanted to pick this back up. Would Tuesday through Friday (Sep 15-18) work for a short call?\n\nBest,\nPavan'
const GOOD = { to: 'robert@cdt.ca.gov', ready: true }

async function refused(slug: string, body: unknown, status: number, pattern: RegExp): Promise<void> {
  const out = await sendDraft(slug, body)
  assert.equal(out.status, status, `${slug}: ${JSON.stringify(out.body)}`)
  assert.match((out.body as { error: string }).error, pattern, slug)
  const after = await readDraft(slug)
  if (after) assert.equal(after.status, after.sentAt ? 'sent' : 'draft', `${slug}: a refusal changes nothing`)
}

test('the request must repeat the slug and nothing else', async () => {
  await seedContact('req', { email: GOOD.to })
  await seedDraft('req', GOOD, CLEAN_BODY)
  await refused('req', { confirm: 'other' }, 400, /confirm must repeat/)
  await refused('req', {}, 400, /confirm must repeat/)
  await refused('req', { confirm: 'req', extra: 1 }, 400, /Unexpected field/)
  await refused('req', { confirm: 'req', via: 'capture' }, 400, /via must be one of/)
  await refused('req', 'req', 400, /JSON object/)
  await refused('../req', { confirm: '../req' }, 400, /Invalid draft slug/)
  assert.deepEqual(parseSendRequest('req', { confirm: 'req' }), { ok: true, sentBy: 'dashboard' })
  assert.deepEqual(parseSendRequest('req', { confirm: 'req', via: 'pavan-telegram' }), { ok: true, sentBy: 'pavan-telegram' })
  assert.equal((await readDraft('req'))!.status, 'draft')
})

test('no mailbox credentials on this machine is a 503, before the draft is even read', async () => {
  await fs.rm(mailEnv)
  try {
    await refused('req', { confirm: 'req' }, 503, /sending not configured/)
    await refused('nope', { confirm: 'nope' }, 503, /sending not configured/)
  } finally {
    await configure()
  }
})

test('a draft that is not ready, or has no draft or contact behind it, is refused', async () => {
  await refused('missing', { confirm: 'missing' }, 404, /Draft not found/)

  await seedContact('unready', { email: GOOD.to })
  await seedDraft('unready', { to: GOOD.to }, CLEAN_BODY)
  await refused('unready', { confirm: 'unready' }, 409, /not marked ready/)
  await seedDraft('unready', { to: GOOD.to, ready: false }, CLEAN_BODY)
  await refused('unready', { confirm: 'unready' }, 409, /not marked ready/)

  await seedDraft('orphan', GOOD, CLEAN_BODY)
  await refused('orphan', { confirm: 'orphan' }, 404, /Contact not found/)
})

test('the recipient must be the contact\'s own address', async () => {
  await seedContact('addr', { email: GOOD.to, altEmails: ['robert.personal@gmail.test'] })
  await seedDraft('addr', { ready: true }, CLEAN_BODY)
  await refused('addr', { confirm: 'addr' }, 409, /no recipient/)
  await seedDraft('addr', { ready: true, to: 'someone-else@cdt.ca.gov' }, CLEAN_BODY)
  await refused('addr', { confirm: 'addr' }, 409, /not the contact's email \(robert@cdt.ca.gov\)/)

  const contact = await getContact('addr')
  const base = (await readDraft('addr'))!
  assert.equal(sendRefusal({ ...base, to: 'Robert@CDT.ca.gov' }, contact), null, 'case-insensitive match')
  assert.equal(sendRefusal({ ...base, to: 'robert.personal@gmail.test' }, contact), null, 'an alt_emails entry is theirs too')

  await seedContact('noemail')
  await seedDraft('noemail', GOOD, CLEAN_BODY)
  await refused('noemail', { confirm: 'noemail' }, 409, /not the contact's email$/)
})

test('a body that leaks an internal field or a repo path is refused', async () => {
  await seedContact('leak', { email: GOOD.to })
  await seedDraft('leak', GOOD, `Hi Robert,\n\n${NEXT_ACTION}. Shall we talk?\n\nPavan`)
  await refused('leak', { confirm: 'leak' }, 422, /internal next_action verbatim/)
  await seedDraft('leak', GOOD, 'Hi Robert,\n\nThe demo queries are in docs/reporting/caltrans_demo_reference.md.\n\nPavan')
  await refused('leak', { confirm: 'leak' }, 422, /repo, path or internal system/)
  await seedDraft('leak', GOOD, 'Hi Robert,\n\nIt has been 48 days since we last spoke.\n\nPavan')
  await refused('leak', { confirm: 'leak' }, 422, /day count/)
})

test('an em-dash anywhere in what would be sent is refused, naming the USER.md rule', async () => {
  await seedContact('dash', { email: GOOD.to })
  await seedDraft('dash', GOOD, 'Hi Robert,\n\nWanted to pick this back up — would a short call make sense?\n\nPavan')
  await refused('dash', { confirm: 'dash' }, 422, /^body contains an em-dash; USER\.md rule$/)
  await seedDraft('dash', { ...GOOD, subject: 'Following up — Infinite Solutions / CDT' }, CLEAN_BODY)
  await refused('dash', { confirm: 'dash' }, 422, /^subject contains an em-dash; USER\.md rule$/)
  // An en-dash in a date range is fine: the rule is about the em-dash.
  await seedDraft('dash', GOOD, 'Hi Robert,\n\nI have time Sep 15–18.\n\nPavan')
  assert.equal(sendRefusal((await readDraft('dash'))!, await getContact('dash')), null)
})

test('a draft already sent is refused, whoever sent it', async () => {
  await seedContact('done', { email: GOOD.to })
  await seedDraft('done', { ...GOOD, status: 'sent', sent_at: '2026-09-01T01:49:42.804Z' }, CLEAN_BODY)
  await refused('done', { confirm: 'done' }, 409, /Already sent at 2026-09-01/)
})

test('the one path that sends: dry-run script, then the draft, the log and the window all say so', async () => {
  await seedContact('go', { email: GOOD.to })
  await seedDraft('go', GOOD, CLEAN_BODY)
  const out = await sendDraft('go', { confirm: 'go' })
  assert.equal(out.status, 200, JSON.stringify(out.body))
  const sent = out.body as Awaited<ReturnType<typeof readDraft>> & object
  assert.equal(sent.status, 'sent')
  assert.equal(sent.sentVia, 'send-route')
  assert.equal(sent.sentBy, 'dashboard')
  assert.match(sent.messageId ?? '', /^<[^@]+@example\.test>$/, 'the Message-ID the script printed last')
  assert.ok(sent.sentAt)

  const onDisk = (await readDraft('go'))!
  assert.equal(onDisk.status, 'sent')
  assert.equal(onDisk.sentVia, 'send-route')
  assert.equal(onDisk.messageId, sent.messageId)
  assert.equal(onDisk.sentBy, 'dashboard')
  assert.equal(onDisk.body, CLEAN_BODY, 'the body is stored as it was sent')
  const raw = await fs.readFile(path.join(draftsDir, 'go.md'), 'utf-8')
  assert.match(raw, /^sent_via: send-route$/m)
  assert.match(raw, /^message_id: /m)
  assert.match(raw, /^sent_by: dashboard$/m)

  const contact = (await getContact('go'))!
  const line = contact.log.at(-1)!
  assert.equal(line.text, 'Sent follow-up email: Re: Prep agenda')
  assert.equal(line.via, 'dashboard', 'logged with where the yes came from')
  assert.equal(line.date, today())
  assert.equal(outboundSubjectOf(line), 'Re: Prep agenda', 'reply detection still sees it as our send')
  assert.equal(contact.nextAction, SENT_NEXT_ACTION)
  assert.equal(contact.nextActionDue, addDays(today(), FOLLOWUP_WINDOW_DAYS))
  assert.equal(contact.lastTouched, today())

  await refused('go', { confirm: 'go' }, 409, /Already sent/)
  assert.equal((await getContact('go'))!.log.length, contact.log.length, 'a refused re-send logs nothing')
})

test('the yes can come from Telegram, and is recorded as such', async () => {
  await seedContact('tg', { email: GOOD.to })
  await seedDraft('tg', GOOD, CLEAN_BODY)
  const out = await sendDraft('tg', { confirm: 'tg', via: 'pavan-telegram' })
  assert.equal(out.status, 200, JSON.stringify(out.body))
  assert.equal((await readDraft('tg'))!.sentBy, 'pavan-telegram')
  assert.equal((await getContact('tg'))!.log.at(-1)!.via, 'pavan-telegram')
})

test('an SMTP failure is a 502 with the script\'s reason, and the draft stays a draft', async () => {
  await seedContact('smtp', { email: GOOD.to })
  await seedDraft('smtp', GOOD, CLEAN_BODY)
  const logBefore = (await getContact('smtp'))!.log.length
  process.env.SEND_MAIL_CMD = `python3 ${SCRIPT}`
  await configure('SMTP_HOST=127.0.0.1\nSMTP_PORT=1')
  try {
    const out = await sendDraft('smtp', { confirm: 'smtp' })
    assert.equal(out.status, 502, JSON.stringify(out.body))
    assert.match((out.body as { error: string }).error, /SMTP connection to 127\.0\.0\.1:1 failed/)
    assert.doesNotMatch((out.body as { error: string }).error, /not-a-real-password/)
  } finally {
    process.env.SEND_MAIL_CMD = DRY
    await configure()
  }
  const after = (await readDraft('smtp'))!
  assert.equal(after.status, 'draft')
  assert.equal(after.sentVia, undefined)
  assert.equal(after.messageId, undefined)
  const contact = (await getContact('smtp'))!
  assert.equal(contact.log.length, logBefore, 'nothing logged')
  assert.equal(contact.nextActionDue, '2026-07-29', 'window untouched')
})

test('"Mark sent" (sent from his own client) still logs via outreach and opens the window', async () => {
  await seedContact('own', { email: GOOD.to })
  await seedDraft('own', { to: GOOD.to }, CLEAN_BODY)
  const sent = await markDraftSent((await readDraft('own'))!)
  assert.equal(sent.status, 'sent')
  assert.equal(sent.sentVia, undefined)
  assert.equal(sent.messageId, undefined)
  const contact = (await getContact('own'))!
  const line = contact.log.at(-1)!
  assert.equal(line.via, 'outreach')
  assert.equal(outboundSubjectOf(line), 'Re: Prep agenda')
  assert.equal(contact.nextActionDue, addDays(today(), FOLLOWUP_WINDOW_DAYS))
})
