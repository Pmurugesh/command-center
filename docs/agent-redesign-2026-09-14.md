# Agent redesign — 2026-09-14

Six agents, six deep dives, each measured from the session transcripts on the mini, the
cron store, the operations repo and the dashboard code. This document is the synthesis: what
each agent does today, the one business problem it should own, the redesign, and the plan.
The per-agent evidence (session ids, dates, token counts) is in the audit transcripts; the
numbers quoted here are the measured ones.

## The finding that applies to all six

Every agent narrates and none of them moves a record. Thirty days of transcripts show 19
Telegram briefs from Capture that produced zero touches, a weekly Scout essay nobody acted on,
a Forge scan that grep-counts the same numbers weekly, 18 Voice suggestions with zero outcomes,
a Scribe pass that produced 17 action items nobody checked, and a Paladin that let the DWR
meeting and the Robert Payne send die in the chat. Meanwhile the two things that did move the
business (the CalHHS RFI, the Sep 1 follow-up) came from Pavan's own sessions and one dashboard
click.

Cost was never the problem: the five specialists together spend about $40 a month. The waste
was in the main agent (fixed today: heartbeat off, cache retention) and in attention: 105
Telegram messages a week for one send.

Three sensors are wrong, and no prompt fixes a sensor:

1. **The mailbox is blind to what you send.** One message in Sent in 30 days. The Robert Payne
   follow-up exists in the CRM only because you clicked mark-sent.
2. **Granola does not see your sales meetings.** Zero business meetings entered it after Aug 20;
   both OEIS meetings reached the CRM by recall on Sep 8.
3. **The team has no write path.** Ganapathy, Rani and Isaiah own 85 contacts and cannot log a
   touch.

Two facts need you today, before any of this: Microsoft has been mailing the
4infinitesolutions.com tenant "past due invoice" notices since Aug 31 (the mailbox goes down if
it lapses), and the CaleProcure supplier password sits in plaintext in an old intel session log
on the mini (rotate it; I will scrub the file on your word).

## One line per agent

| Agent | Today | Owns after the redesign | Definition of good |
|---|---|---|---|
| **Paladin** (main) | 91 messages from you in 30 days; 12 were facts about deals, most died in the chat; did not know who Pindy was on Sep 9; 910 HEARTBEAT_OKs | Nothing you say about a deal dies in the chat, and nothing owed to a contact ages silently | Any message naming a contact is preceded by a read; any fact you state becomes an API write in the same turn, quoted back with its path; "what do I owe" answers carry count, age, path; replies under 600 chars |
| **Capture** (sales) | Daily brief with 71% overlap day to day, 5 of 7 spot-checked claims wrong, never read the three unsent drafts, zero touches attributable to it | Every live deal has a send-ready follow-up in front of you, and your one word becomes a logged touch the same day | 0 drafts older than 3 business days; every contact at pilot-discussion or later touched within 14 days; no digest item repeated more than two mornings without a state change |
| **Scout** (intel) | Two crons wrap a script dead since July (SIGKILL every run); weekly essay nobody acts on; competitors dead since June; the EDD lead closing Sep 21 never became a lead | The deadline board: every open solicitation either entity could answer is a scored row with a close date, gone the day it closes | Every event scoring 40+ on either lens in crm/leads within one weekday; zero expired leads; intel messages per week 3 or fewer |
| **Forge** (product) | Weekly grep-count scan at Monday 03:00 that describes the previous week; 88 of 116 dead citations in operations are its files; consumed once (you closed 15 findings in an afternoon) | Distance from "demo tenant live" and "BidPro live", against the definitions already in the roadmap and DECISIONS.md | Two overwritten readiness files with a frontmatter of observed facts, every row citing a path and a ref; a roadmap proof cites them within 14 days |
| **Voice** (voice) | 18 suggestions, 0 outcomes; Friday review flagged the same unfixed tag three weeks running; the only one-pager was written by you | Every artifact Phase 0 and the SLP need exists, is current against the registry and the price book, and is one approval from public | GovHire and Reporting one-pagers by Sep 21 with every claim citing _platform-knowledge.md; truth-pass branches on both website repos the same week; content resumes only after one outcome is recorded |
| **Scribe** (scribe) | 1,806 ticks, 6 that staged anything; 1 CRM touch filed in 30 days; 17 unchecked action items; enrichments nothing reads; team mail invisible | No inbound from a pipeline contact goes unnoticed, and every outbound touch by anyone on the team is in the CRM within an hour | Median 15 minutes from an inbound to a log line; sent-folder coverage 100%; next_action_due never earlier than the last outbound touch |

