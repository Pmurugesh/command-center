# Scribe Judgment Half (Layer 2B) — Design Proposal

> **Status:** Design only. No code yet.  
> **Author:** Forge 🔧  
> **Date:** 2026-08-24  
> **Context:** M3.5 intake design. Layer 2A (deterministic filer, `scripts/scribe.ts`) is
> live. This document specifies Layer 2B — what a body-reading LLM call adds on top of
> what an exact email-address match proved.

---

## 1. Which Agent Runs This

**Answer: a new `scribe` agent.**

The `scribe` agent is the right home for precisely the reason the todo already articulates:
intake is cross-domain. A single email thread can carry a bid update, an outreach touch,
and a product signal simultaneously. Routing that responsibility to `intel` makes one
domain agent both the bus and a rider. `sales`/`capture` are output agents — they draft
and advise; they shouldn't be reading raw staging directories. `paladin` is interactive.
`forge` is codebase-focused.

`scribe`'s sole job is reading mail evidence and proposing structured interpretations of
it. It never decides anything a human hasn't confirmed. That narrow, non-interactive role
fits an isolated cron agent cleanly: no main-session history needed, no real-time chat
surface required, one trigger every 12 hours. The precedent (`capture`, `forge`, `voice`
each running their own named cron) already exists in the platform.

**Why not reuse `intel`?** `intel` owns the relationship-analysis surface (who to contact
next, why a contact matters). Staging-directory processing is plumbing — it shouldn't
appear in `intel`'s history. Mixing them makes `intel` noisy and makes its context window
grow with pipeline artifacts instead of relationship signals.

**Concrete consequence:** a new `agentId: "scribe"` is registered in the OpenClaw
configuration, paired with a prompt that knows the operations directory layout and the
intake contracts defined here. Its cron is the only place it is triggered; it never runs
on-demand.

---

## 2. Input Contract

### 2a. What the judgment half consumes

The judgment half reads staged files from `crm/intake/email/` — the same directory
Layer 2A uses. It does **not** read any file Layer 2A has not already seen.

**Gate: only files in the main `.ledger` with action `review` or `internal`.**

The main ledger (`crm/intake/email/.ledger`) is the canonical record of what the
deterministic filer decided. Its schema:

```json
{ "<stem>": { "action": "review|internal|touch-in|touch-out|auto-reply", "at": "YYYY-MM-DD", "slugs"?: ["..."] } }
```

Layer 2B only needs to look at two actions:

- **`review`** — the deterministic filer had no exact-match contact for this sender/
  recipient pair. Body may contain signature lines that let us propose a name, title, and
  agency. Body may also reveal that a "review" message is actually a clear engagement
  (e.g., a government contact explicitly responding to a proposal).
- **`internal`** — sender is one of our domains, recipients are all internal or absent.
  Scribe filed it as internal and stopped. But the body might be a forwarded solicitation
  from a government agency (the `e1eb808dc392eac9ee26` case: Murugesh forwarding Jim
  Wang's AI demo invite from DWR — the original has `water.ca.gov` contacts, a meeting
  date, an AI demo context, and none of that surfaced because the outer envelope is
  internal).

**`touch-in` and `touch-out` are explicitly out of scope.** The deterministic filer proved
those. Action items from a known contact's email could theoretically be extracted, but
that is a different feature (contact-level task extraction) not intake judgment.

**`auto-reply` is explicitly out of scope.** Already ledgered as noise.

### 2b. Idempotency: the parallel judgment ledger

The judgment half maintains its own ledger at `crm/intake/email/.judgment-ledger` — a
flat JSON object keyed by the same file stem as the main ledger:

```json
{
  "<stem>": {
    "judged_at": "2026-08-24T14:05:00",
    "outputs": ["triage", "enrichment", "routing-flag"],
    "run_id": "2026-08-24T14:00:00Z"
  }
}
```

Processing logic:
1. Read the main `.ledger`.
2. Collect stems with action `review` or `internal`.
3. Read the `.judgment-ledger`. Skip any stem already present.
4. The remaining stems are this run's work set.

**Why a parallel ledger instead of extending the main one?**

