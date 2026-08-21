# Phase 3 — DONE ✅

Committed `13a9de4`. Full UI overhaul: design tokens, layout container, 8-stage status badges, mono font on numerics, per-route skeletons, per-page polish (Overview, Bids, Bid detail, Intel, System, Cron, Library). See commit message for line-by-line breakdown, or run `git show 13a9de4 --stat`.

---

# Phase 4 — From dashboard to daily-operations tool

**Goal**: turn the polished dashboard from "good-looking file viewer" into the tool Pavan actually opens at 7am and uses to *drive* his day. Phase 3 made it look right. Phase 4 makes it *do* the right things.

**Mental model**: every change should answer one of three questions —
1. _"What needs me right now?"_ (action)
2. _"What changed since I last looked?"_ (rhythm)
3. _"Where's that thing I saw last week?"_ (recall)

The current dashboard answers "what's the state of things?" That's necessary but not sufficient for daily use.

**Order of operations**: 4.0 first (every later phase benefits from search). Then 4.1 (decisions) and 4.2 (deadlines) in either order — both are about surfacing action. Then 4.3 (rhythm) and 4.4 (bid-detail UX). 4.5 (mobile) when there's a real chance Pavan opens this on a phone.

---

## Phase 4.0 — Command palette + global search

**Why first**: every other phase benefits. With 36 intel items, 15-tab bids, and 11 reports, "search across everything" is the single biggest productivity win. Pattern: Linear's Cmd+K, Notion's Cmd+P.

**Scope**
- [ ] New shared component: `<CommandPalette>` — modal portal, opens on `⌘K` / `Ctrl+K`. Built with `cmdk` package (~5kb, used by shadcn examples) or hand-rolled with focus trap + arrow nav.
- [ ] New API: `GET /api/search?q=…` — searches across bids (name + status JSON + file contents), intel (filename + content), reports (filename + content), library (filename + content). Returns ranked mixed-type results.
- [ ] Server-side: index lives in memory at startup, rebuilt every 60s (or on-demand via filesystem mtime check). For 50-bid scale we don't need a real search engine yet — a simple substring + word-boundary scorer is fine.
- [ ] Wire up: global keydown listener in `layout.tsx` triggers palette. Esc closes.
- [ ] Result types render with: icon, primary line (title), secondary line (breadcrumb path), keyboard navigation between results, Enter to navigate.
- [ ] Recent searches stored in `localStorage`.

**Files**
- `src/components/shared/command-palette.tsx` (new)
- `src/app/api/search/route.ts` (new)
- `src/lib/search.ts` (new — indexing + scoring)
- `src/app/layout.tsx` (add palette mount + global shortcut)

**Done when**: `⌘K` opens palette anywhere; typing "ftb" returns the FTB bid + any mentioning intel + any mentioning report; Enter navigates correctly; closes on Esc / overlay click.

---

## Phase 4.1 — Decision Center on Overview

**Why**: today the dashboard tells you state. "2 active bids" is not action. "3 decisions waiting, here they are, click to resolve" *is* action. There are already `[HUMAN DECISION NEEDED]` flags scattered through bid markdown files — they're surfaced per-bid but never aggregated.

**Scope**
- [ ] New server lib function `getAllPendingDecisions()` — walks every bid, extracts the markdown lines around each `[HUMAN DECISION NEEDED]` flag (~200 chars context), returns `{ bidName, fileName, lineNumber, snippet }[]`.
- [ ] New component `<DecisionQueue>` on Overview: card listing every pending decision with bid name, file/section, the snippet, and "Open in bid →" link that deep-links to the right tab.
- [ ] Sorted by: bid urgency (deadline asc when 4.2 lands; alphabetical until then), then file order.
- [ ] Counter in PageHeader subtitle: "2 active bids · **5 decisions pending** · 34 critical findings"
- [ ] Empty state if zero: "No decisions waiting — you're clear."

**Files**
- `src/lib/files.ts` or new `src/lib/decisions.ts` (extraction)
- `src/components/overview/decision-queue.tsx` (new)
- `src/app/page.tsx` (wire in)

**Done when**: top of Overview shows a Decisions card listing every pending decision across all bids; clicking one navigates to the right bid + tab; counter updates after decisions are resolved (mtime-driven; manual refresh fine for v1).

---

## Phase 4.2 — Bid metadata extension (deadlines, agency, coverage)