## The redesigns

### Paladin: file what he says, answer with a ledger, route the rest

- **Trigger.** Your Telegram messages. No heartbeat (every notify row is a cron). Dashboard
  intake stops targeting main (it has never reached any agent; see Scribe).
- **Reads before answering.** NOW.md on any deal turn; a person's name means the contact file;
  a bid name means its status file; "draft" means crm/drafts. Never from memory.
- **Writes, all via the dashboard API.** A touch or debrief line (`POST .../log`); next action
  and due date after your yes; a new person you name as a `research` contact; a meeting note
  file; draft edits and mark-sent. Nothing else: no cron, no session spawn, no openclaw
  commands, no dashboard code.
- **Delegation.** Follow-up emails it writes itself in your voice. Documents and analyses go to
  the specialist; one delegation per turn; no pollers.
- **Model.** Opus 4.6 for the chat, thinking off (you iterate, you do not wait); the opus-4-7
  override dropped or given 1h cache retention.
- **New sections in AGENTS.md:** "Before you answer", "Filing what Pavan tells you", "Reporting
  to Pavan", "Never". Full text is in the audit; nothing else in the file changes.
- **Sunday.** One deterministic script (see Scout) writes the Sunday message: owed to contacts,
  unsent drafts, leads closing, bids closing, open decisions, campaign pace. Zero tokens.
- **Cost.** From about $80 a month to about $20.

### Capture: the send queue

- **Delete** `sales-daily-bid-review`. **Add** `sales-morning-digest` (08:00 weekdays): a diff
  since yesterday, not a review. Sections: waiting on your word (one line per draft, reply
  `sent <slug>`, `no <slug> <why>`, `later <slug> <date>`), changed since yesterday, broken
  (cron errors only), still true (at most three lines). Empty sections vanish; a draft listed
  three mornings moves to Friday only.
- **Add** `sales-draft-readiness` (07:40 weekdays): for each unsent draft, run verify-drafts
  and verify-claims, check recipient, sender, thread and internal-field leaks, and PATCH the
  draft with `ready`, `checks`, `why_now`. Once per draft.
- **Rewrite** the Friday brief to numbers from the API: touches by channel, drafts sent and
  waiting, stage moves, bids and leads inside 14 days, campaign pace, three items with
  API-checkable done conditions.
- **granola-sync** stays as configured on Sep 10; strip session-spawn, cron, web and write
  tools from its allow-list (it edited its own cron job on Sep 1).
- **Model.** Sonnet 4.6, thinking low, light context, tools read and exec only.
- **Cost.** About $7 a month, versus $10 today. The point is the queue, not the dollars.

### Scout: the deadline board

- **Delete** `daily-intel-scan`. **Convert** `weekly-strategic-briefing` to a command job
  running `scripts/sunday-brief.ts`: assembled from files already in the repo, one page,
  Sunday 20:00, to Telegram and the dashboard. This is also Paladin's Sunday message.