The main `.ledger` is written by `scribe.ts` and checked by `scribe.ts` to determine
what is "new." If the judgment half adds keys to it, the next scribe.ts run would skip
those stems — which is correct for idempotency, but it means scribe.ts is now coupled to
a shape it didn't produce. The main ledger is also append-safe from a single-process
writer (scribe.ts runs synchronously); a separate process writing to it creates a race.
A parallel file sidesteps both problems: each process owns exactly one file.

The `.judgment-ledger` is gitignored alongside `.ledger` (these are machine-local state
files, not operational records).

### 2c. What the judgment half reads per message

For each stem in the work set:

```
crm/intake/email/<stem>.json  →  { message_id, date, from, to, cc, addresses,
                                    subject, matched, body (≤4000 chars), folder,
                                    staged_at }
```

The body is the critical input. The connector already truncated it to 4000 chars. The
agent does not re-fetch from the mailbox; staged files are the only source of truth.

For `review` stems, the agent also reads the current queue entry for that email address
from `email-queue.json` (to know what scribe already distilled: count, date, direction).
This is context, not a gatekeeping dependency — the agent proceeds even if the queue
entry is missing.

---

## 3. Output Contract

### 3a. The triage bucket

**Path:** `crm/intake/triage/email-triage.json`  
**Git-tracked:** yes — same policy as `email-queue.json`. This is a distilled record,
never a body store.  
**Directory:** `crm/intake/triage/` (create if absent).

The triage bucket is a JSON array of triage items. Each item represents one staged
message (not one correspondent — action items are per-message, not per-person).

```typescript
interface EmailTriageItem {
  /** The staged file stem (connector's message hash). Stable, unique. */
  stem: string
  /** YYYY-MM-DD of the original message. */
  date: string
  /** Raw From header. */
  from: string
  /** Subject line. */
  subject: string
  /** Main ledger action that triggered judgment ('review' | 'internal'). */
  ledgerAction: 'review' | 'internal'

  /** Action items the LLM extracted from the body. Empty = none found. */
  actionItems: Array<{
    text: string
    /** 'high' = has a deadline or named next step; 'normal' = informational. */
    urgency: 'high' | 'normal'
    /** ISO date if the body mentions a specific date, otherwise absent. */
    date?: string
  }>

  /**
   * Routing signal for uncertain cases. Absent when the body gives no
   * stronger signal than the ledger action already implied.
   */
  routingSignal?: {
    /**
     * 'forwarded-solicitation' — internal thread wrapping a real government
     *   engagement (the Fwd: ISI AI Demo pattern).
     * 'proposal-response' — someone clearly replying to a bid/RFP/proposal.
     * 'event-invite' — a vendor or government event, not a direct thread.
     * 'noise' — body confirms this is a batch blast or irrelevant; suggest dismiss.
     */
    kind: 'forwarded-solicitation' | 'proposal-response' | 'event-invite' | 'noise'
    reason: string
    /** Counterparty addresses found in the body but not in the envelope. */
    embeddedAddresses?: string[]
    confidence: 'high' | 'medium' | 'low'
  }

  /** When the judgment run wrote this item. */
  judgedAt: string
  /** Which run produced this (ISO timestamp of the cron trigger). */
  runId: string
}
```

**Write contract:**
- The agent appends new triage items to the existing file (read → merge → write).
  It never overwrites a previously-judged item (key on `stem`, same upsert logic as the
  review queue).
- If an existing item for a stem already exists (shouldn't happen given the judgment
  ledger, but defensive), skip it.
- One git commit per run: `intake: triage N message(s)` with `via: scribe-judgment`.

**What the triage bucket is NOT:**
- Not a body store. `text` in action items is the LLM's extracted phrase, not a copy of
  the body.
- Not a decision log. It does not record what Pavan did with each item. Once Pavan acts
  (adds a contact, dismisses, notes an action), the triage item can be archived or
  cleared. That UI gesture is out of scope for v1 — the dashboard renders items and lets
  Pavan act on the review queue separately.

### 3b. Dashboard surface

The existing `/intake` page renders the review queue. Triage items appear in a second
panel on the same page (or a tab), **sorted by urgency then date descending**. Each row
shows: date, from, subject, action items, routing signal confidence. No body is shown —
the body never left the gitignored staging directory.