**Why**: bid cards today show name + entity + docs count. The actually-useful info for daily ops is **deadline** ("3 days left!"), **agency** ("FTB"), and **coverage %** ("we meet 78% of requirements"). Those don't exist in `.status.json` yet — schema gap.

**Scope**
- [ ] Extend `BidStatusData` type: add optional `agency`, `deadlineProposalDue` (ISO date), `coveragePercent` (number 0–100), `estimatedValue` (string, freeform).
- [ ] Update `getBidDetail()` + `listBids()` to surface these.
- [ ] UI: new `<BidMetadataPanel>` on bid detail page (top, next to status controls) — editable fields for each, save via PUT to existing `/api/bids/[name]/status` endpoint.
- [ ] `/bids` cards: show "**3 days left**" badge if deadline within 14 days (warning color < 7, danger color < 3); show agency as a chip.
- [ ] `/bids` filter row: add "Sort by deadline" toggle.
- [ ] Overview Bid Pipeline kanban: badge cards with urgent deadline indicator.

**Files**
- `src/types/index.ts` (extend `BidStatusData`)
- `src/lib/files.ts` (return new fields)
- `src/app/api/bids/[bidName]/status/route.ts` (accept new fields)
- `src/components/bids/bid-metadata-panel.tsx` (new)
- `src/app/bids/page.tsx` (display + sort)
- `src/app/page.tsx` (urgency badge on kanban)

**Done when**: editing deadline in bid detail updates `.status.json`; bid cards show countdown; sort-by-deadline reorders; the FTB bid (currently no deadline) and ITN bid can both be edited without breaking other fields.

---

## Phase 4.3 — Activity feed / "what changed since last visit"

**Why**: morning rhythm. When Pavan opens the dashboard at 7am, the most useful thing is "here's what changed overnight" — new intel, completed scans, modified bid files. Today nothing surfaces this.

**Scope**
- [ ] Track per-resource `mtime` in existing scans (already collected — just exposed differently).
- [ ] Persist "last visited" timestamp client-side in `localStorage` per page (or one global timestamp).
- [ ] New component `<WhatChangedFeed>` on Overview — lists items modified since `lastVisit`:
  - Newly added intel alerts
  - Bid files modified
  - Scan reports updated
  - Cron jobs that ran (if cron-state JSON has `lastRunAt`)
- [ ] Empty state: "No changes since your last visit at [time]."
- [ ] Items show TimeAgo + click to navigate.
- [ ] On page load, update `lastVisit` after the user has been on Overview for >5s (avoids missing items if they bounce).

**Files**
- `src/components/overview/what-changed-feed.tsx` (new client component — needs `localStorage`)
- `src/app/api/changes/route.ts` (new — returns items with mtime > lastVisit query param)
- `src/app/page.tsx` (wire in)

**Done when**: leaving the dashboard, mirroring fresh data, returning shows the new items highlighted in the feed; clearing localStorage resets the baseline.

---

## Phase 4.4 — Bid detail UX overhaul (sticky tabs, grouping, decisions tab)

**Why**: the FTB bid has **15 tabs**. They overflow the screen and feel undifferentiated. Real workflow: Pavan navigates between Analysis tabs ↔ Response tabs ↔ Submission tabs — there's a phase structure to the work that the tab bar doesn't reflect.

**Scope**
- [ ] Extend `BID_TAB_ORDER` config from flat list to grouped:
  ```
  Analysis:     inventory, requirements, gap-analysis, custom-build-analysis
  Response:     response-strategy, implementation-roadmap, architecture-decisions, response-draft
  Submission:   response-compliance-matrix, response-action-items, submission-checklist
  Ops:          delta-log, response-questions, response-final, response-final-questions
  ```
- [ ] Tab bar renders as: group label (small caps, muted) → tabs in group → separator → next group. Or as two-row: group selector + tab selector. Decide during impl.
- [ ] Make tab bar sticky (`position: sticky; top: 0`) so it stays visible when scrolling long markdown.
- [ ] **New virtual "Decisions" tab** in each bid — aggregates all `[HUMAN DECISION NEEDED]` flags across files for this bid, with snippets and "go to source" links. Pavan can resolve decisions without bouncing across tabs.
- [ ] Per-tab last-modified indicator (subtle, in the tab itself or as a tooltip).