- **Add** `intel-watch-sources` (weekdays 06:00, command): fetch a fixed list of pages (CDT
  newsroom, governor's newsroom, DGS SLP page, AB 412), hash, write and announce only on change.
- **Fix** lead-sync: skip events past their close date, mark stored rows expired, add a 16:00
  run, and write consulting-lens rows for Infinite Solutions (needs your ruling below).
- **caleprocure-scan** announces only new ids; emit a score line the parser reads.
- **Scout itself** runs only on demand from Paladin: a one-page sourced brief on an event id or
  an agency, into intelligence/briefs/. Thinking medium.
- **Delete** competitors/, research-scan.sh, the browser-era alert files; archive the old
  dailies and weeklies so /intel stops presenting them as live; fold intelligence-config into
  CONTEXT.md.
- **Cost.** From about $6 a month to under $1.

### Forge: readiness, not code health

- **Replace** the weekly scan prompt. Mon and Thu 06:00 until the demo tenant is done, then
  weekly. Step one syncs Nexus and fetches qual_table's staging; if neither head moved, reply
  "no change" and stop.
- **Writes** two overwritten files: `readiness/demo-tenant.md` (the eight demo scenarios from
  Nexus plans/hosted-demo-tenant.md, each with seed, runbook step, last verification, status
  and the file that decides it; plus image_builds, seeds_missing, hosted_url, url_verified) and
  `readiness/bidpro.md` (the five sections of a full response, built/partial/absent at
  origin/staging, the four handoff literals, commits since last run). Frontmatter holds only
  observed facts so a roadmap proof can cite them. Never writes done, targets or flags.
- **Delete** the 14 disabled cron rows and the eleven May topic reports; keep the Sep 8 and
  Sep 14 weeklies as the record of the closure. Point /health at readiness/ or retire it.
- **Fix** verify-claims.ts so it runs on the mini (it hardcodes the MacBook's platform path).
- **Cost.** Under $10 a month during the demo sprint, about $4 after.

### Voice: collateral and web truth

- **Delete** `voice-weekly-content-review`; the one real finding (a Small Business tag in the
  IS company profile) becomes a single edit.
- **Disable** `voice-monday-content-ideas` until one suggestion ever carries an outcome.
- **Add** `voice-collateral-gate` (Tuesday 07:00): read the board, pick the first false proof
  it can satisfy (missing one-pager, truth pass, price page), make exactly one artifact, run
  verify-claims on it, log, stop. One-pagers follow candor.md's frontmatter contract; website
  work goes on a `voice/<milestone>` branch in the repos on the mini plus a diff file, never a
  push; your push is the approval.
- **Reads** only the registry, the price book, platform-knowledge sections it cites, candor.md,
  voice-system-prompt.md and RED-LINES. Never the content-engine guides (they name HireCA and
  Echo and are written in em-dashes).
- **Model.** Sonnet 4.6, thinking medium: the only setting that never hit the 60-second idle
  watchdog that killed three of the last four Monday runs.
- **Cost.** $0.50 to $2 a month, versus $5.

### Scribe: reply detection in code, judgment only on a live contact

- **Code, not model.** scribe.ts learns to detect a reply (normalised subject matches a sent
  draft or an outbound log line in 45 days), log it as `replied`, and set next_action_due to
  today; an outbound to a contact resets the due date to send plus 10; mark-sent in the
  dashboard does the same. Review rows older than 30 days go stale.
- **Filter fixes.** The NovaEra domain is `novaerasol.com`; team members who write from
  dmv.ca.gov and gmail are us, not leads; any message touching a CRM address is staged; internal
  forwards that embed a .gov address are staged; the subject-keyword fallback that admitted six
  SMUD expo mails is removed.
- **More mailboxes.** One env file per team Sent folder, or a shared crm@ address the team
  bcc's. Human act, needs your team's passwords or a new mailbox.
- **The model** fires only when an active pipeline contact writes in, with the message, the
  contact record and the last sent draft handed to it in the prompt. Output: one JSON object
  (intent, needs reply today, summary, next action, due, evidence). No file reads, no enrichment.
- **Team write path.** Paladin accepts `log <name>: <text>` and `next <name> <date>: <text>` on
  Telegram and calls the API with `via: telegram-<person>`. Team members get the bot.
- **Cost.** Under $1 a month, versus $27 before the gate.

## Cross-cutting changes

- **Tools.** Every agentTurn job gets an explicit allow-list: read and exec for the
  specialists (plus the granola tools for granola-sync), nothing that spawns sessions, edits
  crons, or reads `~/.openclaw`. Three agents did all three in the last 30 days.
- **Timing.** Nothing else fires at 08:00 with the digest. Forge 06:00, watch-sources 06:00,
  lead-sync 07:30 and 16:00, readiness 07:40, digest 08:00, Voice Tuesday 07:00, Sunday 20:00.
- **Delivery.** The NOTIFY policy becomes enforceable: digest jobs announce, evidence jobs are
  dashboard-only, "nothing changed" is silent everywhere (the sentinel `NOTHING_NEW` for agent
  replies, empty stdout for scripts).
- **Declared crons.** Every job is defined in a JSON spec in this repo and applied by a
  post-deploy installer (create, update, delete), the way delivery and alerts already are. The
  cron store stops being the only copy of anything.
- **Dashboard intake** targets scribe for documents and sales for bids, with a session id, and
  files a receipt the bid page shows.

## Decisions only you can make

1. **Machine sends.** Today no agent sends mail (RED-LINE 3), so the loop ends at you sending
   from your own client and replying `sent`. Phase B would let the dashboard send a verified
   draft on your explicit per-draft `yes <slug>`, with your SMTP app password on the mini. Yes
   or no.
2. **Team mailboxes.** For outbound coverage the connector needs each team member's Sent
   folder (an env file each, holds a password) or a shared crm@ address everyone bcc's. Which.
3. **Team on Telegram.** Give Ganapathy, Rani, Isaiah and Saravanan the Paladin bot for
   `log` and `next` commands, or not.
4. **Infinite Solutions leads.** The lead store is InfiniteAI-only by design; the EDD RFP that
   scored 75 on the consulting lens was dropped by the product lens. Store consulting-lens rows
   with `entity: Infinite Solutions`, or keep the CRM product-only.
5. **Deletions.** The 14 disabled cron rows, the eleven May reports, competitors/, the old
   dailies and weeklies, research-scan.sh, the content-engine guides as a source. Yes to all,
   or name exceptions.
6. **Content stays paused** until one outcome is recorded. Confirm.

## Plan

**Wave 1, by merge, no input needed (this week).**

- command-center: `scripts/sunday-brief.ts`, `scripts/watch-sources.ts`, lead expiry and the
  16:00 run, caleprocure on-change and score line, scribe.ts reply detector and due-date
  advance, mark-sent advances the due date, sync-email filter fixes, drafts PATCH accepts
  `ready`/`checks`/`why_now`, verify-claims platform path override, intake targets, a
  declarative `scripts/mini/cron-jobs.json` plus `install-cron-jobs.sh` in post-deploy that
  creates, rewrites, restricts and deletes the jobs listed above.
- operations: the CONTEXT.md and TOOLS.md sections per agent, the AGENTS.md sections for
  Paladin, NOTIFY rows for readiness and collateral, deletions from decision 5, the Scribe
  domain fix in sync-email's twin list, the one Small Business tag edit.

**Wave 2, one mini session (with the key rotation you already owe).** Drop the opus-4-7
session override or add its cache retention; deny main the cron and session tools; rebuild or
remove the memory index; scrub the intel session file.

**Wave 3, after your decisions.** The send route, the team mailboxes, the team bot, the
consulting-lens leads.

**Measured on Friday Oct 2** (two full weeks after wave 1): drafts older than 3 days, touches on
the two live deals, expired leads in the store, dead citations in readiness/, one-pagers filed,
Telegram messages per week, model spend. Each has a number today; each redesign names the
number it must hit.