The triage panel is read-only in v1. The review-queue panel (Add to CRM / Dismiss) is
the action surface. They share the screen because action items on a review-queue row
(someone writing about a proposal) inform whether to add the contact.

**v1 dashboard scope:** render the triage bucket file. No editing of triage items, no
inline action from the triage panel. The human uses the triage output as context when
acting on the review queue.

---

## 4. Enrichment Contract

### 4a. Which fields get enriched

For stems with ledger action `review`, the body often contains a signature block from the
sender. The LLM should extract:

- **`inferredName`** — full name, if the From header only gave an email or a partial
  name. Often the signature says "Bhupinder Kaur" when the From header said "Pindy".
- **`inferredTitle`** — job title from the signature block. "Project Manager",
  "Procurement Analyst", etc.
- **`inferredAgency`** — agency or employer name from the signature, if not already
  inferable from the email domain. Most `.ca.gov` addresses are obvious; the title/agency
  pair is the richer signal.
- **`confidence`** — 'high' / 'medium' / 'low'. High = explicit in the signature.
  Medium = inferred from context. Low = speculative.

### 4b. Where they live

These fields are written back into the **existing `email-queue.json` row** for the
correspondent (keyed by the correspondent's email address = `id`). They extend
`IntakeReviewItem` with optional fields:

```typescript
// Extension of IntakeReviewItem — optional fields added by judgment half
interface IntakeReviewItemEnriched extends IntakeReviewItem {
  inferredName?: string
  inferredTitle?: string
  inferredAgency?: string
  enrichmentConfidence?: 'high' | 'medium' | 'low'
  enrichedAt?: string       // YYYY-MM-DD
}
```

These fields are added to the same `email-queue.json` file via `upsertPending` — or,
more precisely, via a new `enrichReviewItem(email, patch, via)` function in
`intake-review.ts` that does a targeted merge (lock → read → patch-one-item → write →
commit). It only writes if at least one enriched field changed.

**Why inline in the queue instead of a separate enrichment file?**

The queue already owns the "pending review" state. The dashboard reads one file to render
one row. Splitting enriched fields into a parallel file means the dashboard must join two
files to display a complete row, and the enrich/write/commit path becomes a
cross-file transaction. A few optional fields on the existing type is strictly cheaper.

The enriched fields are rendered in the dashboard's "Add to CRM" form as pre-filled
suggestions, clearly labeled "(inferred)" — same UX pattern as the `.gov` domain prefill
already does for agency.

**What if the correspondent was already added to the CRM (status `contact-created`)?**
Skip enrichment for that row. The contact already exists; the enrichment would need to
go to `updateContact` instead, which is out of scope for v1.

---

## 5. Prompt Design

### 5a. Per-message context packet

The agent constructs a JSON context object for each message and sends all work-set
messages in a single prompt (or in batches of N=10 if the set is large). This avoids
N separate API calls for N messages.

```json
{
  "stem": "77cd3649aac15df01c69",
  "ledger_action": "review",
  "date": "2026-08-24",
  "from": "\"KS Saravanan\" <saravanank@4infinitesolutions.com>",
  "to": "\"Kaur, Bhupinder@EnergySafety\" <Bhupinder.Kaur@energysafety.ca.gov>",
  "cc": "NRHQ20-105@resources.ca.gov, gmurugesh@4infinitesolutions.com, pavanm@4infinitesolutions.com",
  "subject": "RE: Security Contract",
  "matched": "government domain energysafety.ca.gov",
  "queue_context": {
    "direction": "out",
    "count": 1
  },
  "body": "<first 4000 chars of body>"
}
```

**What the LLM does NOT see:**
- CRM contact records (that is deterministic knowledge; adding it would grow context
  and blur the LLM's role as a body-reader, not a CRM analyst).
- The full staging directory listing.
- Any previous triage items (no cross-message memory per run).

### 5b. Prompt structure (high level)

The system prompt establishes three tasks and a strict JSON output format:

```
You are a pipeline assistant reading staged business email for InfiniteAI.
Your job is to extract three things, and nothing else:

1. ACTION ITEMS — concrete next steps or time-sensitive events in the body.
   A meeting date with a client is high urgency. An RFI deadline is high urgency.
   A generic newsletter event is normal urgency. Extract text verbatim or
   very close to verbatim; do not paraphrase into advice.

2. ENRICHMENT — for emails where the sender is not yet in the CRM
   (ledger_action="review"), extract name/title/agency from the signature block.
   Only use what is explicitly written. Do not infer from email domain alone.
   Confidence is "high" if explicit in signature, "medium" if strongly implied,
   "low" if a guess.

3. ROUTING SIGNAL — for internal-forwarded threads (ledger_action="internal"),
   identify if the body contains a real government counterparty engagement buried
   inside the forward. Look for .gov addresses in the body, meeting invites,
   proposal discussions. If found, classify as forwarded-solicitation.
   For review messages, classify as proposal-response if the body clearly refers
   to a bid, RFP, or proposal InfiniteAI submitted. Classify as event-invite
   if it is a vendor expo or government event. Classify as noise if the body
   confirms this is a mass blast with no direct thread.

Return a JSON array with one object per message. Schema: [...]
If a field has nothing meaningful, return an empty array or omit the key.
Never fabricate. If unsure, set confidence to "low".
```

The user turn contains the array of context packets for this run's work set.

### 5c. Output schema enforced by prompt

```json
[
  {
    "stem": "<stem>",
    "action_items": [
      { "text": "...", "urgency": "high|normal", "date": "YYYY-MM-DD or omit" }
    ],
    "enrichment": {
      "name": "...",
      "title": "...",
      "agency": "...",
      "confidence": "high|medium|low"
    },
    "routing_signal": {
      "kind": "forwarded-solicitation|proposal-response|event-invite|noise",
      "reason": "...",
      "embedded_addresses": ["..."],
      "confidence": "high|medium|low"
    }
  }
]
```

Fields that do not apply to a given message are omitted (not null). The agent validates
the parsed response against the expected stems before writing any output.

---

## 6. Failure Modes and Read-Back Verification

### 6a. Why exit codes lie

`openclaw agent` exits 0 even when the LLM call times out, returns malformed JSON, or
the API key is invalid. This is a known platform characteristic. The judgment half cannot
rely on exit status; it must verify its own output.

### 6b. Read-back approach

After the agent writes the triage bucket and enrichment patches, a **separate read-back
step in the same agent turn** verifies:

1. **Triage bucket written:** Read `email-queue.json` back from disk. Confirm that the
   stems from this run's work set appear in the bucket with a `judgedAt` within the last
   minute. Count matches vs. expected. If `matches < work_set_size`, log a warning row
   into the run log (see below).

2. **Judgment ledger updated:** Read `.judgment-ledger` back. Confirm the same stems
   are present. If any are missing, the judgment run did not fully commit — the agent
   should not claim success.

3. **Run log entry:** After the read-back, write a run log entry to
   `crm/intake/triage/run-log.jsonl` (newline-delimited JSON, not git-tracked —
   diagnostic only, like `.ledger`):

   ```json
   { "run_id": "...", "at": "...", "work_set": 3, "triage_written": 3,
     "enrichments_applied": 2, "api_call_ok": true, "parse_ok": true,
     "warnings": [] }
   ```

4. **The connector health row:** The existing "Email intake" health panel row is keyed on
   `crm/intake/email/.ledger`'s mtime. Add a parallel health row keyed on
   `crm/intake/triage/run-log.jsonl`'s mtime and last run's `work_set > 0 && triage_written == 0`
   flag. This makes a silent LLM failure visible within one day.

### 6c. Batch failure: LLM returns unparseable JSON

The agent attempts JSON.parse on the LLM response. On failure:
- Log the parse error (truncated) to the run log.
- Do NOT write to the judgment ledger for this run's stems.
- Those stems will appear in the next run's work set and be retried.
- The agent exits normally (does not throw/crash the cron session) to avoid noisy
  failure cascades.

### 6d. Partial batch

If the work set is 8 messages and the LLM returns 5 entries (JSON parses successfully but
some stems are missing), write only the 5 confirmed entries to the ledger and triage
bucket. The 3 missing stems will be retried at the next run. Log the discrepancy.

### 6e. What happens if Anthropic API is down

The LLM call fails or times out. The agent catches the error, writes a failed run log
entry, does not touch the judgment ledger (so no stems are marked as done), and exits
cleanly. Next scheduled run retries. The health row makes a 24h outage visible.

---

## 7. Cron Shape

### 7a. Schedule

**2x daily at 07:00 and 19:00 Pacific time.**

- 07:00 catches mail that arrived overnight before Pavan's morning review.
- 19:00 catches mail from the business day before evening check.
- 12-hour gap is sufficient given the deterministic filer runs every 15 min and
  judgment just reads what the deterministic filer has already classified.
- Not 15-min because every run makes an Anthropic API call. At 2x/day with a typical
  work set of 0–10 messages per run, cost is negligible. At 96x/day it adds up and
  adds no freshness value.

### 7b. OpenClaw cron configuration

```json
{
  "name": "scribe-judgment",
  "schedule": {
    "kind": "cron",
    "expr": "0 7,19 * * *",
    "tz": "America/Los_Angeles"
  },
  "payload": {
    "kind": "agentTurn",
    "message": "Run the Scribe judgment half: read crm/intake/email/.ledger for stems with action 'review' or 'internal' that are not yet in .judgment-ledger, call the LLM to extract action items / enrichment / routing signals, write output to crm/intake/triage/email-triage.json and enrichments back to email-queue.json, update .judgment-ledger, read back to verify, write a run-log entry to crm/intake/triage/run-log.jsonl.",
    "model": "anthropic/claude-sonnet-4-6",
    "timeoutSeconds": 120
  },
  "sessionTarget": "isolated",
  "delivery": {
    "mode": "announce",
    "channel": "<your-channel>"
  }
}
```

**Why `agentTurn` in `isolated` session:**
- No main-session context needed. The judgment half reads files; it doesn't need
  conversation history.
- `isolated` means each run starts clean — no accumulated context from prior runs
  that would grow the token cost of each invocation.
- `announce` delivery means the result appears in the configured channel so a zero-
  triage-written / parse-error run is visible without checking logs.

**Why NOT `systemEvent` to `main`:**
- This is a background pipeline task, not an interactive update. Main session should
  not accumulate pipeline noise in its history.
- `systemEvent` + `main` is correct for heartbeat/reminder patterns, not for a
  standalone cron worker that reads and writes files.

### 7c. API credentials

The Anthropic API key is in the macOS keychain (migrated 2026-08-24). The scribe agent's
system prompt or environment setup must ensure the `ANTHROPIC_API_KEY` environment
variable is populated from the keychain before the `openclaw agent` invocation runs.
The existing pattern (other crons that use Anthropic) sets the precedent; scribe follows
the same env-sourcing pattern.

---

## 8. What Is Out of Scope for v1

These are deliberate deferrals, not oversights. Each is left here so the v2 design has
a starting point.

### 8a. Same-person-different-address linking proposals

The `jothi` case: `llmatscale.ai` + `dmv.ca.gov` are one human, two review rows. The
judgment half could propose "these two addresses appear to be the same person based on
matching signature names" — but that write would affect two queue rows and the CRM
simultaneously, which requires a more deliberate UI (the human confirms a merge, not just
an add). Deferred to a dedicated "deduplication" pass.

### 8b. Dead-address bounce detection

A bounce-driven dead-address flag requires reading MAILER-DAEMON or NDR messages and
patching the CRM contact's email field. It's low-priority relative to the three judgment
tasks above.

### 8c. Action-item write-through to CRM `next_action`

The triage bucket surfaces action items for human review, but does not write them to
`next_action` on any CRM contact. Writing a next_action is a commitment — it belongs to
the human. The triage bucket is a proposal surface only.

### 8d. Processing the historical 257-message backlog automatically

The MacBook's backlog may have messages the judgment half would produce strong signal on.
However, the backlog decision (`Decision for Pavan: file the 257 staged messages?`) is
gated on resolving overlap with `import-engagements.ts`. Judgment would also need to run
on any messages the deterministic filer files on that backlog sweep. This is a one-time
migration concern, not an ongoing design concern.

### 8e. Reply drafting

Drafts-automatic/sends-human is an inviolable rule. The judgment half reads and proposes;
it never writes draft text to `crm/drafts/`. Draft generation is M4 territory (`voice`
agent).

### 8f. Known-contact action item extraction

Action items buried in emails FROM known contacts (ledger action `touch-in`) are excluded
from v1. Those emails are already logged as touches; a separate "action-item extraction
for known contacts" pass could be valuable but is a distinct feature.

### 8g. Confidence-threshold suppression

In v1, all items the LLM returns (including low-confidence ones) appear in the triage
bucket. A future pass could add a configurable confidence floor that suppresses low-
confidence routing signals from the triage panel. Deferred until we can measure false-
positive rates on real data.

---

## 9. Open Questions Before Implementation

1. **Which channel for `delivery.channel`?** The cron announce target should be the
   same channel Pavan monitors — Telegram main, or the dedicated ops channel. Confirm
   before wiring the cron.

2. **Batch size limit?** If the work set ever exceeds 10–15 messages (possible after a
   long gap or a backlog sweep), should the agent process in chunks of 10 per API call,
   or send all at once? Sonnet's context window handles 15 emails easily; chunking adds
   complexity. Propose: chunk at 20, log batch index in run log.

3. **Triage bucket pruning?** The triage bucket will grow without bound if items are
   never cleared. v1 leaves all items in; v2 should archive items older than 30 days
   where status has been actioned. Track this.

4. **Model choice?** `claude-sonnet-4-6` is the default. JSON extraction tasks are well
   within Sonnet's capability and it's cheaper than Opus. Confirm this is the right
   tier for a 2x/day pipeline task.

5. **Gitignore for `.judgment-ledger`?** Add to `operations/.gitignore` alongside
   `.ledger`. Confirm the gitignore pattern is already in place for `.ledger`; if so,
   adding `.judgment-ledger` follows the same line.

---

## Appendix: Real Data Examples This Design Would Handle

### Example A — Forwarded solicitation buried in internal thread
**File:** `e1eb808dc392eac9ee26.json`  
**Ledger action:** `internal` (outer sender = `gmurugesh@4infinitesolutions.com`)  
**Body contains:** Jim.Wang@water.ca.gov organizing an AI demo with ISI, DWR contacts,
Teams meeting link, 2026-08-03 date.  
**Expected judgment output:**
- `routing_signal.kind = "forwarded-solicitation"`
- `embedded_addresses = ["Jim.Wang@water.ca.gov", "Mark.Liu@water.ca.gov", "Robert.Crowell@water.ca.gov"]`
- `action_items = []` (meeting is in the past; the LLM should recognize 2026-08-03 < today)
- `confidence = "high"` (explicit .gov addresses and meeting context in body)

### Example B — Outbound review with meeting action item
**File:** `77cd3649aac15df01c69.json`  
**Ledger action:** `review` (we wrote to Bhupinder.Kaur@energysafety.ca.gov)  
**Body contains:** Meeting Wednesday August 26 at 10:00 AM, agenda with contract discussions
and AI demo, signed by KS Saravanan, Project Manager.  
**Expected judgment output:**
- `action_items = [{ text: "Meeting with Bhupinder Kaur, OEIS Aug 26 10:00 AM — Security Contract + AI Demo", urgency: "high", date: "2026-08-26" }]`
- `enrichment.name = "KS Saravanan"`, `enrichment.title = "Project Manager"`,
  `enrichment.agency = "Infinite Solutions"`, `enrichment.confidence = "high"`
- Note: the enrichment here is for KS (the From sender), who is one of OUR people and
  therefore the enrichment target would be the TO recipient
  (Bhupinder.Kaur@energysafety.ca.gov) for the review queue — the agent must apply
  enrichment to the queue correspondent (the `id` in the queue), not the sender when
  direction is `out`.

### Example C — Event invite noise
**File:** `7db19735b23683e07124.json`  
**Ledger action:** `review` (SMUD Surveys, feedback form)  
**Body contains:** Survey link, "Thanks for attending the 2026 Meet the Buyers Expo."  
**Expected judgment output:**
- `routing_signal.kind = "event-invite"` or `"noise"` (feedback survey, not a direct thread)
- `action_items = []`
- `enrichment` — absent (no signature with title/agency)
- `confidence = "high"` (clearly a batch survey email)