**Files**
- `src/lib/config.ts` (BID_TAB_ORDER → BID_TAB_GROUPS)
- `src/app/bids/[bidName]/bid-detail-tabs.tsx` (grouping + sticky + decisions tab)
- `src/lib/files.ts` (per-file mtime, decision aggregation per bid)

**Done when**: tabs are grouped visually; the Decisions tab shows every pending decision for that specific bid; tab bar stays visible while scrolling content.

---

## Phase 4.5 — Mobile / iPad responsive QA

**Why**: realistic scenario — Pavan checks dashboard on phone at a coffee shop / between meetings / in bed. Today the layout assumes desktop. Sidebar is 224px wide on mobile (eats half the screen), 4-card stat row crams.

**Scope**
- [ ] Sidebar: collapse to drawer behind a hamburger button on `<md` (768px). Slide-out on tap.
- [ ] Stat cards: 2x2 grid on `<md`, single column on `<sm` (375px).
- [ ] Kanban: vertical stack on `<md` (each stage becomes a section, not a column).
- [ ] Bid detail tab bar: dropdown on `<md`, horizontal scroll-snap on `md+`.
- [ ] Markdown content: smaller `max-w-3xl` already adapts well, but verify padding.
- [ ] Library: file tree above content (stacked) on `<lg`.
- [ ] QA at: 375 (iPhone SE), 414 (iPhone Pro), 768 (iPad portrait), 1024 (iPad landscape).

**Files**
- Most page-level files touched lightly; sidebar refactor is the biggest change.

**Done when**: every page is usable at 375px wide without horizontal scroll; tap targets are >=44px; the sidebar drawer works.

---

## Parking lot (not Phase 4 scope, but tracked here so they don't get lost)

- **Intel filtering**: chips for category (procurement/policy/competitor/tech), date range, severity. Today 36 alerts in one flat list scales badly.
- **Read state for intel**: mark as read / unread; default the latest day expanded.
- **Saved views / pinned items**: pin a bid to the top of the list; pin an intel item for follow-up.
- **Notifications**: Slack webhook on new critical finding or new HUMAN DECISION NEEDED flag.
- **AI-generated daily summary**: top-of-Overview blurb generated overnight ("Today: FTB submission deadline in 3 days. 2 new critical findings in test-coverage-gaps. ClearSky Federal hire is worth noting."). Could use Anthropic API or just stitch from existing data.
- **Multi-entity switcher**: top-bar selector for Infinite Solutions / NovaEra / InfiniteAI to filter the whole dashboard.
- **Top-bar enhancements**: notification bell, breadcrumb trail, "you're viewing as" pill.
- **Keyboard shortcuts everywhere**: `/` focus palette, `J/K` navigate cards, `gh` go home, `gb` go bids.
- **Library**: full-text search across content (not just filenames), preview on hover in the tree.

---

_Phase 4 plan written 2026-05-22 based on session context: 2 real bids, 36 real intel alerts, 11 real reports, 0 cron jobs (yet), single-user MacBook + Mac mini setup over Tailscale._

---

## Adjacent — Relationships section (2026-05-26)

Added a new top-level "Relationships" nav section with two pages, sitting between Intelligence and System:

- **/agencies** — grid of agency cards from `~/repos/operations/intelligence/agencies/*.md`. Each card shows priority badge (high/medium/low, sorted high→low) + contact count derived from emails in the file. Search bar filters by name. Click → `/agencies/[slug]` renders the full profile with emails as `mailto:` links and US-format phones as `tel:` links.
- **/partnerships** — quick-glance card stack from `~/repos/operations/intelligence/partnerships/tracker.md`. Splits on H2 headings; each partnership becomes a card with status badge (Active / In Contact / Potential / Unknown) and clickable contact emails.

Both directories may not exist on disk yet — pages render empty state with onboarding hint until files appear. Existing pages (intel, library, bids, health) are untouched: `MarkdownRenderer`'s new `linkifyContacts` prop is opt-in and defaults to off. Phone-link rendering required overriding `react-markdown`'s default URL transform to allow `tel:` (mailto was already allowed).

---

# Phase 5 — The Well-Oiled Machine

**Rewritten 2026-08-21.** Supersedes the same-day Phase 5 draft; every load-bearing finding
is carried forward. Origin: the GTM gap analysis (2026-08-20, `operations/gtm/`) + the
source-of-truth investigation (2026-08-21).

**North star:** Pavan never operates the machine. He talks to it (Telegram), looks at it
(the permanent dashboard URL), and lives his day (meetings, calls, email). The machine
captures, files, reminds, and reports on its own. Every failure is loud.

## Design rules — each traces to a real failure found this week

1. **One writable truth.** The mini's working tree, git-versioned, GitHub as hub/backup.
   Clones are workspaces that merge back, never mirrors. *(Retires: rsync drift, orphan
   `.status.json` files, the gtm analysis stranded on the MacBook.)*
2. **One home per fact.** Structured fields live in frontmatter/JSON exactly once; prose
   narrates, never restates; anything shown twice is generated. *(Retires: "no-bid" vs
   "disqualified".)*
3. **Capture at the point of life.** Granola in the meeting, Telegram in the pocket,
   dashboard at the desk. "Go update the file" is never a step. *(Retires: 2 meeting records
   against 39 researched agencies.)*
4. **The machine reports; the human never polls.** 8am brief, event-driven alerts.
   *(Retires: the 87-day invisible block.)*
5. **Silent failure is a bug class.** A watchdog checks the machine's own organs and texts
   when one stalls. *(Retires: caleprocure scan dead since 6/15 unnoticed; Tailscale off
   unnoticed.)*
6. **Drafts are automatic; sends are human.** Decided 2026-08-21. No unattended process ever
   emails an agency CIO.

## Scale doctrine (added 2026-08-21, after Pavan's "every write is a commit?" challenge)

The long-term guarantee is NOT "git forever." It is two pinned invariants plus named exits:

- **People are not the scaling axis; writer nodes are.** All humans and agents write through
  surfaces that funnel into `crm.ts` on the mini — one serialized writer node with a lock.
  Ten users is still one writer. Humans never touch files directly, so git's hard problem
  (concurrent working-tree writers, human merge conflicts) is designed out, not survived.
  Attribution is a field on every write (`via: rani@dashboard`), carried into commits.
- **Facts vs events.** Files hold facts: current state + curated history. Event streams
  (email opens, telemetry, raw scan output) NEVER enter git — they stay in logs/DB and agents
  distill them into facts (caleprocure already does this: 228 events -> 14 curated).
- **Volume math:** aggressive success ~= 100 writes/day ~= 36K commits/yr. Git carries the
  Linux kernel's 1.3M commits; a commit is ms and O(changed files). If log noise ever
  bothers, batch commits per N minutes in the lib — a knob, not a redesign.
- **Domains have native homes.** Engineering = its own git repos (the platform repo already
  runs this exact files-in-git pattern for plans/phases). Finance ledger graduates to real
  accounting software when real. Operations/growth/CRM = this store.
- **Obsidian (asked 2026-08-21): optional read-only viewer, never a write surface.** The
  store is already vault-compatible (markdown + frontmatter), so Obsidian can open a clone
  any time for browsing — but hand edits bypass `crm.ts` (no enum validation, no
  last_touched bump, no attribution, no semantic commit), and Obsidian Sync over a
  git-synced folder = two sync systems fighting (the rsync disease again). A personal
  thinking vault is fine as a SEPARATE vault; if wanted later, an agent can watch a
  `#promote` tag there and distill facts into the store — one more writer, zero redesign.
- **Graduation triggers (falsifiable), and the exit:** joins/aggregation beyond a morning
  scan at ~tens of thousands of entities; row-level permissions; a second writer MACHINE;
  sustained ~1 write/sec. When one fires: storage swaps to SQLite on the mini behind the
  unchanged `crm.ts` interface; git demotes to audit/backup export (nightly snapshot commit).
  No surface changes. Bounded exit cost is the actual long-term design.

## Milestones

| # | Name | Build time | Gated on |
|---|------|-----------|----------|
| M0 | Truth + plumbing | ~half day | 2 status answers, GitHub OK |
| M1 | CRM store + hands | 2–3 days | M0 |
| M2 | Surfaces (Telegram, brief, Granola, watchdog) | 1–2 days | M1 + Granola signup |
| M3 | Flow-through (leads in, drafts out) | ~2 days | M2 + RFO-site answer |
| M4 | Rhythm | ongoing | M3 |

### M0 — Truth + plumbing ✅ COMPLETE 2026-08-21

- [x] Run `scripts/mini/diff-data.sh` (read-only) for the full divergence report first.
      *Divergence surfaced during adoption instead — bigger than expected: **26 stranded files** (FTB response drafts incl. response-final.md + compliance matrix, ITN working files, 8 intel briefings, Mar–May 2026), not just 3. 24 recovered in `a1ca540`; 2 picker-test files dropped.*
- [x] Reconcile status schema → `status` + `stage` + `reason`:
      FTB = `status: submitted, stage: pre-response` (both records were true — one field
      carried two facts). ITN-37485 = `lost` or `no-bid` per Pavan's answer, with
      `reason: "did not meet LLM ownership requirement"` either way.
      *Done: ITN = `lost`/`closed`, reason `disqualified: did not meet LLM ownership requirement` (Pavan: submitted then disqualified). FTB = `submitted`/`pre-response`. `Lost` already canonical in `BID_STATUSES` — zero code change.*
- [x] Orphans: push `gtm/` analysis up to the mini (keep); `_templates/.status.json` is
      harmless (`listBids` skips `_` dirs).
      *Done via adoption commits `f5e5fa3` + `a1ca540`.*
- [x] Move `branding/` (135MB static assets) out of operations → mini-side `~/repos/branding`.
      Living data is then ~13MB of text.
      *Done: mini-side `~/repos/branding`.*
- [x] `git init` on the mini → initial commit → **private** GitHub repo → push.
      *Done: genesis `0a741a9`, private repo github.com/Pmurugesh/operations, mini deploy key (write) + `github-operations` SSH alias (matches mini's per-repo key convention).*
- [x] MacBook: retire the rsync; `git clone` in its place. rsync command is dead forever.
      *Done: `~/repos/operations` is now a git clone (https + gh credential helper); old mirror preserved at `~/repos/operations.pre-git-backup`.*
- [x] Mini automation: writers commit semantically via lib; an `fswatch` janitor sweeps
      stragglers every ~5m; push with retry; pull cron (~5m) so MacBook-authored commits land.
      Truth never depends on GitHub being up — hub is transport + backup only.
      *Done (janitor half): `~/bin/operations-janitor.sh` + LaunchAgent `com.paladin.operations-janitor`, every 120s: add → auto-commit → pull --rebase --autostash → push. Semantic commits arrive with crm.ts in M1.*
- [x] Permanent URL LIVE: https://paladins-mac-mini.tail722dc1.ts.net → proxy :3000.
      Serve feature enabled on the tailnet by Pavan 2026-08-21; cert minted; verified 200
      from the MacBook. (tailscale **serve** only; NEVER funnel — the app has no auth.)
- [x] Verified 2026-08-21: mini write → janitor commit `10669a3` → GitHub → MacBook pull,
      content matched; reverse direction proven by adoption commits (`f5e5fa3`, `a1ca540`);
      janitor loaded in launchd (120s interval). Phone bookmark: on Pavan.

### M1 — CRM store + hands ✅ COMPLETE 2026-08-21 (PR #6)

- [x] Store: `operations/crm/{contacts,meetings,drafts,leads}/`.
- [x] Contact schema (frontmatter + appended `## Log`): name, title, email, phone, agency,
      product, owner, tier, `stage` (identified | contacted | meeting-booked | demo-given |
      pilot-discussion | won | lost | disqualified), `status` (active | blocked | dormant),
      `blocked_on`, `last_touched`, `next_action`, `next_action_due`.
      `blocked_on` + `last_touched` are the two load-bearing fields.
- [x] Idempotent seed: priority-outreach (8) + agency profiles (39) + CIO Academy (~100 dedup).
- [x] `src/lib/crm.ts`: list/get/write/appendLog; atomic temp+rename; **every write = a git
      commit with a semantic message** ("log touch: chris-rouse via dashboard") — git log IS
      the touch history.
- [x] API: `GET/POST /api/crm/contacts`, `GET/PATCH .../[slug]`, `POST .../[slug]/log`.
- [x] Today page buckets, in order: Overdue → Blocked (days-blocked counter) → Due today →
      Going cold (>21d, active stages) → New leads → Meetings to triage. Mono day-counters,
      severity-colored. Inline actions: log touch / stage / block-unblock / snooze / reassign.
- [ ] Retire hand-edited `priority-outreach.md` → generated from the store (agents keep the
      view they already read). *Deferred to M2: the 8am cron reads it, so regenerate and
      repoint in the same change rather than breaking the brief in between.*
- [x] Verified 2026-08-21: seeded 94 (2 blocked / 6 overdue @85d / 86 cold); live PATCH
      unblock produced `crm: Manohar Sridharan: cleared blocked_on, status=active` and moved
      bucket; appendLog bumps last_touched + advances stage + clears the action; rendered in
      browser; synced to the mini (94 contacts, HEAD matches).
      Two real bugs found and fixed: lock misreporting non-EEXIST errors as contention, and
      `# Name` title accretion on every round trip.

### M2 — Surfaces into the day

- [ ] Telegram verbs on `main`: `overdue`, `today`, `blocked`, `log <contact> <note>`,
      `snooze <contact> <days>`, `draft <contact>` — same crm semantics as the app. Every
      Telegram-triggered write is confirmed by **file read-back**, never exit code
      (`openclaw agent` exits 0 even when the LLM call fails).
- [ ] Repoint `sales-daily-bid-review` (Capture, `0 8 * * 1-5`, → `telegram:8097059385`) at
      the contact store: the 8am brief = overdue + blocked + due + going-cold + top-3 actions.
      It has been faithfully briefing on a file that died in May.
- [ ] Granola — **gate: Pavan signs up (granola.ai/mcp-signup) + installs the app on the
      MacBook** (capture device; the mini never runs the app). Mini cron pulls via MCP/API
      with its own credential (headless runs do NOT inherit the claude.ai connector) →
      `crm/meetings/` → attendee match by email → bump `last_touched` → action items to the
      triage bucket (never straight to `next_action`); unmatched attendees → draft-contact
      review queue. Idempotent by meeting UUID.
- [ ] Watchdog cron (the nervous system): scan freshness, git push/pull age, Anthropic credit
      balance (a low balance silently broke intake once, 2026-06-12), disk, dashboard service
      up → Telegram alert on anomaly, silence when healthy.
- [ ] Verify: text "log rouse test" → file change lands on the mini + ack; deliberately stop
      a cron → an alert arrives.

### M3 — Flow-through: leads in, outreach out

- [ ] Fix `caleprocure-scan` 600s timeout. Last output 2026-06-15: 228 events → 14 curated
      with IDs/deadlines/actions. Good scanner, dead cron — the cheapest pipeline win.
- [ ] Scan output → `crm/leads/` with triage verdicts (bid / skip / watch), not intel alerts.
- [ ] **Gate: which RFO site?** Add the prequalified-channel scan (TDDC / IT MSA RFOs — the
      channel we are prequalified for; CSCR is the open market where ITN-37485 was lost).
      Investigated 2026-08-21: `Qual_table_automations` has NO scraper; its only external
      refs are the DGS TDDC MSA page and `osi.ca.gov`. Do not build until the source is named.
- [ ] Drafts: Voice → `crm/drafts/` → dashboard review (recipient, subject, body, context
      used) → mailto/copy send (no connector needed to start) → sending auto-logs the touch
      and clears `blocked_on` when the draft was the blocker.
- [ ] Verify end-to-end: lead → triage → draft → send → touch logged, all in git history.

### M4 — Rhythm

- [ ] Friday pipeline briefing cron: stage movement, aging, win/loss, next week's focus.
- [ ] Bid `.status.json` adopts the same status+stage+reason schema (one schema everywhere).
- [ ] Absorb Phase 4.0 (search) + 4.5 (mobile QA) where they serve daily use.
- [ ] Calendar + email-reply ingestion stay deferred **writers** — adding one later is one
      more writer into `crm/`, zero redesign.

## Coordination budget — everything Pavan ever has to do

**Once:** answer 2 status questions · OK the private GitHub repo · Granola signup + app
install · name the RFO site · approve 2 mini scripts.
**Daily:** read one 8am brief · one-line Telegram replies as life happens · click send on
drafts · desk triage when convenient.
**Never:** edit a markdown file · run a sync · remember a follow-up · wonder whether a cron ran.

## Open gates

1. ITN-37485: submitted-then-disqualified (`lost`) or pulled-out-first (`no-bid`)?
2. FTB: confirm `status: submitted, stage: pre-response`.
3. Private GitHub repo for operations: OK?
4. Granola signup + MacBook app install.
5. RFO site name.

## Review
(to be filled in per milestone)
