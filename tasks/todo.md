# Phase 5 — Make it trustworthy (the "why don't I use it" fix) — IN PROGRESS

## Diagnosis (2026-07-09, audited live mini + local copy)

The dashboard's plumbing works (launchd service up, openclaw reachable, data flowing),
but the numbers it shows are wrong or meaningless, so there's no reason to open it:

1. **Agents card always shows 0 runs / 0 failed** — openclaw cron JSON puts run state
   in `state.lastRunAtMs` (epoch ms) + `agentId` on the job; the dashboard read
   `state.lastRunAt` (ISO string that doesn't exist) and pattern-matched job names.
   A cron job failed TODAY (caleprocure-scan, 600s timeout) and the dashboard
   shows "idle, 0 failed".
2. **"System Critical" is on permanently** — critical findings counted across every
   scan report ever written (incl. 3 dated runs of the same product-health scan).
   Permanent red = alarm fatigue = ignored.
3. **Every intel alert gets a red "Critical" badge** — detection is
   `content.includes('critical')`, which matches the section header present in
   every scan.
4. **All 4 bids stuck in "Analyzing"** — bid `.status.json` files only exist on the
   MacBook copy, not on the mini where the real dashboard runs. FTB was submitted,
   ITN was no-bid — months ago.
5. **Lifetime counters** ("71 intel alerts total tracked") instead of "what's new".
6. **The most actionable data is buried** — procurement scans contain scored
   opportunities WITH DEADLINES (e.g. EDD RFP due 07/21, score 9/10) rendered as
   collapsed markdown in /intel.
7. **Dishonest empty states** — "All outreach completed ✅" when the file is missing;
   outreach list 6 weeks stale with no age shown; Morning Actions card promises a
   file nothing generates.
8. **Nav is 40% shells** — Finance/Fundraise/Content are "Not built yet" pages at
   full nav prominence.

## Plan

- [x] `lib/cron.ts` — normalize real openclaw cron JSON (lastRunAtMs, agentId,
      consecutiveErrors, lastError, nextRunAtMs); all consumers switch to it
- [x] Agents 24h summary uses agentId + real run state; surfaces failing jobs
      with their error text
- [x] Health = operational health (cron failures), not lifetime finding counts;
      critical findings counted from latest report per scan family only
- [x] `lib/procurements.ts` — parse scored opportunities + deadlines out of
      procurement scans; dedupe across daily files
- [x] Today: Opportunities card (deadline countdowns), "Intel this week" counter,
      pipeline freshness strip, honest outreach empty state + age, Morning Actions
      hidden when empty
- [x] Kanban: "Needs triage" column for status-less bids + inline status set
- [x] Intel feed: Critical badge only when a critical section has actual entries
- [x] Cron page: group by agent, show last error, consecutive failures, duration,
      next run
- [x] Sidebar: Planned section (Content/Finance/Fundraise), collapsed by default
- [x] Decision queue skips closed bids (submitted/won/lost/no-bid)
- [ ] Data fix on mini: write `.status.json` for FTB (Submitted) + ITN (No-Bid) —
      BLOCKED: remote-write permission denied in this session; Pavan can do it
      via the new kanban status dropdowns, or grant the write
- [x] Verify: pnpm build passes; typecheck clean; all 16 routes 200; browser
      walkthrough of Today/intel/health; kanban status-set tested end-to-end
      (wrote + moved card + cleaned up); cron normalizer validated against the
      mini's real `openclaw cron list --json` (2 runs/24h, caleprocure-scan
      failing with timeout error — matches reality)

## Out of scope (flagged to Pavan)

- caleprocure-scan cron is timing out (600s) as of 2026-07-09 — needs a bigger
  timeout or a leaner prompt; fix lives in openclaw cron config, not dashboard
- daily-intel-scan only runs Wednesdays (`0 6 * * 3`) despite its name
- research-scan.sh failing with Claude CLI 401 (per 07-08 alert) — API credits
- Phase 4 (command palette / search) still queued behind this

---

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

### M2 — The daily dashboard ✅ COMPLETE 2026-08-21

**Why rewritten:** the original M2 made Telegram a first-class write surface with a verb
parser (`overdue`, `log`, `snooze`…). Pavan: *"telegram is not a user interface I like too
much, I want something more custom and showing me insights on daily updates."* That inverts
the design. **Telegram demotes to notifications only** (briefs and alerts arrive there; you
never operate through it). The dashboard carries the whole daily loop, so it has to be worth
opening — insight, not just a list.

Also cut, per the same simplicity review: the Telegram verb grammar (an LLM with file access
needs a schema description, not a command parser) and the in-dashboard draft-review UI
(over-built for one person reading a few drafts a week).

- [x] **Momentum strip — the north-star metric.** Touches this week vs last, derived from
      `git log crm/contacts/`. The GTM diagnosis was "0 logged outbound touches in 12 weeks";
      this is the number that says whether that is still true. Everything else on the page is
      secondary to it. Green when it moves, honest when it does not.
      *Built. Touches last 7d vs prior 7d, counted from contacts' own log entries (not commit messages, which are free to change format). `via: seed|rederive|slug-reconcile|verify|…` excluded so the number cannot rise while zero selling happened. Verified live: logging one touch moved 0→1, engaged 0→1, quiet→false. Today it reads 0 with "No outbound touch has ever been logged."*
- [x] **What changed since you last looked.** Now trivial and exact: every change to
      operations is a dated, attributed commit since M0. Reads `git log --since=<lastVisit>`,
      groups by area (contacts / bids / intel / reports). Replaces Phase 4.3's mtime
      heuristic, which was guesswork by comparison.
      *Built as `ChangesFeed` — client-side, since only the browser knows your last visit; marks seen after 5s so bouncing does not silently clear it. Janitor `auto:` commits filtered out.*
- [x] **Leverage panel.** Aggregate `blocked_on` across contacts: "1 artifact (AIHire
      one-pager) unblocks 2 contacts." Turns a list of blocked people into a ranked list of
      things to MAKE. This is the single most actionable view in the CRM.
      *Built. Currently renders: "2 — product one-pager does not exist — Unblocks: Linh Thao Huynh, Manohar Sridharan."*
- [x] **Pipeline shape.** Stage funnel + owner load + product concentration. Current truth:
      94/94 at `identified`, owners Ganapathy 36 / Rani 35 / Isaiah 10 / Pavan 7, products
      prrai 84 / aihire 6 / procurement 4. A flat bar at `identified` IS the insight.
      *Built. Stage / owner load / product bars. The flat `identified=94` bar carries an explicit callout so it reads as a finding, not a rendering failure.*
- [x] **System health inline.** Scan freshness, git sync age, last cron run — on the page, not
      in a separate console. The June-15 dead scanner should have been visible here.
      *Built. Currently: Intel scans **[bad] 37d old** (the dead CaleProcure scanner, finally visible), data sync ok, pushed ok, contact store ok.*
- [x] Keep every number one click from its source. An insight you cannot drill into is a
      decoration.
      *Health links to /system; contacts link through the buckets. Deeper drill-through deferred until a number is actually disputed.*
- [x] Verify: open the dashboard cold and be able to answer "what should I do first, and is
      the machine healthy?" without clicking anything.

### M2.5 — Keeping sales consistent with engineering (REWRITTEN 2026-08-21)

**Origin:** Pavan: *"how are we making sure the marketing/sales/growth is staying consistent
with the engineering."* Slugs were one symptom. The audit found three layers of drift, and the
third is a live risk rather than housekeeping.

**Layer 1 — what exists.** Platform mounts 9 license-gated modules; `products/_overview.md`
listed 5. Missing: `assistants` (**"Steward"** — the "one governed pane" the GTM playbook
leads with), `data-intelligence`, `delivery-management`, `plan-review` (which the playbook
rules OUT as a market — reconcile intent vs code), `web-intelligence`. And `echo` is in the
catalog but is not a platform module.

**Layer 2 — what things are called.** Platform manifest + the GTM playbook both say
**GovHire**; the sales catalog said **HireCA**. A one-pager saying HireCA beside a demo screen
saying GovHire is a credibility problem in front of CalHR. Slugs reconciled 2026-08-21
(prrai→prr, aihire→recruitment, reporting→ad-hoc-reporting; 90 contacts + 3 product docs
renamed; old values kept as `legacy_slug`). **The display-name conflict is still open and is
Pavan's call.**

**Layer 3 — whether the claims are still true.** `bids/_platform-knowledge.md` calls itself a
living document "updated automatically after each bid analysis". Last updated 2026-03-23. It
is the evidence base for capability claims made to the State of California, and **12 of its
cited code paths no longer exist on origin/main**. Across all of operations: 130 dead
citations of 914. Nothing checked, so nobody knew.

**The mechanism: a claim that cites evidence can be verified mechanically — so require every
claim to cite evidence.** Three tiers by how automatable they are:

      *Verified in-browser 2026-08-21: momentum, leverage, shape, health, and the change feed all render; red dot confirmed on the dead scanner; momentum proven to respond to a real touch and then reverted.*
- [x] **Tier 1 — citation verification (BUILT 2026-08-21).** `scripts/verify-claims.ts`
      resolves every backticked code path in operations markdown against the platform's
      `origin/main` (not the checked-out branch — shipped capability means what is on main).
      `--gate` exits non-zero on dead citations in bid-facing files, so it can block a
      submission. Currently: 784 resolved, 130 dead, 12 of them bid-facing.
      *Deliberate limit: it verifies that citations RESOLVE, not that prose is true. It cannot
      tell you "6 export formats" is still accurate; it can tell you the file that claim points
      at is gone. Most of the value for a fraction of the work.*
- [ ] **Tier 1a — triage the 12 bid-facing dead citations.** Each is either a rename to chase
      or a capability that quietly went away. Must be resolved before any bid draws on
      `_platform-knowledge.md` again.
- [x] **Tier 2 — derive the facts that can be derived.** *BUILT 2026-08-24:
      `scripts/generate-registry.ts` parses each module's `MANIFEST = ModuleManifest(...)`
      on the platform's origin/main and regenerates `products/_registry.md` (DO NOT
      HAND-EDIT): canonical slug, display name, version, route, frontend size/file count,
      test count, last touched, manifest citation. Weekly via the MacBook `weekly-sync`
      job (registry then drift-check — replaced the drift-check-only launchd job).
      First run: 9 modules @ bb9986ed — canonical names Steward / Milestone / Attest /
      Candor / Proc / GovHire / Reporting / Data Intelligence / Web Intelligence.
      The GovHire-vs-HireCA class of dispute is now decided by a generated table.*
- [x] **Tier 2a — make status claims checkable.** *The registry's frontend column IS the
      signal: `data-intelligence` 3KB/2 files and `procurement` 4KB/3 files read "thin
      frontend — look before you demo", vs Candor 1.2MB/117 files + 136 tests. Demo-seed
      detection deferred until a demo actually stumbles on it.*
- [ ] **Tier 3 — expire what cannot be derived.** Positioning and market evidence get a
      `verified_on` date; anything older than a quarter surfaces on the dashboard. The GTM
      playbook already models this ("re-verify vendor claims ~quarterly — the evidence is
      dated"); make it enforced rather than aspirational.

**Triggers — the organisational half, and the part that actually prevents recurrence:**
- [ ] Weekly drift report on the mini → dashboard panel + Telegram only when drift appears.
- [ ] **On platform release**: a digest of modules added / renamed / status-changed since the
      last check, routed into operations. Engineering shipped 5 modules sales never heard of
      because nothing carried the news across the repo boundary.
- [ ] **Pre-bid gate**: `verify-claims.ts --gate` runs before any submission. This is the one
      that matters — everything else is hygiene, this one stops a false capability claim
      reaching a procurement officer.

### M3 — Inputs: meetings and leads

- [ ] **Granola sync — gate: Pavan signs up + installs the app on this MacBook** (the capture
      device; the mini never runs the app). Mini cron pulls via MCP/API with its own
      credential — headless runs do NOT inherit the claude.ai connector. Writes
      `crm/meetings/`, matches attendees by email, bumps `last_touched`, and routes action
      items to a triage bucket (never straight to `next_action`; an extracted item is a
      suggestion, not a commitment). Unmatched attendees become a draft-contact review queue.
      Idempotent by meeting UUID.
- [ ] **DO NOT rebuild Cal eProcure scraping — consume the pipeline that already ships.**
      Found 2026-08-21 in `Pmurugesh/qual_table_automations` on `main` (invisible to a
      working-tree grep; it needed an all-refs search): `eprocure_client.py`,
      `eprocure_parser.py`, `eprocure_relevance.py`, `eprocure_discovery_service.py`,
      `bid_discovery.py`, plus design docs and gate-check scripts. Proven end to end
      2026-08-04 against the live site.
- [ ] **The "bot traffic" premise was wrong, and it changes how M3 is built.**
      `caleprocure.ca.gov` is a JavaScript shell that 403s any honestly-identifying client
      (Googlebot included). The host that serves data is `suppliers.fiscal.ca.gov`, which
      answers an honest non-browser client normally. No login, no browser impersonation: an
      honest UA plus the site's OWN anonymous bidder identity (`BIDDER_ID=BID0000001`, …)
      lifted from the share links it generates itself.
      The real failure was **session handling** — attachment URLs are session-bound, and
      fetching one without the cookies that produced it returns an HTML error page at HTTP 200
      that saves under a `.docx` name and looks exactly like a document on disk. That sank four
      earlier attempts, and it is precisely the subtlety not to reimplement in TypeScript.
- [x] **Integration shape: command-center reads, qual-table fetches.** *Scheduled 2026-09-08:
      `lead-sync` cron on the mini, weekdays 07:30 PT, via `scripts/mini/install-bid-sync.sh`;
      first run 2026-09-09. Retire `caleprocure-scan` only after it has produced leads.* The
      qual-table backend
      already exposes list / status / refresh / enrich / documents / adopt. The OpenClaw cron
      calls that API and writes results into `crm/leads/` as triageable rows. One network client
      pointed at a state website, not two — which also keeps the politeness controls (shared
      throttle, daily cap, single-threaded, env-var kill switch) in one place.
- [ ] Retire the current `caleprocure-scan` cron once leads flow this way: it times out at 600s
      and has produced nothing since 2026-06-15; its last good run curated 228 events to 14.
- [ ] Expect ~311 open solicitations statewide per refresh, of which only ~2-3% are plausibly IT
      staffing. Relevance is deterministic RULES (explainable, free, CI-testable), not an LLM
      verdict — and commodity-code prefixes must be >=4 digits or civil engineering pollutes
      the shortlist.
- [ ] **Open question for Pavan:** the qual-table deploy is a free Render web service that
      sleeps when idle and has no cron (their deferred item D-CE-2), so refresh is
      user-triggered there. Decide whether the mini's cron drives the refresh over the API, or
      whether the lead pull just reads whatever the last refresh produced.
- [ ] **Staleness watchdog — a ~20-line script, not a monitoring system.** Checks scan
      freshness, git sync age, API credit balance (a low balance silently broke intake once,
      2026-06-12), and the dashboard service. Surfaces in M2's health panel; Telegram only when
      something is actually wrong.
      *MacBook half built 2026-08-24 (see the outage entry below): the mini-unreachable check
      cannot live on the mini, so it runs here. The mini-side organ checks remain.*

### M3.5 — Intake: the Scribe (designed 2026-08-21, Pavan's ask)

**Origin:** "lets connect my email so updates and context is flowing more cleanly — which
agent should be responsible, or should we create a new gathering agent whose sole job is to
take all the context from these disjoint places into the right category?"

**Decision: yes to the dedicated agent — named Scribe — but make it THIN.** The gathering
job splits into a mechanical half and a judgment half, and the whole session's failure
catalog says never to let an LLM own the mechanical half:

```
Layer 1  CONNECTORS   deterministic cron, NO LLM
         gmail-sync, granola-sync, (calendar later)
         → stage raw items in operations/crm/intake/
         idempotent, change-detected, loud on failure (health panel row)

Layer 2  SCRIBE       one agent, judgment only
         reads staged items and FILES them:
           touch on a known contact  → appendLog with real date, via:email
           unknown person            → draft contact in a review queue
           action item               → triage bucket (never straight to next_action)
           bid/lead material         → linked into bids/ or crm/leads/
           uncertain                 → review queue, never a guess
           irrelevant                → skipped, but LISTED (no silent drops)

Layer 3  DOMAIN AGENTS unchanged — Scout/Capture/Voice consume the store
```

**Why a new agent and not Scout or Paladin:** intake spans every domain (an email thread can
carry a bid update, an outreach touch, and a product signal at once), so giving it to Scout
makes one domain agent both the bus and a rider. Paladin is the interactive router, not a
pipeline. Scribe = one new agent id + one cron, the exact wiring pattern already proven by
Capture/Forge/Voice's per-agent crons.

**Rules that carry over from this session's lessons:**
- **Observation vs commitment** (the thrice-learned one): an email FROM Robert is evidence of
  a touch and gets logged with its real date; a newsletter or a cc is not. Scribe records
  evidence and PROPOSES commitments; only a human confirms one.
- **Deterministic relevance pre-filter at the connector, not the LLM:** only threads
  involving known contact emails, *.ca.gov, or known partner domains get staged at all.
  Granola showed 1 of 5 meetings was even InfiniteAI business; email is worse (personal,
  Bedrock, legal). The CRM's own contact emails ARE the filter — the store curates its own
  intake. Everything else never leaves the mailbox.
- **Inbound only.** No sending. The drafts-automatic/sends-human rule is untouched.
- **Verify by read-back** — `openclaw agent` exits 0 even when the LLM call fails.
- Intake freshness gets a health-panel row; a dead connector must be loud within a day.

**Build order:**
- [x] Gmail API OAuth (or app-password IMAP) on the mini for the AGENCY mailbox.
      *Done 2026-08-24: app-password IMAP against the self-hosted
      `mail.4infinitesolutions.com` (the domain is not on Google), creds in
      `~/.config/command-center/mail.env` on the mini.*
- [x] `gmail-sync` connector: pre-filtered threads → `crm/intake/email/`, idempotent by
      message id, one batch commit. *`scripts/sync-email.py`, live on a 15-min timer.*
- [x] **Scribe, deterministic half (BUILT 2026-08-24)** — `scripts/scribe.ts`, chained
      after the connector in the same 15-min tick. Files on exact email match only:
      inbound from a CRM contact → touch via `email-in` (bumps last_touched, does NOT
      advance stage, excluded from momentum — the contact touched us); outbound to a CRM
      contact → touch via `email-out` (counts as selling — a human wrote it); us→us
      internal threads → ledgered skip (listed, never queued); everyone else → review
      queue. Idempotent by message hash (`.ledger` beside the staging; staged files are
      never moved — the connector dedupes by directory contents). `appendLog` gained
      `advanceStage` + forward-only last_touched (a backfilled 2025 email can no longer
      rewind recency). Found + fixed: `NON_HUMAN_VIA` had drifted between crm.ts and
      insights.ts, so `lead-sync` writes could inflate momentum.
      *Dry-run on the MacBook's 257-message backlog: 11 in / 7 out touches on real slugs,
      212 review messages collapsing to 36 correspondents, 26 internal, 1 auto-reply
      (Wesley's OOO — previously would have logged as him engaging).*
      Edge cases handled deterministically (2026-08-24): `alt_emails` frontmatter — link a
      second address to a contact once and every future message files correctly (the jothi
      case: llmatscale.ai + dmv.ca.gov are one human, two review rows until linked);
      auto-replies/OOO ledgered, never a touch, never queued; duplicate (contact, date,
      text) log entries guarded, so a double-delivered message or a lost ledger cannot
      double-log history. Left for the judgment half: forwarded solicitations buried in
      internal threads, bounce-driven dead-address flags, shared-mailbox labeling,
      same-person-different-address linking proposals.
- [x] Review queue surface on the dashboard. *Per-CORRESPONDENT, not per-message
      (`crm/intake/review/email-queue.json`, committed — distilled facts, never bodies);
      /intake renders pending rows with Add-to-CRM (deterministic prefill: name, address,
      agency from a .gov domain) and Dismiss; a dismissed address stays dismissed when
      they write again. Plus an "Email intake" health row from the connector log's mtime —
      loud within a day, omitted on machines that don't run the connector.*
- [ ] Scribe, judgment half: OpenClaw agent + cron (2x daily) for what a match cannot
      decide — action-item extraction to a triage bucket, draft-contact enrichment
      (title/agency from signatures), uncertain routing. Gated on OpenClaw API credits
      being live.
- [ ] Granola sync folds into the same intake path (Layer 1 exists once, sources plug in).
- [ ] Decision for Pavan: file the MacBook's year-long backlog (the 257 staged messages)?
      One command, but check overlap first — `import-engagements.ts` already hand-logged
      some of the same CDT/LCI/Caltrans touches, and scribe would add near-duplicates.
- [x] GATES: mailbox = `pavanm@4infinitesolutions.com` (closed 2026-08-24).

### M4 — Outputs and rhythm

- [ ] Drafts: Voice writes to `crm/drafts/`; the dashboard lists them for review; send via
      mailto/copy so no mail connector is needed to start. Sending logs the touch and clears
      `blocked_on` when the draft was the blocker.
- [ ] Retire hand-edited `priority-outreach.md` → regenerate from the contact store, and
      repoint `sales-daily-bid-review` (Capture, `0 8 * * 1-5` → telegram) at the store in the
      SAME change, so the 8am brief never reads a dead file. It has been briefing on a file
      that died in May.
- [ ] Friday pipeline briefing: stage movement, aging, win/loss, next week's focus.
- [ ] Bid `.status.json` adopts the same status+stage+reason schema everywhere.
- [ ] Calendar + email-reply ingestion stay deferred WRITERS — each is one more writer into
      the store, zero redesign.

## Coordination budget — everything Pavan ever has to do

**Once:** answer 2 status questions · OK the private GitHub repo · Granola signup + app
install · name the RFO site · approve 2 mini scripts.
**Daily:** open the dashboard (the primary surface) · click send on reviewed drafts · triage
what the machine surfaced. Telegram receives the 8am brief and alerts; you never operate
through it.
**Never:** edit a markdown file · run a sync · remember a follow-up · wonder whether a cron ran.

### 2026-08-24 — The mini went dark, and now something notices

**Found:** the mini has been network-dead most of each day since ~8/22 — asleep except for
scheduled wakes. Evidence: exactly one auto commit per day (03:05, the product-health scan),
Tailscale no-reply even via relay, dashboard/SSH/intake all unreachable from the MacBook.
Data sync survives because the janitor pushes during the wakes; the access layer (the
permanent URL, i.e. the entire "look at it" surface) does not. This is design rule #5's bug
class, live: nothing noticed until a person tried the URL.

- [x] **MacBook-side mini-watchdog** — `scripts/macbook/mini-watchdog.sh` + LaunchAgent
      `com.pavan.mini-watchdog` (30 min). Notifies on the down-transition, re-alerts every
      6h while down, once on recovery. Distinguishes "asleep / Tailscale wedged" (mini
      committed within 26h) from "fully down" (it hasn't). The dashboard's own health panel
      cannot carry this check — when the mini dies, the panel dies with it.
      *Installed + verified against the real outage: first run notified with the correct
      diagnosis, second run stayed silent inside the throttle window.*
- [x] **Janitor infra adopted into git** — `scripts/macbook/` now versions both MacBook
      launchd jobs (script + plist), which previously existed only in `~/bin` and
      `~/Library/LaunchAgents`. Unversioned plumbing was its own silent-failure risk.
- [x] **Pavan ran the fix at the mini (same day):** `pmset -g` now shows `sleep 0` +
      `autorestart 1` — this outage class is closed. Verified over SSH.
- [x] **PRs #14 / #15 / #16 merged by Pavan** (agent's merge was permission-denied).
- [x] **Mini redeployed to `main`** via `install-dashboard-service.sh`: build clean, service
      restarted, HTTP 200 locally and through the permanent URL, 0 commits behind. The
      watchdog observed the recovery and sent "Mini is back" — full down→up cycle proven.
- [x] **Email-sync timer staged on the mini** — `scripts/mini/install-email-sync.sh` writes
      `~/bin/email-sync.sh` + LaunchAgent `com.paladin.email-sync` (15 min). Deliberately
      inert (exits 0) until `~/.config/command-center/mail.env` exists, so installing it
      early is safe.
- [x] **DONE 2026-08-24 — email intake is autonomous.** Pavan created
      `~/.config/command-center/mail.env` (600) on the mini; first attempt failed because
      the host was assumed to be Google — `4infinitesolutions.com` mail is SELF-HOSTED
      (MX → `mail.4infinitesolutions.com`, Namecheap-style, regular mailbox password, no
      app-password concept). Host corrected; first live run: 55 INBOX messages since
      25-Jul → **8 staged, 47 filtered, 0 dupes**. The timer now runs every 15 min with no
      laptop involved. Mailbox `pavanm@4infinitesolutions.com` closes M3.5's "which
      mailbox" gate. Staged items wait in `crm/intake/email/` for Scribe (Layer 2) —
      the filing agent is now the next build.

**CORRECTION (same day, ~2h later): the sleep diagnosis above was WRONG.** When the tunnel
died a second time — ten minutes after the "fix" — ground truth said otherwise: the mini's
`uptime` was **32 days** and `pmset -g log` contained **zero sleep events**. The machine
never slept once. The one-commit-per-day pattern just meant nothing else changed on those
days; the real fault was the **Tailscale data path**, and the proven cure was cycling
Tailscale on the **MacBook** (`tailscale down && up` — the GUI quit/reopen is NOT enough,
the network extension survives it). The mini needed nothing either time. The pmset change
is kept (right for a server, irrelevant to the outage). Watchdog design unaffected — it
detects path-down regardless of which side broke, and it caught the second outage
unprompted at 11:21. Recovery levers, in order: `tailscale down && up` on the MacBook →
same on the mini → then suspect the machine. Full pattern in `tasks/lessons.md`.

## Phase 6 — Upcoming meetings on Today (calendar integration) — BUILT 2026-08-24

- [x] `lib/calendar.ts` — Google Calendar private ICS feeds → upcoming meetings.
      No OAuth: secret iCal URLs live in
      `~/.openclaw/workspace/.credentials/calendar.json` (`{ "icsUrls": [...] }`),
      `CALENDAR_ICS_URLS` env var overrides for dev. 10-min fetch cache.
      Parses TZID/UTC/all-day dates, expands DAILY/WEEKLY/MONTHLY recurrence
      (INTERVAL, BYDAY, UNTIL, COUNT, EXDATE, RECURRENCE-ID overrides).
- [x] `components/today/upcoming-meetings-card.tsx` — 14-day agenda grouped by
      day, demo/pilot/PoC titles flagged; honest states for not-connected,
      empty, and feed-unreachable (expired secret URL is visible, not silent)
- [x] Verify: 9/9 parser fixture assertions (tz conversion, folding, EXDATE,
      cancelled override, COUNT); pnpm build clean; browser check of populated
      + unconfigured states
- [x] Multi-account (Pavan has 4-5 emails): `icsUrls` takes one entry per
      calendar, plain URL or `{ url, name }` (name labels the card row);
      webcal:// auto-rewritten for iCloud. No intermediary (Notion rejected —
      adds a third-party sync hop) and no account passwords ever: secret ICS
      URLs are read-only and revocable per calendar.
- [ ] On the mini after merge: create `calendar.json` with one secret iCal
      URL per account — Google: Settings → [calendar] → Integrate calendar →
      "Secret address in iCal format"; Outlook: Settings → Calendar → Shared
      calendars → Publish; iCloud: share → Public Calendar
      (needs Pavan: they're secret URLs)

## Phase 6b — caleprocure-scan: kill the legacy scraper — MOSTLY DONE 2026-08-24

Confirmed: the cron was STILL the legacy browser-automation approach and had
produced nothing since 2026-07-14 (600s timeout every weekday). Pavan: one way
only. Done this session:

- [x] Legacy cron DISABLED (job 41ace7a9, kept until replacement is installed)
- [x] qual_table_automations synced read-only to mini `~/repos/qual_table_automations`
      (rsync snapshot @ 60e411e — no deploy key yet, see Open gates)
- [x] `scripts/caleprocure-scan.py` — consumes qual_table's client/parser/
      relevance modules; ONE request per run (the site's own Excel export);
      emits the exact markdown `lib/procurements.ts` parses; EPROCURE_ENABLED
      gate honored; fixture mode for offline tests
- [x] Verified offline against the captured 2026-08-04 export (14 high/2 med),
      round-tripped through the dashboard's own parseOpportunities (16/16
      fields parse); then REAL run on the mini: 11 high, 8 medium, 3 urgent of
      373 open events → dashboard Opportunities card live again (19 open,
      6 due this week) after six weeks at zero
- [x] `scripts/mini/install-caleprocure-scan.sh` — idempotent: rm's the
      agentTurn job, registers command-payload cron (weekdays 07:00 PT)
- [x] DEPLOYED 2026-08-24 evening: PR #21 merged, mini pulled + rebuilt,
      installer ran — legacy job REMOVED, command-payload cron live
      (id cfb98dca, weekdays 07:00 PT). Two hiccups fixed en route:
      (1) openclaw gateway was wedged (stale process, LaunchAgent "not
      loaded") — `openclaw gateway start` kills the stale process and
      recovers; (2) isolated crons REFUSE implicit "last"-channel delivery
      and mark every run error even at exit 0 — delivery must be explicit
      (`--announce --channel telegram --to telegram:8097059385`, now baked
      into the installer). Verified end-to-end via `openclaw cron run <id>`:
      status ok, delivered, report rewritten.

## Phase 6c — Granola meeting backfill — DONE 2026-08-24

Pavan asked whether Granola was captured; it wasn't (crm/meetings was empty;
Scribe is email-only). Chose full capture with CRM integration.

- [x] Reviewed all 119 Granola meetings (Sept 2025 - Aug 2026); 49 business-
      relevant fetched in full; Bedrock-venture, SIEN, and personal excluded
- [x] 48 meeting archives in operations `crm/meetings/YYYY-MM-DD-slug.md`
      (frontmatter: granola_id, category agency/partnership/gtm/product/
      operations, agency, contact slugs) — the engagement-import had distilled
      log lines for 6 contacts but never archived the meetings themselves
- [x] Contact gaps filled: christine-lci +2 pre-engagement demos (9/4, 9/11);
      NEW contacts pindi-oeis + shafi-oeis (demos given Sept 2025, both went
      quiet — now visible as going-cold) and jamie-burke-lci (technical
      counterpart on the LCI engagement). Unknowns flagged needs-detail.
- [x] Verified live: 104 contacts, Pindi/Shafi in the pipeline buckets
- [x] Ongoing capture: scheduled task `granola-crm-sync` (Claude Code desktop,
      weekdays ~7:00 AM PT) syncs new business-relevant meetings into
      crm/meetings + contact logs and pushes; janitors carry it to the mini.
      Caveats: runs only while the desktop app is open (else on next launch);
      first run should be triggered manually via "Run now" to pre-approve the
      Granola connector tools. Uncaptured marginal tail: Euclidean series,
      interviews (Vedant), Paychex, Salesforce Lorne, Google 4/21, Oracle
      4/30 — fetch on demand if relevant.
- [ ] ROADMAP (Pavan, 8/24): this becomes COMPANY-WIDE meeting intake, not
      just Pavan's notes. The bottleneck is account access, not the scheduler:
      the connector sees only Pavan's Granola. Plan when the team is ready:
      (1) everyone (Ganapathy/Rani/Isaiah/new hires) on Granola sharing
      business meetings into one shared Team Space — the governance boundary;
      (2) widen the sync filter to workspace-visible meetings + stamp each
      archive with who captured it (feeds the CRM's existing owner model, so
      Rani's meetings log touches under Rani); (3) move the runner to an
      always-on home — mini (needs one-time `claude login` there, then a
      headless probe to confirm connectors surface non-interactively; CLI
      currently NOT logged in) or a cloud routine pushing to GitHub.

## Open gates

1. ITN-37485: submitted-then-disqualified (`lost`) or pulled-out-first (`no-bid`)?
2. FTB: confirm `status: submitted, stage: pre-response`.
3. Private GitHub repo for operations: OK?
4. Granola signup + MacBook app install.
5. RFO site name.
6. Calendar: both Google calendars (gmail + berkeley) are EMPTY for the next
   4 weeks — if demos get scheduled somewhere else, that's the calendar to
   wire in, or the card will be honestly useless.
7. ~~qual_table deploy key~~ DONE 2026-08-24: Pavan added the key;
   `github-qualtable` host block + remote wired on the mini; `git pull
   --ff-only` verified working (the installer pulls on every run).

## Review
(to be filled in per milestone)

---

# Phase 7 — CEO layout rebuild (approved plan 2026-08-24)

Full plan: `~/.claude/plans/greedy-wiggling-blanket.md`. One-line thesis: Today answered
"is the machine running?"; it must answer "what do I do next and am I on pace?" —
strategic decisions from gtm/intel markdown, a scoreboard vs declared targets, channel/
vehicle cold-clocks, one ranked queue instead of five, a Waiting On delegation view,
and a real mobile pass.

- [x] Phase 0.1 — rebase: fast-forwarded to origin/main (edc56b7; gained lib/meetings.ts —
      scoreboard reuses listMeetings())
- [x] Phase 0.2 — GTM v2 draft (`operations/gtm/2026-08-24-gtm-plan-v2.md`) sent to Pavan;
      updated same-day to fold in his seven answers (2026-08-24-strategy-revision.md landed
      mid-build from another session). Two [DECISION] flags remain his: price + targets.
- [x] A — Foundations: NON_HUMAN_VIA single source · parameterized flag parsing · bid
      deadline normalization (all three on-disk variants verified)
- [x] B — Scoreboard: targets.md seeded (DRAFT values, Pavan edits in place); actuals
      derived from crm/meetings; MomentumCard absorbed (honest-quiet line kept)
- [x] C — Today's Moves: one ranked queue (leverage scoring verified against real data —
      26d-overdue CDT POC 64 > one-pager blocker 45 > strategic 45 > dated 37); /gtm page;
      resolve API round-trip proven incl. path-guard refusals
- [x] D — The Clock: 14-day merge, lead↔opportunity dedupe by slug (caught live dupe)
- [x] E — Channels: 5 vehicle seeds; SLP reads 339d cold + blocked, CAPSMA 146d — both
      alert on Today; /partnerships 307s; nav = Now/Sell/Machine/Planned; kanban → /bids
- [x] F — Waiting On (counts verified vs raw files: Rani 4 / Isaiah 2 / Ganapathy 1) ·
      Machine Room (<details open={isRed}>) · one-line Changes · ShapeCompact ·
      daily-brief deleted
- [x] G — Mobile: drawer round-trip verified at 375×812; zero horizontal page scroll on
      Today/Channels/Bids; 44px touch targets via new Button primitive
- [x] Mid-build: resolved the 7 email-synthesis questions ([RESOLVED 2026-08-24], one
      semantic operations commit each) after Pavan's answers landed — queue went 9→2
      strategic items, which is the system doing its job on day one

## Phase 7 review

Every phase shipped green (`pnpm lint` + `pnpm build` per phase) and was verified against
the real operations data, then walked in the browser at desktop and 375×812. The Today
page now leads with the campaign scoreboard (0/10 · 0/3 · 0/1 · Phase-0 0/3 · 30d left)
and a single ranked queue whose top item is the actual highest-leverage action on file.
Monitoring collapsed to two one-line rows that only open when red. Remaining for Pavan:
the two [DECISION] flags (Candor price, targets confirm), and editing gtm/targets.md
flips the scoreboard live — no deploy needed for target changes.


---

# Fix: absence of data must not render as a definitive status

Two live symptoms, one root cause. When a data source is unreachable or untracked,
the dashboard renders a *confident* status instead of admitting it doesn't know.

- cron unreachable  → renders GREEN "System Healthy"   (false green)
- agent untracked   → renders WARNING                  (false warning)

## A. Cron reachability (false green)
- [x] `shell.ts`: add `runCommandResult()` → `{ ok, stdout }` so failure is distinguishable from empty output
- [x] `getCronJobs()` / `getNormalizedCronJobs()` → return `{ reachable, jobs }`, not a bare array
- [x] `types`: add `SystemHealth.cronReachable`
- [x] `api/system/health`: unreachable → `overall:'red'`, `cronOk:false` (never green on unknown)
- [x] `app/page.tsx`: unreachable → red dot + "Automation unreachable"
- [x] `layout/top-bar.tsx`: label unreachable distinctly from Critical
- [x] `system/cron/page.tsx`: "Can't reach openclaw" empty state ≠ "No cron jobs scheduled / Add a task"
- [x] `api/system/route.ts` + `lib/agents.ts`: update to new shape

## B. Agents (false warning + auto-discovery)
Root cause: `AGENT_WORKSPACES` / `AGENT_OUTPUTS` / `getLastActivityMs` hardcode 4 agents
(main, product, sales, intel). `voice` and `scribe` fall through → no activity source →
`deriveStatus(undefined)` → 'warning'. Violates CLAUDE.md "auto-discover, no manual wiring".

- [x] Auto-discover workspace: `~/agents/<id>` → fallback `~/repos/operations/agents/<id>`
- [x] Wire `scribe` activity → `crm/intake/review` (it files staged mail there; touched today)
- [x] `types`: add `'unknown'` to `AgentStatus`
- [x] `deriveStatus`: no tracked source → `'unknown'`, not `'warning'`
- [x] `StatusBadge`: render `unknown` as neutral "Not tracked", not amber

## C. Production config (mini)
- [ ] `scribe-filing` cron: `delivery.channel:"last"` with no target on an *isolated* session
      → announce fails every run, job reads error, consec=2 drives the dot red.
      Work itself succeeds (77s). Set an explicit target like `caleprocure-scan` has.

## D. Needs Pavan (sudo — cannot run)
- [ ] Flush mini DNS: stuck negative-cache entry for `suppliers.fiscal.ca.gov` only
      (`dig` resolves it, `getaddrinfo` doesn't; every other host fine)

## Review

**Done (commits `e2cf6ce`, `b6115f1` on `claude/command-center-status-5e571c`).**

Both symptoms were the same disease: *absence of data rendered as a definitive
status*. The cron path turned "couldn't look" into green; the agent path turned
"not watched" into amber. Fixing the shared shape — make unknown representable,
then let the compiler find every caller — was cheaper and safer than patching the
two symptoms separately.

Turning `getNormalizedCronJobs()` into `{ reachable, jobs }` broke all five call
sites at compile time, which is the point: each one had to state what unreachable
means for it, and none could go on quietly inheriting green.

On workspaces, the first cut probed the filesystem for `~/agents/<id>`. That
worked, but `openclaw agents list` already prints `Workspace:` per agent — so the
second commit takes the CLI's answer and keeps the probe only as a fallback. Less
guessing, and it tracks an agent that moves.

**Verified**
- typecheck / lint / `next build` clean
- openclaw absent locally: health API went `overall:green, cronOk:true`
  → `overall:red, cronReachable:false`; top bar "System Healthy" → "Automation
  unreachable"; /system/cron "No cron jobs scheduled / Add a task" → "Can't reach
  openclaw", stating explicitly that it is not the same as having no jobs
- ran `getAgents()` against the mini's real filesystem (throwaway clone, running
  app untouched): voice `warning`→`unknown` with its workspace now resolved,
  scribe `warning`→`ok` with activity 2026-08-25T17:10. Scribe was never
  unhealthy — the dashboard wasn't looking at what it produces.

**Deployed 2026-08-25.** PR #28 merged; mini pulled `3da9092` (it was two commits
behind), rebuilt, and `com.paladin.commandcenter` kickstarted — back up in 2s.
Live check: `cronReachable:true` with `cronFailed:2`, so the working path is
intact and red means the two real failures, not the new unreachable branch.
`/system/cron` reads "10 scheduled · 2 failing"; voice renders "Not tracked" and
scribe "OK". Both agents now also resolve their SOUL.md, which a blank workspace
had prevented.

**Not fixed here — both need Pavan's hands on the mini**
- DNS flush (sudo). Until then `caleprocure-scan` stays red for a real reason.
- `scribe-filing` delivery. The openclaw CLI refuses over ssh
  (`GatewaySecretRefUnavailableError`); its gateway token only resolves in a GUI
  login session, and extracting a credential to work around that is off-limits.


---

# Phase 9 — Close the content loop (suggestions → pick → draft)

Voice generates 3–5 grounded content ideas every Monday 08:00 PT and announces them
to Telegram, where they evaporate. `content-engine` has ONE commit ever (Mar 26);
every drafts/ dir in it is empty; the calendar it reasons against stopped being
updated in July, and the Aug 21 run said so itself. The generation half works — the
loop after it was never built.

Decisions (Pavan, 2026-08-25): suggestions live in `operations/content/` (keeps the
two-repo rule, makes the /content stub's declared path correct, janitor commits it);
content-engine stays READ-ONLY as the source of voice guides + calendar. Voice writes
a hook + angle per suggestion; the full draft is generated only for a post you pick.

- [x] `paths.ts`: `content`, `contentSuggestions`
- [x] `types`: `ContentSuggestion`, `ContentStatus` (suggested|picked|skipped|drafted)
- [x] `lib/content.ts`: list/get/write + semantic git commit (mirror `crm.ts`)
- [x] `scripts/import-content-suggestions.ts`: parse a Voice run into suggestion files
- [x] Backfill week of 2026-08-24 (5 posts) from the session transcript, so there's
      something real on screen today
- [x] `/content`: replace the ComingSoon stub with the real page
- [x] `api/content/[id]`: PATCH status + feedback
- [ ] Update the `voice-monday-content-ideas` prompt to write files, not just announce
- [x] Wire `voice` into `TRACKED_AGENTS` so its badge stops reading "Not tracked"

## Review
**Done (PR #30, branch `claude/content-suggestions-5e571c`).**

The generation half had worked since March; everything downstream was missing, and
the absence was invisible because the ideas *were* arriving — just into Telegram.
The tell was structural, not behavioural: content-engine's one commit, its empty
drafts/ dirs, and Voice's own Aug 21 remark that the calendar was five weeks stale.

Suggestions live in `operations/content/suggestions/` rather than content-engine, so
the two-repo rule holds and the /content stub's declared data source is finally
correct. Writes reuse crm.ts's file-then-semantic-commit contract instead of a new
one — `git log` over the directory is the decision history, and the janitor pushes it.

Hook-now/draft-on-pick was the other call: a hook plus an angle is enough to choose
between, and drafting all five each week would spend ~4–5x tokens on four posts you
discard. Only a picked post gets drafted.

**Verified**
- typecheck / lint / `next build` clean; /content went static stub → dynamic route,
  /api/content/[id] resolves
- parser dry-run: all 5 posts, correct entities/days/hooks, post 5 correctly flagged
  `optional`. First cut captured the trailing `---` block separator into
  strategic_value; fixed and re-imported
- backfilled week of 2026-08-24 from agent session 930ce63a (the cron log's own
  `summary` truncates at 2000 chars, so the transcript was the only complete source)
- rendered against real data: 5 suggestions, grouped by week, entity colours, hooks
- clicked Pick end-to-end → file written + commit
  `content: picked — InfiniteAI: ...`. That was MY click, not Pavan's, so it was
  reverted surgically (unpushed, single file); the three in-flight bid files dirty in
  that tree were byte-identical before and after
- API guards: invalid status 400, non-string feedback 400, traversal 404, unknown 404,
  file untouched by every rejected call

**Still open**
- [ ] The `voice-monday-content-ideas` prompt still only announces. It must write
      these files directly — parsing prose is acceptable for backfill, not as the
      steady state. Gateway-side edit, same class as the scribe-filing delivery fix.
- [x] Feed picks and feedback back into Monday — `content/_feedback-digest.md`,
      DERIVED state rebuilt on every decision and committed in the SAME commit as
      the decision that caused it, so history never shows one without the other.
      Chose derived-on-write over "Voice scans the directory": a growing directory
      costs more tokens every week and still has to be told what to look at, and a
      digest regenerated on a schedule could disagree with the files it describes.
      Verified in a scratch HOME with its own git repo — pick + skip + note produced
      the right hit-rate table, surfaced the note verbatim, listed the undecided so
      Voice won't re-suggest, and the digest rode along in the decision's commit.



---

# Phase 10 — Outcomes and ad-hoc posts

Two gaps found by Pavan, one of them mine:

1. The loop only knew what he PICKED, never what actually happened after he
   posted. Voice was optimising against clicks, not results.
2. Nothing could create a post outside the Monday run. The timeliest content —
   an event you just left — is exactly what a weekly batch cannot produce.

He also asked about wiring LinkedIn directly. Answer: not yet, and not because
it's hard. His most recent tracked post is 06/06/2026, ~11 weeks ago — analytics
on a stream of zero teaches nothing. LinkedIn's analytics APIs are built around
ORGANISATION pages (partner approval, page admin) and third-party access to a
PERSONAL profile's post analytics is effectively closed — and his two highest-reach
posts are both personal. So the API route costs weeks of approval, covers 3 of 4
entities, and misses the best-performing one. Scraping is ToS-violating and risks
the account. Manual capture is two numbers off LinkedIn's own screen, works for all
four entities today, and builds the schema+habit that would justify an API later.

- [x] `ContentStatus` gains `published`; `ContentSource` = voice | manual
- [x] Outcome fields: published_url, published_at, impressions, engagement_rate
- [x] `createSuggestion()` — ad-hoc post any day, status `picked`, source `manual`,
      grouped into the current week via `weekOf()`
- [x] Duplicate guard: same week + entity + topic returns the existing row
- [x] `POST /api/content` (create) + outcome validation on PATCH
- [x] UI: "New post" in the header; "Log results" per card; results + post link
      rendered inline; `yours` marker on manual posts
- [x] Digest: Published/measured table, "Written by Pavan directly", and the
      8-row historical baseline read from content-engine (read-only)
- [x] Logging a URL implies published — outcome data can't attach to a `picked` row

## Review

**Done (branch `claude/content-outcomes-5e571c`).**

The digest had a bug I introduced and caught in testing: hit rate counted
`picked|drafted` but not `published`, so a post with 2,178 impressions showed as
a zero for its entity — the single worst thing this table could get wrong, since
it's the number Voice weights most. Fixed with `isChosen()` and renamed the column
Chosen, because "picked" stopped being the whole story once publishing existed.

`>5 ideas per week` needed no code — nothing ever capped it; the 3-5 lives only in
the prompt, and the file-per-idea model renders whatever Voice writes.

**Verified** (scratch HOME with its own git repo, so nothing real was touched):
- baseline parser: all 8 rows off the real content-engine table, including the
  comma-separated `2,178`; returns [] and does not throw when the repo is absent
- full flow: Voice suggestion → picked → URL logged → status auto-flips to
  published → numbers logged → digest shows it under measured results
- ad-hoc create: lands in the current week with the next post number, status
  `picked`, source `manual`, surfaced in its own digest section
- dedupe: same entity+topic with different case/whitespace returns the existing
  row rather than a second file
- `weekOf()` resolves to Monday
- typecheck / lint / build clean

**Still open**
- [ ] Revisit LinkedIn org-page API once posts are actually flowing and there are
      results worth automating the collection of.

## Phase 11 — One bid system (connector first)

**Written 2026-09-08.** Origin: the decision to converge the two bid systems on the
qual-table workbench. The handoff for the qual-table team is
`operations/workflows/unified-bid-system-handoff.md` (spine, solution module, claim gate,
API contract, what moves out of operations). This section is only the command-center half.
Verified this session against `Pmurugesh/qual_table_automations` and `NovaEraSolutions/Nexus`
on `origin/main` (read-only), `operations` on disk, and this worktree.

**Standing rules that bind every item:** drafts automatic, sends human; deterministic where
a match decides, LLM only for judgment; each fact in one file, anything shown twice is
generated; absence of data renders as unknown, never green. Dashboard features are frozen
until 2026-09-22 (`operations/gtm/targets.md` phase-1 window) except finance wiring, the bid
connector, leads on a schedule, and the outreach trigger cron.

**What the exploration found that this plan has to fix, not work around:**
- `scripts/sync-leads.ts` has no timeout on either `fetch`, no failure surface, and is
  scheduled nowhere (grep hits only its own docstring). M3 boxes are all still unchecked.
- `writeBidStatus` (`src/lib/files.ts:169`) is the only writer with no lock, no atomic
  write, no commit, no status validation, no traversal guard on `bidName`. Every other
  writer goes through `acquireLock` + `atomicWrite` + a `via:` commit.
- Coverage % exists in `CLAUDE.md` and Phase 4.2 only; nothing computes it. `/bids` shows
  `N docs`.
- `bid-decision` moves score a flat 30 with no `due`; bid deadlines reach the Clock only.
  `/bids/<name>#<file>` deep links from Moves are ignored by `bid-detail-tabs.tsx`.
- No lead→bid link in either direction; `triageLead`/`getLeadQueue` have zero callers.
- `PATHS` has no platform entry; `verify-claims.ts:29` and `generate-registry.ts:26` each
  re-derive `~/infiniteai_platform`.
- The workbench's multitenancy merge (2026-09-07, PRs #109/#110) requires an
  `organization_members` row; the Paladin service account may now 403. Nothing here runs
  until that is confirmed.

### 11.0 Gate — before any code

- [x] **Store the five `QUAL_TABLE_*` values on the mini, then run the dry test.** *Done
      2026-09-08 by Pavan over ssh; dry run: 370 events, 6 surface.* Earlier check
      2026-09-08 over ssh: they are in no file, launch agent, shell profile, or cron env on the
      mini; the only `QUAL_TABLE` string there is `QUAL_TABLE_BACKEND` (the caleprocure-scan
      folder path). So `sync-leads.ts` has never run on the mini and the service account
      `paladin-scout@4infinitesolutions.com` has never been exercised. Whether it exists and
      belongs to an organization is a question for the qual-table team (handoff, last section).
      Put the values in `~/.openclaw/workspace/.credentials/qual-table.env` (the calendar
      credential precedent) and have the cron installer source it; never in git. Then:
      `set -a; source ~/.openclaw/workspace/.credentials/qual-table.env; set +a; node --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/sync-leads.ts --dry`.
      A `403` means no org membership; do not build the connector against it.
- [ ] **Pavan answers the questions in "Open gates" below** that change the shape
      (entity = organization; freeze scope of the minimal rendering).

### 11.1 `scripts/sync-bids.ts` — the connector (allowed inside the freeze)

Modeled on `scripts/sync-leads.ts`; same env, same auth, same store pattern as
`src/lib/leads.ts`. One-way, read-only against the workbench, idempotent.

- [x] **Extract the client.** *Built 2026-09-08: `src/lib/qual-table.ts` (config, signIn,
      fetchJson, 401/403 named; timeout 60 s after the mini measured a 16.7 s cold
      summary read on 2026-09-08). `sync-leads.ts` uses it.*
- [x] **One call per run:** `GET /api/v1/bids/summary`. *`scripts/sync-bids.ts`, 2026-09-08.*
      (later `?updated_since=` once the workbench adds it). Never the Brief from a cron; never
      any POST.
- [x] **Identity = `source.bid_id`.** *Built: `src/lib/bid-sync.ts`; slug capped at 60 chars.* Before writing, scan every `bids/*/.status.json` for
      `source.system === 'qual-table' && source.bid_id === row.bid_id`. Found: update in
      place. Not found: create `bids/<slug(display_name)>/` (collision → append `-qt<bid_id>`)
      with only a `.status.json`. A folder is created once and never renamed; the display
      name may change, the id may not.
- [x] **Status file shape** *(landed in `src/types/index.ts` as written, plus `BidStage`;
      `source` also carries the workbench `status` so a move is detectable)*:
      ```ts
      interface BidStatusData {
        status: BidStatus              // Discovered | Analyzing | Draft Ready | Under Review | Submitted | Won | Lost | No-Bid
        entity: Entity
        stage?: string                 // intake | scanned | planned | team-confirmed | tailoring | drafted | gated | ready-to-submit | lapsed | submitted | awarded | closed
        reason?: string                // generated for connector bids; hand-written for markdown bids
        via?: 'qual-table' | 'dashboard' | 'agent'
        source?: { system: 'qual-table'; bid_id: number; name: string; org_id?: string }
        syncedAt?: string              // ISO; last successful connector write for this bid
        deadline?: string              // YYYY-MM-DD (the one key; deadlineProposalDue stays readable, never written again)
        questionsDue?: string
        agency?: string
        contractValue?: number
        pipeline?: { match: boolean; resume: boolean; tables: boolean; submit: boolean }
        coverage?: { rolesTotal: number; rolesStaffed: number; slotsTotal: number; slotsFilled: number }
        plan?: { sections: string[] }  // ['staffing'] when rolesTotal > 0 until the workbench serves plan_sections
        decisionsOpen?: number
        gate?: { status: 'pass' | 'fail' | 'unknown'; platformRef?: string; verifiedAt?: string }
        discoveryEvent?: { businessUnit: string; eventId: string }   // = crm/leads slug; the lead→bid link
        archived?: boolean
        updatedAt: string
      }
      ```
- [x] **Mapping** *(`mapRemote()`, 9 mapping checks pass)* (the table in the handoff, "How we map your fields to our three"). Stage
      ladder ranks: intake 0 · scanned 1 · planned 2 · team-confirmed 3 · tailoring 4 ·
      drafted 4 · gated 5 · ready-to-submit 5 · lapsed 6 · submitted 6 · awarded 7 · closed 7.
- [x] **Never overwrite richer with coarser.** *(`nextStatus()`; tested both ways)* Write `stage` only when
      `rank(new) >= rank(existing)` **or** the workbench `status` differs from the stored
      `source.status` (a reopen is real and must show). Preserve `entity`, a hand-written
      `reason` on a non-connector bid, `archived`, and any key the connector does not own.
- [x] **Change detection like leads:** *(`connectorView()`; identical rows → no write, no commit)* rewrite only when a mapped field differs; `syncedAt`
      alone is never a reason to write. One commit per batch, `bids: N new, M updated`, body
      `via: qual-table`, through `acquireLock(PATHS.bids)` + `atomicWrite`.
- [x] **Failure renders unknown.** *(`PATHS.bidSyncLog`, `lastBidSyncSuccess()`, "Bid sync" row amber 1.1 d / red 3 d)* Timeout, non-200, or unparseable body: write nothing to
      git, append one line to `~/.openclaw/logs/bid-sync.log` (new `PATHS.bidSyncLog`,
      same precedent as `emailSyncLog`), exit 1. Success appends one line too. A "Bid sync"
      row in `getPipelineFreshness()` (`src/lib/files.ts:484`) reads the log's last success;
      older than 26 h → unknown, never green on silence.
- [x] **Schedule:** *(`scripts/mini/install-bid-sync.sh`, registers `bid-sync` hourly + `lead-sync`
      daily, sources the env file at run time. Deployed 2026-09-08: the dry run passed on
      the mini and the FIRST SYNC RAN BY HAND — 17 bids, one commit `05b91e4` in operations,
      dashboard rebuilt, "Bid sync" row green. Crons REGISTERED 2026-09-08 from the
      mini's own screen (the Keychain-backed gateway token is unreadable over ssh; the
      installer now resolves it the way OpenClaw's own resolver does): `bid-sync`
      `05b88215-0d89-437d-8652-bcec702c9251` weekdays hourly 07–18 PT, `lead-sync`
      `d26140ca-e56a-4eb1-90b0-9c75d579eab6` weekdays 07:30 PT. First cron-driven run 12:14 PT:
      `ok fetched=17 created=0 updated=0 unchanged=17`, no write, no commit. LIVE.)* OpenClaw cron on the mini, weekdays hourly 07:00–18:00 PT, command
      payload like `caleprocure-scan` (`scripts/mini/install-caleprocure-scan.sh` is the
      installer to copy), with an **explicit delivery target** (isolated crons without one
      read as errors every run; see memory). Same installer registers `sync-leads` daily —
      that is the "leads on a schedule" freeze exception and shares the client.
- [x] ~~Link existing folders by hand, once.~~ *Not needed: none of the five folders exist in
      the workbench (gate 7, 2026-09-08). All five stay archive-only.*
- [x] **Test** *(26 checks in a scratch HOME, all pass 2026-09-08; typecheck, lint, build clean)*
      in a scratch `HOME` with its own git repo (the content-outcomes precedent):
      new bid → folder + commit; unchanged summary → no write; workbench moved
      `open→submitted` → stage advances; stored `ready-to-submit` with workbench
      `scanned` and unchanged status → stage kept; reopen → stage lowered with reason;
      timeout → no write, log line, freshness row unknown.

### 11.2 Dashboard — minimal, inside the freeze (needs Pavan's yes on gate question 3)

A connector bid has no markdown, so `/bids/<name>` must render something or the pipeline
lies. This is rendering the connector's output, not a feature.

- [ ] **Detail page for a bid with zero `.md` files:** status, stage, reason, agency,
      deadline, coverage numbers, and one button **Open in workbench** →
      `${QUAL_TABLE_APP_URL}/bids/${source.bid_id}` (new env, the Vercel origin). No tab
      strip. No status controls for connector bids (`via === 'qual-table'` hides
      `bid-status-controls.tsx` and the kanban select; a write there would be a second
      writer).
- [ ] **Staffing chip** on `/bids` cards and Today's bid rows when `plan.sections` includes
      `staffing`, showing `slotsFilled/slotsTotal`. A `solution` chip appears by the same
      rule once the workbench serves it. No chip when `plan` is absent.
- [ ] **Clock** reads `deadline` (already normalized via `bidDeadline()`) and, new,
      `questionsDue` as a second row.
- [ ] `listBids()` picks `updatedAt` from `syncedAt` when present, so a connector bid does
      not look stale because it has no markdown mtime.

### 11.3 Dashboard — after 2026-09-22

- [ ] **One pipeline view.** Kanban columns keyed by `stage` rank, not by `status`; markdown
      bids without a `stage` land by their `status` as today. Filter chips: entity,
      staffing/solution/mixed (from `plan.sections`), agency.
- [ ] **Harden `writeBidStatus`** to the lead-writer pattern: traversal guard on `bidName`,
      `normalizeBidStatus` on input, `acquireLock` + `atomicWrite`, one commit with
      `via: dashboard`. Refuse writes to `via: 'qual-table'` bids with a 409.
- [ ] **Decisions into Moves** from `decisionsOpen` (count → one move per bid, `href` to
      the workbench), with a `due` from `deadline` so urgency ranks them; retire the flat 30.
- [ ] **`#file` deep links** in `bid-detail-tabs.tsx` (read the hash on mount).
- [ ] **Lead→bid:** when `discoveryEvent` is present, the Clock and `/intel` show the bid
      instead of the lead, by the slug equality `clock.ts:86` already relies on.
- [ ] `PATHS.platform` for `~/infiniteai_platform`; `verify-claims.ts` and
      `generate-registry.ts` read it instead of re-deriving.
- [ ] **Snapshot push** (the claim gate's phase 1, command-center side): extend
      `generate-registry.ts` to emit `products/_registry.json` (registry + path index +
      symbols for cited files + `required/provides_capabilities`), render `_registry.md`
      from the JSON, and `POST /api/v1/platform/snapshot` with the same client as 11.1.
      Gated on the workbench shipping the endpoint.

### 11.4 Retire the markdown pipeline for new bids (gated on the solution module shipping)

- [ ] `operations/workflows/new-bid.md` gets a header: retired, new bids start in the
      workbench; the eight steps are kept as history.
- [ ] `/intake` "New bid from RFP docs" no longer creates `bids/<name>/documents/`; it links
      to the workbench's create/adopt and keeps the file drop only for correspondence.
- [ ] `openclaw agent --agent main` intake trigger for bids is disabled; Capture's bid
      prompts are archived under `operations/agents/sales/`.
- [ ] Response library, style guide, platform knowledge migrate into the workbench
      (`response_blocks`, library `claims`); `PATHS.responseLibrary` and
      `PATHS.platformKnowledge` are removed with `/library`, which becomes a link.
- [ ] `scripts/verify-claims.ts`, `scripts/pre-bid-gate.sh`, and the `citationDrift()` half
      of `drift-check.ts` are deleted after the workbench gate has passed on one real bid.
      Name drift stays (it reads the registry, not bids).

### 11.5 Archive `operations/bids/`

- [ ] `operations/bids/_ARCHIVE.md`: one paragraph, the date, the workbench URL. No folder
      moves, no renames; git history and meeting-note links keep resolving.
- [ ] Each of the six status files gets `archived: true`; the one folder without a status
      file (`caltrans-adhoc-reporting`) gets one. `listBids()` groups archived bids under a
      collapsed "Archive" on `/bids` and drops them from the Clock, Moves, and
      `getDecisionQueue()`.
- [ ] `_platform-knowledge.md` and `_requirement-tracker.md` get a header pointing at the
      workbench claims table; contents untouched.
- [ ] Nexus `bids/` (README + seven `.gitkeep`, last touched 2026-06-13): recommend one
      README line to the product team via the handoff; we do not touch it.

### Open gates (Pavan)

1. ~~Is the Paladin account still authorised?~~ **Answered 2026-09-08: yes.** Pavan stored the
   five values in `~/.openclaw/workspace/.credentials/qual-table.env` on the mini (mode 600) and
   the dry run signed in and fetched 370 events, 6 surfacing. The account is an organization
   member; nothing to ask the qual-table team on this point.
2. Which GitHub credential, if any, may the workbench hold to read `NovaEraSolutions/Nexus`
   from Render for the gate's phase 2 (fine-grained read-only PAT vs GitHub App), and who
   issues it? Phase 1 needs none.
3. Are 11.2's minimal rendering changes inside the connector's freeze exception, or do
   connector bids show as bare cards until 2026-09-22?
4. ~~Entity = organization?~~ **Decided 2026-09-08: one workbench for both entities.** The
   Nexus `procurement` module (Proc) is a product, not the bid tool. Whether entity is a bid
   field or an org is the qual-table team's call (handoff question 6); the connector reads
   `entity` when served, else `org_id`, else leaves the existing value.
5. ~~Response library, style guide, platform knowledge after the solution module ships?~~
   **Decided 2026-09-08: the workbench database** (`response_blocks`, library `claims`).
6. ~~Past-due open bids?~~ **Decided 2026-09-08: auto-mark No-Bid**, `stage: lapsed`,
   generated reason. A later `submitted` from the workbench still overrides it (status moved).
7. ~~Which existing folders are in the workbench?~~ **Answered 2026-09-08: none.** Read
   `GET /api/v1/bids/summary` from the mini: 16 bids, all Infinite Solutions staffing (DMV,
   ISD, one NG 9-1-1 adopted from eProcure), all `status = open`, 7 past due (Jan–Mar), 0 due
   within 7 days. No folder link to set; the five folders are archive-only. Consequences:
   (a) the first sync would auto-No-Bid the 7 past-due bids under decision 6, so the handoff
   asks the team to backfill outcomes first (all seven were submitted per Pavan 2026-09-08: DMV
   3569/3572/3576/3868 ids 2/3/4/10, NG 9-1-1 id 76, EASE id 104, DXP retest id 117); (b) `name` is the solicitation number for
   hand-made bids and the eProcure event id for adopted ones (`0000039912`), which is the
   `discoveryEvent` link for adopted bids until the team serves it explicitly.

---

## Phase 12 — Roadmap tracking (commitments layer)

**Written 2026-09-08.** Origin: Pavan — "I am managing a lot of projects and initiatives/repos
for both internal automation and our actual products… keep track of the product roadmaps and
make sure we are on time." Shape agreed same session: **Nexus as one initiative with its
solution products underneath, each internal repo with its own next steps.** Surveyed this
session against all 12 repos on the mini (`origin` after fetch, read-only), `~/.local/state`,
and the loaded launchd jobs on this MacBook.

**The gap, precisely.** Everything *derivable* is already derived: `generate-registry.ts`
regenerates `products/_registry.md` weekly from Nexus's own module manifests; `verify-claims.ts`
resolves cited code paths; `drift-check.ts` watches facts drifting from evidence; `clock.ts`
merges everything dated in 14 days; `moves.ts` ranks everything demanding attention. What
nothing holds is a **date you committed to**. `grep -riE 'roadmap|milestone|target_date'` over
`src/` and `scripts/` returns only bid deadlines and lead scoring. This phase adds ~10 dated
commitments — not a work tracker.

### What the survey found that this plan has to obey, not work around

- **Working clones lie. Read `origin`.** The mini's local clones are stale by up to three
  months: `contract-management` local HEAD is 2026-06-02 while its `origin` moved 2026-09-08;
  `Nexus` local 2026-08-26 vs origin 2026-09-07; `qual_table_automations` local 2026-08-21 vs
  origin 2026-09-08. A check against working trees would have declared two live initiatives
  dead. `generate-registry.ts:47` already fetches then reads `origin/main`; do the same.
- **`operations` commit velocity measures machines, not progress.** 247 commits/90d, but the
  authors are `Pavan (macbook)` 130 / `Paladin (mac mini)` 117, and the top subjects are
  `outreach: regenerate view` (23), `auto: intelligence/procurements/<date>-caleprocure` (13),
  `crm: log touch — …`, `auto(macbook): …`, `auto: codebase-reports/product-health-<date>`.
  Directories touched: crm 440, intelligence 196, bids 174, agents 151 — against gtm 32,
  workflows 18, content 17, products 16, scripts 5. **An evidence path under a janitor-written
  directory is permanently green regardless of whether anyone is working.**
- **Bots are in the human repos too.** `contract-management` 180d: `AntarikshRamesh` 88 +
  `Antariksh Ramesh` 63 (same person, two spellings — normalize) + `renovate[bot]` 20 +
  `Pmurugesh` 4. Dependency bumps are not progress.
- **The weekly job that would host this is one run behind.** `~/.local/state/drift-check.json`
  mtime and `_registry.md`'s `generated_at` both stamp **2026-08-31**; no 2026-09-07 run landed,
  though Nexus's origin moved that day. `com.pavan.weekly-sync` is loaded on this MacBook —
  which sleeps. **Schedule roadmap-check on the mini instead** (always-on since the 2026-08-24
  pmset fix, holds all 12 repos, already runs the openclaw crons).
- **Dashboard features are frozen until 2026-09-22** (Phase 11 standing rule, `targets.md`
  phase-1 window) and the exception list is finance wiring / bid connector / leads on a
  schedule / outreach trigger cron. **A `/roadmap` page is not on it.** Data layer + cron ship
  now; the page waits for 09-22 or an explicit exception (open gate 1).
- **`PATHS` has no platform entry** — `verify-claims.ts:29` and `generate-registry.ts:26` each
  re-derive `~/infiniteai_platform` (already noted in Phase 11). roadmap-check must not become
  the third. Add a repo map to `paths.ts` and retrofit both.

### The board — 10 initiatives

**Group `nexus` — one umbrella, six product roadmaps.** Rows already exist in `_registry.md`;
this only attaches dates. Nexus is genuinely human-built (180d: `Pmurugesh` 1095,
`Antariksh Ramesh` 555), so commit evidence is meaningful here.

| Product | Slug | Standing (from `_registry.md` + product cards) |
|---|---|---|
| Candor | `prr` | Lead product. 117 UI files / 136 tests |
| Reporting | `ad-hoc-reporting` | Largest frontend (227 files), **0 tests**, `close-to-ready` |
| GovHire | `recruitment` | 54 files / 28 tests |
| Steward | `assistants` | `shipped-needs-demo-data`; San Jose RFP spine, awaiting award since Dec 2025 |
| Proc | `procurement` | `needs-frontend` — 4KB / 3 files |
| Milestone | `delivery-management` | Shipped + launchpad-surfaced, zero sales presence — the only open product gap in `_overview.md` |

**Group `internal` — three.**

| Initiative | Repos | `kind` | Note |
|---|---|---|---|
| Command Center | `command-center` | `build` | The only one where the work is yours. 134 `Pmurugesh` / 10 `Paladin` in 180d |
| BidPro | `qual_table_automations` | `handoff` | Never written to (rule of 2026-08-21). Track handoff state |
| Contract Management | `contract-management` | `handoff` | Antariksh's active repo; track handoff state |

**Group `web` — one.** `infiniteai-website` + `is-website` as a single initiative: same job
(collateral / web presence), two repos. Honest baseline — 180d authorship is
`Paladin` 3 / `Pmurugesh` 1 and `Pmurugesh` 2 / `Paladin` 2 respectively, origins last moved
2026-07-07 and 2026-06-01. **This entry is red on day one, and that is the point**: the Aug-20
gap analysis named collateral a bottleneck and nothing has moved since.

### Not tracked — the parking lot (write once, no target, no check)

`operations` — **substrate, not an initiative.** No ship date, no definition of done, and a
commit rate dominated by machine writes (above). Its genuinely authored parts are already
tracked elsewhere: `gtm/` drives `targets.md` and the scoreboard, `products/` drives the
registry, `content/` drives the content loop. Command Center is the initiative; operations is
where its output lands.

`plan-review` (Attest), `web-intelligence`, `data-intelligence` — deliberately outside the
public narrative per `_overview.md`; recorded decisions, not oversights. `echo` — retained,
partner-based, deprioritized until a demand signal. `content-engine`, `finance-system`,
`fundraising`, `opportunity-generator` — **no git remote at all**, local HEAD 2026-03-26 for
all four (note `/finance` and `/fundraise` routes exist against dormant repos). `branding` —
not a git repo.

### 12.1 Authored layer — `operations/roadmap/<slug>.md`

- [x] **One file per initiative, ten files.** *Built 2026-09-08 in `operations/roadmap/`,
      plus a `README.md` carrying the schema and the not-tracked list.* Frontmatter is the whole contract:
      ```yaml
      slug: milestone-sales-presence
      group: nexus | internal | web
      product: delivery-management     # group nexus only → products/<slug>.md
      kind: build | handoff
      waiting_on: "qual-table team"    # kind: handoff only — who holds the ball
      target: 2026-09-30               # omit when genuinely undecided
      done: 2026-09-28                 # a one-time fact, never a maintained status
      evidence:                        # kind: build
        - repo: Nexus
          path: packages/ui/components/modules/delivery-management/
      handoff:                         # kind: handoff
        spec: operations/workflows/contract-mgmt-integration-spec.md
        landed: "GET /api/alerts/summary"
        consumed_by: src/app/finance   # grep target proving we actually use it
      ```
      Body = definition of done, two lines. **There is no `status:` field** — a hand-maintained
      status column is the exact thing that goes stale and lies. `done:` is a fact you record
      once; everything before it is derived.
- [x] **Seed the real commitments, not placeholders.** *Done 2026-09-08 — and as predicted
      all ten seeded with NO target date. That is the finding.* Most will have **no `target:` on day
      one** — that is the finding, not a bug (same shape as "no product has a price"). Known
      live ones: Milestone sales presence; Steward demo seed (`demo_seed=None`); Reporting
      sample DB + 4-6 demo reports; Proc frontend; Contract Management `/finance` consumption
      (stranded since 2026-06-02); Command Center Phase 11.

### 12.2 Derived layer — `scripts/roadmap-check.ts` → `operations/roadmap/_status.md`

Same shape and doctrine as `generate-registry.ts`: fetch, read `origin/main`, never a working
tree; header says DERIVED / DO NOT HAND-EDIT; commit only when content changed.

- [x] **Add the repo map to `src/lib/paths.ts`** *Built 2026-09-08: `REPO_CANDIDATES`, seven
      repos, two candidate paths each where the machines disagree.* Retrofit of
      `verify-claims.ts:29` / `generate-registry.ts:26` still open — see 12.5. and retrofit `verify-claims.ts:29` and
      `generate-registry.ts:26` off their private `~/infiniteai_platform` constants.
- [x] **Bot/janitor author exclusion, global — not per-file config.** *Built: `BOT_AUTHORS`
      + `BOT_SUBJECTS` + `AUTHOR_ALIASES` in roadmap-check.ts.* Drop `renovate[bot]`,
      `Paladin`, `Paladin (mac mini)`, and any `auto:`/`auto(macbook):` subject prefix before
      computing freshness. Normalize `AntarikshRamesh` ≡ `Antariksh Ramesh`.
- [x] **`kind: build` → two numbers per initiative:** *Built; `deriveState` in
      `src/lib/roadmap.ts` is the single definition, imported by BOTH the script and the
      page so the board and the generated report cannot disagree. 10/10 state cases
      verified 2026-09-08.* days to `target`, and days since the last
      *human* commit touching any `evidence` path on `origin/main`. Derived state:
      `done` (has `done:`) · `slipped` (past target) · `at-risk` (target ≤14d, evidence cold
      ≥14d) · `on-track` (target ≤14d, evidence warm) · `idle` (evidence cold ≥30d) ·
      `no-target` · `active`.
- [x] **`kind: handoff` → state machine, not commit counts:** *Built. Contract Management
      verified live 2026-09-08: `app/api/alerts/summary/route.ts` first landed
      2026-06-02T03:31 on their `origin/main`, and command-center references it nowhere —
      98 days stranded, confirmed by grep, not asserted.* `spec-sent` → `pr-opened` →
      `merged` → `consumed`. `consumed` is proved by grepping `consumed_by` for `landed` —
      the `verify-claims.ts` mechanic. Contract Management is the worked example: merged
      2026-06-02, never consumed, **97 days stranded**.
- [x] **Fail loud, render unknown.** *Built and proven by accident: run from the MacBook,
      contract-management and both websites are not cloned, and all three render `unknown`
      rather than green. `git grep`'s exit-1-means-no-match is handled separately so a zero
      count returns quietly instead of logging as a failure.* A repo that will not fetch renders `unknown`, never green
      (standing rule).

### 12.3 Surfaces

- [x] **Feed the queues that already exist.** *Built and verified end-to-end 2026-09-08 with
      a temporary target on Milestone: Today rendered the Move ("Decide: Milestone — Due in
      7d, no commits on the evidence path in 24d") AND the Clock row, both deep-linking to
      `/roadmap#milestone`. Target reverted after the test.* `target` inside 14 days → a `ClockItem`
      (`clock.ts`); `slipped`/`at-risk` → a `Move` (`moves.ts`, new kind `roadmap`,
      action-phrased: `Decide: Milestone sales presence missed 09-30 — re-target or drop`).
      **Today gets no sixth competing card.**
- [x] **`/roadmap` page** — freeze exception granted by Pavan 2026-09-08. *Built:
      `src/app/roadmap/`, `src/app/api/roadmap/`, nav section `Build`. Renders a loud stale
      banner when `_status.md` is missing or older than 10 days.* Grouped by Grouped by
      `nexus` / `internal` / `web`, one row per initiative, target + derived state + evidence
      age.

### 12.4 Schedule

- [ ] **Weekly `roadmap-check` cron on the mini**, not the MacBook's `com.pavan.weekly-sync`
      (one run behind; see findings). `openclaw cron` changes need the mini's on-screen
      Terminal — the Keychain is empty over ssh.
- [ ] **Separately: why did weekly-sync miss 2026-09-07?** Not this phase's job to fix, but
      `_registry.md` being 8 days stale silently is the same disease `drift-check.ts` exists to
      catch. File it or fix it; do not let it ride.

### 12.5 Left open, deliberately

- [ ] **Retrofit `verify-claims.ts:29` and `generate-registry.ts:26`** onto `REPO_CANDIDATES`.
      The map exists and roadmap-check uses it, so the third copy was never created; removing
      the two existing ones touches scripts that gate bid claims, and doing that in the same
      change as a new feature is how a gate quietly breaks. Separate change.
- [x] **First mini run — the system proven end-to-end.** *2026-09-08, after PR #39 merged.
      All 10 rows resolved, zero unknowns: **Contract Management `stranded` — "Merged 98d ago,
      still not consumed here"**, derived independently rather than from the manual check, and
      Web presence `idle` at 63d — which resolves to 2026-07-07, infiniteai-website's last
      HUMAN commit, so the bot filter correctly skipped the Paladin commits above it.*
- [x] **Guard partial runs (found by that same run).** *`_status.md` is one file written by two
      machines and only the mini can see every repo — a MacBook run resolved two initiatives to
      `unknown` and the janitor committed the degraded board over the mini's correct one.
      roadmap-check now refuses to write when any referenced repo is absent from the machine,
      names them, and exits 2; `--dry` still prints. Verified: exit 2, file byte-identical
      after the refusal, 10 rows still printed under --dry.*
- [ ] **Register the cron ON THE MINI — installer written, Pavan runs it.**
      `scripts/mini/install-roadmap-check.sh` (2026-09-08), modeled on install-bid-sync.sh:
      dry-run sanity check, Keychain token, `openclaw cron add roadmap-check` weekdays 06:00
      PT, `--agent product`, explicit Telegram delivery. **Daily, not weekly** — the at-risk
      window is 14 days and a weekly check could miss most of it. Cheap because of the
      fingerprint (next item). Needs the mini's on-screen Terminal for the Keychain.
- [x] **Daily cron without daily commits.** *2026-09-08. First design stored AGES in
      `_status.md`, so every daily run would have rewritten the file (every number ticks) and
      the janitor would have committed it — and the Telegram announce would have been ten
      lines of noise every morning. Now: the file stores TIMESTAMPS (`last_evidence_at`,
      `handoff_at`), `withLiveAges` in roadmap.ts recomputes ages at read time, and the script
      rewrites only when a `fingerprint` of facts changes (human commit, handoff state, error,
      target/done edit, or a state crossing a threshold). Freshness comes from
      `~/.openclaw/logs/roadmap-check.log` (the bidSyncLog contract — one line per run, last
      `ok` wins), so a quiet fortnight is not a stale board. Verified: fingerprint emitted,
      MacBook run logs `refused missing=2` and leaves the file byte-identical, local page
      shows web-presence 63d computed from 2026-07-07.*
- [x] **`/roadmap` was 404 on the live dashboard for hours after the merge — deployed, and the
      gap closed for good.** *Found 2026-09-08 by the recheck: PR #39 was on the mini's `main`
      but `next start` serves `.next/`, built 11:51, before the merge. Nothing rebuilds on
      pull; data syncs in 2 min (janitor, StartInterval 120), code waited for a human.
      Deployed via `install-dashboard-service.sh` over ssh → HTTP 200 on `/`, `/roadmap`,
      `/api/roadmap`, 10 rows, stranded/idle correct. Then wrote the missing automation:
      `scripts/mini/deploy-on-merge.sh` + `install-deploy-on-merge.sh` — a launchd job every
      5 min: fetch, skip unless origin/main moved AND on main AND tree clean, pull --ff-only,
      install, build, kickstart the service, one log line per deploy in
      `~/.openclaw/logs/command-center-deploy.log`. Failed build keeps the old process serving.
      Pavan installs it on the mini (same session as the cron installer).*
- [ ] **Why did `com.pavan.weekly-sync` miss 2026-09-07?** Filed, not fixed. `_registry.md`
      and `drift-check.json` both stamp 2026-08-31 while Nexus's origin moved 09-07. A weekly
      watcher that silently skips is the disease drift-check exists to catch, in the watcher.

## Phase 12 review (2026-09-08)

**Built:** `src/lib/roadmap.ts` (schema + `deriveState`), `scripts/roadmap-check.ts` (the
deriver), `src/app/roadmap/` + `src/app/api/roadmap/`, `REPO_CANDIDATES` in `paths.ts`, nav
section `Build`, Clock and Moves wiring, and ten seed files plus a schema README in
`operations/roadmap/`.

**What the first run actually says** — all ten initiatives, zero target dates:

| state | initiatives |
|---|---|
| `unknown` | Contract Management, Web presence (not cloned on the MacBook — correct, not a bug) |
| `no-target` | Candor, Command Center, GovHire, Milestone, Proc, Reporting, Steward |
| `active` | BidPro (PR #116 open) |

That is the honest day-one board and it was the predicted outcome: **nothing here has ever
had a date**. The same shape as "no product has a price" — the tracker's first job was to make
that visible rather than to look busy.

**Three things the survey changed about the design**, each caught before it shipped:

1. Reading working trees would have declared contract-management (98 days behind its own
   origin) and Nexus (12 days) dead. Everything fetches and reads `origin`.
2. Pointing evidence at `operations` would have made every initiative permanently green —
   ~250 commits/90d there are overwhelmingly janitor and cron writes. This is why operations
   is the substrate and not an initiative, and why the author/subject exclusion is global.
3. `git grep` exits 1 on no-match, so the single most valuable signal in the whole check
   (contract-management's endpoint being unreferenced) was printing as a command failure.

**Verified, not assumed:** 10/10 `deriveState` cases pass including `stranded` and the two
`unknown` paths; contract-management's endpoint confirmed by pickaxe at
2026-06-02T03:31 and by grep returning zero in command-center; the Today wiring proven with a
temporary target that produced both a Move and a Clock row, then reverted; `tsc --noEmit`
clean; page renders with no console errors.

**Not done:** the two retrofits and the mini cron above. The board is live and correct on this
machine; it is not yet complete on the machine that will run it weekly.

**Addendum, same day, after the recheck:** the mini's first run proved every claim live
(Contract Management `stranded` 98d, Web presence `idle` 63d, zero unknowns). The recheck
then found three gaps in what "automatic" actually meant: (1) a MacBook run could overwrite
the mini's correct board → the partial-run guard; (2) `/roadmap` was 404 on the live URL
because code deploys were manual → deploy-on-merge; (3) my own daily cron would have
committed daily → timestamps + fingerprint + run log. `/roadmap` is live on the mini as of
20:3x PT. Two installers remain for Pavan to run on the mini's screen.

### Open gates (Pavan)

1. ~~Is `/roadmap` inside the freeze exception?~~ **Answered 2026-09-08: exception granted**
   by Pavan. The page ships now rather than waiting for 09-22.
2. ~~Owners?~~ **Answered 2026-09-08: Pavan owns every roadmap.** Consequence for the schema:
   `owner:` is constant and therefore noise — dropped. Replaced by `waiting_on:` on `handoff`
   initiatives, which carries the fact that actually varies (who holds the ball: the qual-table
   team, Antariksh). Roadmap ownership and execution are different things and only the second
   one moves.
3. **Targets — the one thing still entirely open.** Seeding was mechanical; the dates are not.
   All ten shipped with no target, so the board currently measures activity and nothing else.
   It starts answering "are we on time?" the moment the first date is set.

## Nexus clone freshness for the health scans (2026-09-08)

**Question that started it:** does Paladin's codebase health scan read main or the local copy?
**Answer:** the local clone at `~/repos/Nexus` on the mini, which *is* on main but was only
pulled when a human remembered (last by hand 2026-08-28). Only one scan is live —
`product-weekly-code-scan` (Forge, Mon 03:00 PT); the 12 topic scans (vulnerability, tech-debt,
compliance, rbac…) are `enabled: false`. The live job's prompt never fetches. The old wrapper
`run-nexus-task.sh` did `git pull`, but the live job bypasses it. On 09-08 the clone was 5
commits behind and the 5 were the security fixes (#889–#891) closing Paladin's own C1–C3, C6,
H1, H4–H6, M23/M24/M33/M34 — the 09-14 scan would have re-reported them all as UNCHANGED.

- [x] `scripts/mini/install-nexus-sync.sh` — writes `~/bin/nexus-sync.sh` (ff-only, refuses off
      main or over modified tracked files, never touches the untracked bids/ intel/ drops) and
      LaunchAgent `com.paladin.nexus-sync`, daily 02:30 PT, log `~/.openclaw/logs/nexus-sync.log`.
- [x] Deployed on the mini over ssh 2026-09-08: first run `6708b24a -> 1b454622 (5 commits)`;
      launchd kickstart confirmed `up to date`, exit 0, log written. Clone now 0/0 vs origin/main.
- [x] **No hands on the mini, ever, for this class of change.** Pavan's rule (2026-09-08): one
      synced system. `scripts/mini/post-deploy.sh` lists idempotent mini-side installers, and
      `deploy-on-merge.sh` (the 5-min launchd job that already pulls main and rebuilds) now runs
      it after every pull. Merging *is* deploying, for crons and LaunchAgents as well as code.
      Tested on the mini from a temp copy: installer re-applied, exit 0.
- [ ] Forge prompt patch (second belt: the scan runs `~/bin/nexus-sync.sh` itself). Applied by
      the same hook *if* the Keychain gateway token resolves under launchd; otherwise it logs
      "skipped" and the 02:30 sync alone carries it. Check `command-center-deploy.log` after this
      merge lands to learn which — that answers the standing "can launchd read the Keychain"
      question for every future cron installer too.
- [ ] Optional, when any topic scan is re-enabled: point `run-nexus-task.sh`'s pull at
      `~/bin/nexus-sync.sh` so its `|| true` stops hiding fetch failures.

---

# Phase 13 — Roadmap direction layer (north stars, milestones, the queue view)

**Written 2026-09-08.** Origin: Pavan — build the direction layer from the approved design in
`operations/roadmap/_draft-north-stars.md` (12 rows, 11 north stars, 65 milestones, every claim
sourced) on top of the Phase 12 board. Started from `main` after PR #40 merged (`0d51452`),
verified before planning.

**What changes, in one line.** Phase 12 answered *"are we on time?"* for ten undated
initiatives. Phase 13 answers *"what should I build next, and why?"* — by splitting each
initiative into a **row** (a north star that does not move) and its **milestones** (the 65
things that do), and by teaching the check to read two kinds of proof it could not read before:
a CRM stage (`demand`) and a fact typed once (`decision`).

### The constraints this plan obeys

- **No `status:`, no `owner:`.** Pavan owns every roadmap; `waiting_on:` is the only thing that
  varies. Carried forward from Phase 12's answered gate 2.
- **Authored and derived never share a file.** Anything shown twice is generated. `_`-prefixed
  files in `operations/roadmap/` are derived and never hand-edited.
- **Absence renders unknown, never green.** New corollary for this phase: a milestone whose DoD
  the proof vocabulary cannot express is `proof: manual` and renders **needs-a-person** — never
  `done`.
- **Store timestamps, never ages.** The fingerprint gate stays; a daily cron must not produce a
  daily commit.
- **Read `origin` after a fetch, never a working tree. Refuse to write when a referenced repo is
  not cloned (exit 2).** The real run is on the mini; `--dry` prints anywhere.
- **Human evidence only.** `BOT_AUTHORS` / `BOT_SUBJECTS` for commits; `NON_HUMAN_VIA` for CRM
  touches — `crm/` is janitor-written, so filtering by commit author would be meaningless there.
- **Deterministic where a match decides. No LLM calls.**
- **Build only in `command-center` and `operations`.** Nexus, qual_table_automations,
  contract-management and both website repos are read-only — this phase only ever *reads* their
  `origin/main`. Anything they must change becomes a note under `operations/workflows/`.
- **Feature freeze until 2026-09-22 except `/roadmap`** (exception granted 2026-09-08).
- **Mini-side changes ride `scripts/mini/post-deploy.sh` and deploy by merge.** Only an
  `openclaw cron` change needs Pavan's screen; it gets an exact command, never an ssh run.

---

## 13.1 Schema and files — `operations/roadmap/`

- [x] **`rows/<row>.md` — 12 rows.** Frontmatter: `slug`, `name`, `group`, `kind`, `product`
      (nexus rows only), `north_star`, `strategy` (optional), `repos`, `evidence` (the row's
      default investment paths). Body: the draft's *"what the repo says"* and *"where it stands"*
      paragraphs, then `## Log` (append-only dated lines for retargets and strategic shifts).

      | row | group | kind | product | milestones |
      |---|---|---|---|---:|
      | `candor` | nexus | product | prr | 6 |
      | `steward` | nexus | product | assistants | 6 |
      | `milestone` | nexus | product | delivery-management | 8 |
      | `reporting` | nexus | product | ad-hoc-reporting | 6 |
      | `govhire` | nexus | product | recruitment | 4 |
      | `attest` | nexus | product | plan-review | 3 |
      | `proc` | nexus | product | procurement | 1 |
      | `nexus-platform` | platform | platform | — | 6 |
      | `bidpro` | suite | internal | — | 7 |
      | `contract-management` | suite | product | — | 9 |
      | `command-center` | internal | internal | — | 5 |
      | `web-presence` | web | internal | — | 4 |

      Two `kind` calls to correct if wrong: **BidPro is `internal`**, because "sold to other bid
      teams" is Pavan's open decision #5 and marking it `product` would answer it; **Contract
      Management is `product`**, because its north star (Pavan's own, verbatim) names state and
      local government. `nexus-platform` carries the draft's own sentence as its north star ("the
      platform's star is whichever product stars its milestones serve…") so the lint holds
      without inventing one.

- [x] **`<milestone>.md` at the top level — 65, one per `####` block in the draft**, slug exactly
      as the draft has it. Frontmatter:
      ```yaml
      slug: candor-price          # the draft's, verbatim
      row: candor
      kind: build | handoff | demand | decision
      horizon: now | next | later
      # target:  ONLY where Pavan sets one. The draft's "suggested target" lines are
      #          suggestions and live in the body — so all 65 ship with NO target.
      done: 2026-09-28            # a fact recorded once, never a maintained status
      waiting_on: Pavan
      unlocks: [web-price-list, candor-outbound-ten]
      blocked_on: [web-one-pagers]
      evidence:  [{repo, path}]           # kind: build
      handoff:   {spec, landed, consumed_by, pr}   # kind: handoff
      proof:     [{check: …}]             # kind: demand | decision  (all must be true)
      proven:    [{check: …}]             # optional second-order proof → stage `proven`
      ```
      Body: **done-when**, the draft's source lines (including its suggested target, as prose),
      then `## Log`. Compound kinds in the draft (`build + decision`) take the first-listed kind;
      the second is recorded in the body. Nothing can read green from this: with no target, a
      `build` milestone can only reach `no-target`, never `on-track`.

- [x] **Proof vocabulary — nine checks, and no tenth.**

      | check | fields | reads |
      |---|---|---|
      | `file_exists` | `path` | a path under `operations/` |
      | `frontmatter_field` | `path`, `field` (dotted, `phase0[price-list].done`), `equals` | YAML in an operations file |
      | `decision_resolved` | `path`, `contains` | a `[DECISION]` line carrying `[RESOLVED …]` |
      | `git_path_exists` | `repo`, `path` | `ls-tree` at `origin/HEAD` |
      | `git_grep` | `repo`, `path`, `pattern` | `git grep` at `origin/HEAD` |
      | `flag_default` | `repo`, `path`, `name`, `equals` | a config default (`di_grounding_enabled`) |
      | `contact_stage` | `contact`, `at_least` | one CRM contact's stage, ordinal |
      | `contacts_count` | `product`, `stage_at_least`, `count` | N contacts at or past a stage |
      | `meeting_logged` | `agency`, `title_match`, `after` | `crm/meetings` + `category: agency` |

      Anything the draft describes that these cannot express is **`proof: manual`** and renders
      **needs-a-person** — a new `RoadmapState`, never `done`. Known manual today:
      `bidpro-sourcing-closed-loop` ("thirty days pass with none found outside the workbench"),
      `platform-process-engine` (four triggers, deliberately not framed), `govhire-2e-resilience`.

- [x] **Retire the ten seed files** — their content now lives in `rows/`. **Rewrite `README.md`**
      for the new schema, the four kinds, the proof vocabulary, and the updated not-tracked list
      (**Attest is a row now**; Web Intelligence, Data Intelligence and Echo are not, each with
      the reason). **Keep `_draft-north-stars.md` until 13.5 verifies the split, then delete it.**

- [x] **Lint, inside the check, failing the run and logged:** every `unlocks`/`blocked_on` slug
      exists · no cycles in the unlocks graph · every `build` milestone has `evidence` · every
      `demand` and `decision` milestone has `proof` · every row has a `north_star`.

## 13.2 Derivation — `scripts/roadmap-check.ts`, `src/lib/roadmap.ts`

- [x] **Keep the existing state ladder** for `build` and `handoff` (all ten Phase 12 cases stay
      green). **Add proof evaluation** for `demand` and `decision`: all `proof` checks true →
      `done`; some true → `active`; none → `no-target`; `proof: manual` → `needs-person`.
- [x] **Per-milestone `stage`, separate from `state`** — a ladder, highest reached:
      `framed` (the file exists) → `committed` (target set) → `building` (evidence moved, handoff
      opened, or proof partially true) → `shipped` (`done` recorded or proof true) → `proven`
      (a `proven:` proof true, e.g. `consumed_by`, or thirty clean days after `done`).
- [x] **Per row: investment** — human commits on the row's evidence paths, 30d and 90d.
      `nexus-platform` = all Nexus human commits **minus** those touching any product row's
      paths (set difference on commit SHAs, not a second guess).
- [x] **Per row: pull** — CRM contacts for the row's `product` bucketed by stage, plus meetings
      with `category: agency` in the last 90 days. Derived, written to `_status.md`.
- [x] **Build-next ranking, deterministic:** for each open milestone,
      `score = (milestones reachable through unlocks) × (1 + normalized pull of those milestones'
      rows) + urgency`, where urgency is overdue `+3`, target within 14 days `+2`, `waiting_on:
      Pavan` `+1`. Ties break on slug. Print the top ten with a one-line reason string.
- [x] **`_status.md` keeps its shape** (`generated_at`, `fingerprint`, `checked`, human table)
      and gains milestone rows, per-row investment and pull, and the ranking. Run-log line format
      unchanged, so the freshness contract and the fingerprint gate survive.
- [x] **`roadmap/` joins `DECISION_DIRS`** in `src/lib/gtm.ts` (recursing into `rows/`) so
      `[DECISION]` lines in rows and milestones reach the Today queue.
- [x] **CRM:** add `verbal-commitment` to `CRM_STAGES` after `pilot-discussion`; unknown statuses
      normalize to `active` **with a logged warning** rather than silently.

## 13.3 Page — `/roadmap`, the queue view

- [x] **Top: Build next** (top eight, each with its reason line), then **Decisions** (open
      `[DECISION]` lines from `roadmap/`).
- [x] **Groups in this order:** Nexus products → Platform → Infinite Solutions bid-to-cash
      (BidPro, Contract Management) → Command Center → Web.
- [x] **Row card:** north star, strategy if any, investment (30d / 90d) and pull, then its
      milestones in three columns **Now / Next / Later**. Each milestone: name, kind chip, five
      stage dots, state pill, target or "no target", `waiting_on`. Expanding shows done-when,
      proof, sources, log.
- [x] **The stale banner stays.** Every state on the page comes from `_status.md`; the page never
      computes from a working tree. Split the render into `src/components/roadmap/`.
- [x] **Today:** Moves and Clock keep their roadmap wiring and now read **milestones** — slipped,
      at-risk, stranded, and a decision past its target.

## 13.4 Two data corrections — ask Pavan, then apply

- [ ] `crm/meetings/2026-08-26-oeis-pindy-contracts.md` — add `category: agency` and a `title:`
      the demo pattern (`/\b(demo|walkthrough|poc|pilot)\b/i`) matches.
- [ ] `crm/contacts/pindi-oeis.md` — `status: active-hot` → `active`. The stage stays
      `verbal-commitment`, which the schema knows once 13.2 lands.
      *(These are the only CRM writes in the phase, and neither happens without Pavan's yes.)*

## 13.5 Verify — nothing is done until this passes

- [x] **Unit tests** (`node:test`, run through `scripts/run-ts.mjs`; no test framework exists in
      this repo today): `deriveState` — the ten Phase 12 cases still green · stage derivation ·
      each of the nine proof types · the ranking against a fixed fixture with a known order ·
      the lint (each failure mode fails).
- [x] **`pnpm build` clean.**
- [x] **`scripts/roadmap-check.ts --dry` here** prints every row and every milestone and
      **refuses to write** — that is the correct outcome on a machine missing three repos.
- [x] **Real run on the mini over ssh**, and paste its `_status.md` summary.
- [x] **Screenshot `/roadmap`** in the preview and confirm: every north star visible; Build-next
      order matches the ranking printout; **no milestone reads green without a proof**.
- [ ] Update this Phase 13 with results; `tasks/lessons.md` with anything Pavan corrects.
- [ ] Delete `_draft-north-stars.md` once the split is verified.
- [x] **Open a PR; Pavan merges.** `deploy-on-merge` and the roadmap-check cron are installed on
      the mini via `scripts/mini/`. If they are not, say so — do not touch the mini.

### Open questions for Pavan (asked in-session, not assumed)

1. **The two CRM corrections** above — yes/no before either file is touched.
2. **BidPro's `kind`** — `internal` as planned, or `product` (which answers draft decision #5).
3. **Targets stay empty.** All 65 milestones ship with no `target:`, because the draft's dates
   are labelled suggestions. The board will therefore rank by unlocks × pull and by
   `waiting_on`, and measure no slips at all until the first date is set — the same finding
   Phase 12 produced, one level down.


## Phase 13 review (2026-09-08)

**Built:** `rows/*.md` ×12 and `<milestone>.md` ×65 in `operations/roadmap/` (the ten Phase 12
seeds retired, every seed DoD carried by a milestone); `src/lib/roadmap.ts` rewritten around
rows + milestones + `stage` + the ranking; `src/lib/roadmap-proof.ts` (new — the nine checks,
behind a `GitOps` seam so they are testable without a repo); `scripts/roadmap-check.ts`
extended with proof, investment, pull, ranking and the lint; `src/components/roadmap/` +
`/roadmap` rewritten as a queue; `scripts/roadmap-test.ts` (new — 67 cases).

**What the first real run on the mini actually says.** 12 rows, 65 milestones, lint clean,
**zero targets and zero milestones `done`**:

| state | n | what it means |
|---|---:|---|
| `no-target` | 39 | framed, some moving, nobody has set a date |
| `needs-person` | 16 | `proof: manual` — no check can express the DoD |
| `unknown` | 5 | the five BidPro handoffs (see below) |
| `idle` | 5 | evidence cold ≥30d |

That is the predicted outcome one level down from Phase 12: **nothing here has ever had a
date**, so the board ranks by unlocks × pull and by who is holding the ball, and measures no
slips at all. It starts answering "are we on time?" the moment Pavan sets the first target.

**Investment vs pull — the contrast the two derived numbers exist to show:**

| row | 30d / 90d | pull | reading |
|---|---:|---:|---|
| Candor | 13 / 165 | 0 | 165 human commits, no contact past `identified`, no agency meeting |
| BidPro | 171 / 372 | 0 | the largest spend on the board, internal by definition |
| Nexus platform | 54 / 322 | 0 | the complement — sweeps, correctly not credited to any product |
| Milestone | 7 / 16 | 14 | the inverse: three agency meetings, almost no work |
| Steward | 6 / 74 | 15 | one meeting in 90d — the OEIS correction below made it visible |
| Web presence | 0 / 6 | 0 | red on day one, as designed |

**Two defects this phase found in itself, both before merge:**

1. **A false green in the proof engine.** `flag_default` reused the frontmatter rule where
   `equals: true` means "present and truthy". A source token is a string, so
   `di_grounding_enabled: bool = False` — a non-empty string — read as **done**. Caught by
   verifying the single milestone that came back green on the first `--dry` run instead of
   accepting it. Split into `fieldMatches` (parsed YAML) and `literalMatches` (source tokens),
   pinned by a named regression test.
2. **A proof that would have read done for the wrong reason.** `milestone-cdt-proposal` was
   authored with `contact_stage ≥ contacted` on both CDT contacts — who already sit at
   `pilot-discussion`, so it passed, while the proposal has been owed since 2026-07-29. The
   half that would make it checkable is a human `via` log line, which no check can read. Now
   `proof: manual`. `reporting-first-next-step` was demoted for the same class of reason: its
   DoD is an OR of three routes and a `proof:` list is an AND.

**Correction (same day, after Pavan asked why cron said OpenClaw was unreachable).** I reported
that the roadmap-check cron "was never registered". That was wrong, and the way it was wrong is
the lesson: `openclaw cron list --json` over ssh fails with `GatewaySecretRefUnavailableError`
(the token is a Keychain secret reference and the Keychain is empty in an ssh session), and I
read its empty output as "no such job". The job exists — `f89eaed7-d0da-468b-ad9d-321d38b3064e`,
agent `product`, `0 6 * * 1-5` America/Los_Angeles, enabled, `lastRunAt` undefined because its
first fire is 2026-09-09 06:00 PT. The ssh-safe way to ask is the dashboard's own API, which runs
under launchd and can read the Keychain: it reports `cronReachable: true` and 13 jobs.
`install-roadmap-check.sh` stays in `post-deploy.sh` on its own merits — it is idempotent and
leaves an existing job alone, and the standing rule is that mini state is reproducible from the
repo, which is why install-nexus-sync and install-cron-delivery are already there.

**Open, and now visible rather than hidden:** the five BidPro handoffs read `unknown` because
the mini's `qual_table_automations` clone is single-branch on `main` while that team works on
`staging`. The check now names the ref it searched and says the clone is narrow. The decision
about which ref counts as "landed" is in `operations/workflows/bidpro-handoff-branch-question.md`
— it needs Pavan, and neither option writes to their read-only repo.

**Verified, not assumed:** 67/67 unit tests on both machines (deriveState's Phase 12 cases
unchanged, stage derivation, all nine proof types, the ranking against a fixed fixture with a
known order, every lint failure mode); `tsc` clean on both configs; `pnpm build` clean;
`--dry` on the MacBook prints 12 rows and 65 milestones and refuses to write with 4 repos
missing; the real run on the mini wrote and exited 0; `/roadmap` renders every north star, the
Build-next order matches the mini's printout 1–8 exactly, no console errors, and **no milestone
reads green** — checked by expanding `candor-price` (both checks ✗ with auditable details) and
`milestone-cdt-proposal` (manual).

**Not done, deliberately:** no targets were invented — the draft's dates say "suggested" and
setting them is Pavan's. The retrofit of `verify-claims.ts` / `generate-registry.ts` onto
`REPO_CANDIDATES` is still Phase 12's open item.

---

## Phase 13 addendum — one contact, several products (2026-09-08)

**What Pavan asked:** "yes they should" (DWR and OEIS should show up as CRM demand), then
"Jim Wang is the DWR contact… add interested in".

**What the request turned out to be.** Not a missing-contacts problem. OEIS *was* already a
contact — `crm/contacts/pindi-oeis.md`, `stage: verbal-commitment`, the warmest record in the
book. The problem was that `product?: string` is single-valued, so her own log
("requested follow-up demo of **WMP + PRA**", 08-26; "deeper dive… specifically **PRA**", 08-31)
described three products while the record could claim one. Two consequences, both of which the
board was stating as fact:

- **Attest could not score pull at all.** Zero of 104 contacts carried `plan-review`, so `pull 0`
  was arithmetic, not a finding.
- **Candor's "165 human commits in 90 days and no recorded pull" was false.** A CIO was twice on
  record asking for PRA, filed under `product: assistants`.

**The change.** An additive `interested_in: [slug, …]`, never a replacement for `product`.
`wantsProduct()` in `src/lib/config.ts` is the single place that answers "does this contact want
X?", and the split it encodes is the point: things that measure **demand** (row `pull`, Today's
demand signals, the `contacts_count` proof) read `product` OR `interested_in`; things that measure
**attribution** (pipeline shape, owner load) keep reading `product` alone, so one person still
counts once in the charts. Row demand totals deliberately no longer partition the book.

- [x] `wantsProduct()` in `lib/config.ts`; `interestedIn` on `CrmContact` + `CrmContactUpdate`
- [x] `crm.ts` reads, writes, creates and patches it (patch normalizes + dedupes like `altEmails`)
- [x] `roadmap.ts` demand signals, `roadmap-proof.ts` `contacts_count`, `roadmap-check.ts` `rowPull`
- [x] `crm/contacts/jim-wang.md` created — DWR Deputy CIO, `product: plan-review`,
      `interested_in: [assistants]`, `stage: meeting-booked`
- [x] `pindi-oeis.md` gains `interested_in: [prr, plan-review]`
- [x] Logged in both row files, `attest-first-tenant`, and `roadmap/README.md`

**Jim Wang, and what is evidence vs. lookup.** Email `Jim.Wang@water.ca.gov`, the ISI AI Demo he
organized with Ganapathy, and the three uncreated DWR attendees (Mark Liu, Robert Crowell,
Zachary Waller) all come from `intelligence/priority-outreach.md:31` — an internal record of a
real thread, not a guess. The **title** (Deputy CIO) is from a public professional-profile lookup
and the file says so; treat it as unverified. `stage: meeting-booked`, not `demo-given`, because
the outreach item still carries "confirm demo outcome" and Pavan is explicit that DWR has not
been shown Attest. Asking and being shown stay different signals.

**Found while verifying, fixed:** `attest-oeis-demo` carried
`title_match: '(?i)(demo|walkthrough|poc|pilot)'`. `(?i)` is a Python inline flag; JS RegExp
throws on it, so the check returned "not a regex" rather than evaluating. It was masked —
`deriveState` reached `no-target` first — but would have gone `unknown` the moment a target was
set. Pattern fixed and `lintRoadmap` now rejects a proof pattern that will not compile: absence
renders unknown, a typo should render loud, at lint time.

**Verified, not assumed:** 80/80 tests (was 75; +4 for `wantsProduct`/`interested_in`, +1 for the
regex lint), `tsc --noEmit` clean, `--dry` lints clean. Pull deltas on this MacBook, where the
CRM is local and current:

| row | before | after | why |
|---|---:|---:|---|
| Attest | 0 | **9** | Jim Wang (meeting-booked) + Pindy via `interested_in` + 1 agency meeting |
| Candor | 0 | **7** | Pindy via `interested_in` + 1 agency meeting |
| Steward | 15 | **17** | Jim Wang's `interested_in: assistants` — the demo he actually convened |

Investment columns in that same `--dry` read 0/0 for BidPro, Contract Management and Web presence
because those clones are not on this machine. That is the check working; the real numbers come
from the mini.

**Still open:** the three other DWR attendees are named but uncreated — Pavan named only Jim.

---

## Phase 13 addendum — context sessions 2 and 3 (2026-09-08)

Eight answers from Pavan. Four resolved standing decisions; four defined things the board was
asserting without being able to check.

| | answer | what changed |
|---|---|---|
| **#8 Allocation** | a **sequence**, not a split | CM + BidPro to live → both to maintenance; warm demand resourced by **headcount**, not by moving effort off the first two |
| **#5 BidPro** | internal tool, confirmed | no product slug, no demand column, no price; 337 commits/month = overhead. Handoff written for the contradicting plan doc |
| **Web Intelligence** | delete per M7 | chat surface + module shell out, crawl/search stay as tools; `waiting_on` moves from nobody to the Nexus team |
| **Contract Management** | Pavan takes it over | Antariksh's 8-week gap is a change of hands, not a stall; four `waiting_on: Pavan` items become his own queue |
| **CM "live"** | our own book runs on it | `cm-production-books` is now the definition — and it was already #3 in Build-next, so the ranking agrees with the stated goal rather than merely correlating |
| **BidPro "live"** | the team stops using the old way | adoption. Deliberately unmeasurable here and left `proof: manual` — a proxy would read done while people quietly work around the tool |
| **Demo tenant API** | always-on container, not serverless | Attest examines 747 pages in one run; function timeouts break exactly that. **Already containerized** (`deployment/docker/Dockerfile.api`), so it is a deploy-target choice |
| **Headcount** | surface the squeeze, don't track people | new `demandWithoutInvestment` signal |

### The squeeze signal

`rowSignals()` in `src/lib/roadmap.ts` — the two ways effort and demand can disagree, as mirrors:

- `investedWithoutPull` — effort with nobody asking (existing, moved out of the component)
- `demandWithoutInvestment` — **pull ≥ 5 and under 10 human commits in 30 days**: somebody warm is
  asking and nobody is building

Reads only commits and demand, the two things already derived. It says *"somebody is asking"*, never
*"assign someone"* — Pavan asked for the squeeze without the board tracking people, so the read that
the answer is a hire stays his.

Thresholds checked against the real board rather than picked in the abstract: pull ≥ 5 is one
contact at `verbal-commitment`; inv30 < 10 is under ~two commits a week. It fires on Attest (8/9),
Steward (6/17) and Milestone (7/14) and nothing else — exactly the rows behind Pavan's own sentence,
"the two products with warm agencies got 18 between them".

- [x] `rowSignals()` extracted, both directions, with the reasoning at the definition
- [x] `row.tsx` renders the mirror in accent, distinct from the amber over-invested warning
- [x] Verified rendering live on Steward and Milestone (screenshot in the PR)
- [x] Handoffs for the two read-only repos: `workflows/web-intelligence-retire.md`,
      `workflows/bidpro-internal-not-product.md`

**Corrected mid-task:** I checked `~/repos/Nexus` for a Dockerfile, found nothing, and nearly
recorded "the API is not containerized". That path does not exist on the MacBook — Nexus is
`~/infiniteai_platform` here (`~/repos/Nexus` is the *mini's* path). `deployment/docker/Dockerfile.api`
exists, which flips the demo-API decision from a project into a deploy-target choice.

**Verified:** 81/81 tests (was 75 at the start of the day), `tsc` clean, eslint clean, `--dry` lints
clean at 13 rows / 66 milestones.

**Still open:** the `pull` columns, the cleared Candor warning and Attest's new squeeze flag all
land when the mini regenerates `_status.md` — `_` files are derived and this machine refuses to
write them. The vendor for the demo API container is deliberately unpinned.

---

## Phase 13 addendum — context session 4 (2026-09-08)

**CRM backfill, found by scanning rather than by asking.** I ran the same pattern that hid OEIS
across every human-written log line: which contacts mention a product they are not filed under.
Three candidates, two real:

- **Shafi Mohammed** (OEIS) — title *is* "Wildfire Mitigation Plan program", log records a
  "wildfire mitigation plan comparison demo" in Sept 2025, filed `assistants` → `[plan-review]`.
  The finding underneath: Attest's flagship use case had **already been demoed** to the OEIS
  program owner a year ago and the board could not see it.
- **Robert Payne** (CDT) — the July demos named a "PRA module" and "ad hoc querying" →
  `[prr, ad-hoc-reporting]`.
- **Amarjot** — rejected. Matched only on "procurement" meaning their *buying process*, not the
  Proc product. Exactly why this field is set by a person and never inferred.

Pull moved more than predicted, because **agency meetings flow through the same filter**:

| row | before today | after | note |
|---|---:|---:|---|
| Attest | 0 | **12** | Jim Wang, Pindy, Shafi |
| Candor | 0 | **17** | Pindy + Robert; meetings 90d 0 → 4 |
| Reporting | 3 | **13** | Robert; meetings 90d 0 → 3 |
| Steward | 15 | **17** | Jim Wang |

**`reporting-eval-live` retired** (Pavan: drop the nightly eval). ~$490/mo warehouse, last run
failed on missing secrets 2026-07-20. The consequence is written into the row rather than left
implied: **the accuracy claim in the OEIS deep dive is now unverified, not pending.** A milestone
left open implies someone intends to close it.

**Handoff checks search integration branches** (Pavan: "fetch staging too because i need to know
where progress is frequently"). Three parts:

- `scripts/mini/widen-clones.sh` — new, in `post-deploy.sh`, so it deploys by merge. Rewrites a
  clone's refspec **only when it is explicitly single-branch**, and fetches once. Local clone
  config only: nothing is written to any remote, so the read-only rule is untouched.
- `INTEGRATION_REFS = ['staging']` in `roadmap-check.ts` — deliberately a short list, not "every
  remote branch". A literal on an abandoned feature branch is not landed, and reporting it as
  merged would be worse than reporting nothing.
- `handoff_ref` recorded and **shown** — `merged at origin/staging` never reads as `merged`.

Two bugs in my own installer, caught by running it: `mapfile` is bash 4 and macOS ships 3.2; and
because it failed, an *empty* refspec read as "narrow" and the script rewrote a clone that was
already correct (harmless — it set git's own default — but the same mistake on a deliberate partial
clone would not be). Both fixed; absent refspec now means leave alone.

**Verified:** fixture repo reproducing the exact BidPro shape — narrow clone cannot see
`origin/staging` and greps 0 hits on `main`; after widening it sees staging and finds the literal
there. 81/81 tests, `tsc` clean, eslint clean, `--dry` lints clean.

**NOT verified, and it cannot be from here:** the wiring inside `checkHandoff` against the real
`qual_table_automations` — that repo is not cloned on this MacBook. The five BidPro handoffs
resolve on the mini's next run after the merge. `checkHandoff` has no unit seam (unlike the nine
proof checks, which have `GitOps`); worth adding, not tonight.

**Open:** targets for `cm-production-books`, `platform-hosted-demo` and `attest-oeis-demo` — Pavan
chose to date those three; the dates themselves are still his to give.

---

## Phase 13 addendum — the handoff seam (2026-09-08)

**The gap.** The nine proof checks take git through `GitOps`, so a test can hand them a fake repo.
`checkHandoff` did not — it reached for `openRepo`/`grepAtRef`/`git` directly, so it could not be
tested at all. Five milestones ran through it, every one of them BidPro, which is the row Pavan
said he needs frequent visibility into. Zero coverage.

It showed the moment I changed it for the staging-branch work: I could only verify with a throwaway
git fixture, which proves **git behaves as I assumed**, not that **my code calls git correctly**.

**The fix.** `HandoffOps` — a second seam in `roadmap-proof.ts`, deliberately not folded into
`GitOps`: the nine checks want one ref per repo, a handoff wants several, and widening `GitOps.open`
would have touched nine working tested checks to serve one with no tests. One implementation object
in the script satisfies both. `evalHandoff` now holds the logic; `checkHandoff` is a 12-line
adapter; every git-specific decision (which refs count, what "narrow" means, where a spec lives)
sits in the implementation.

- [x] 12 tests, 83 → **95**. Cover: merged on the default ref · merged on `staging` when `main`
      lacks it (the BidPro case) · default ref wins when both have it · not-found naming every ref
      and flagging a narrow clone · `consumed` outranking `merged` · a reference outside
      `consumed_by` NOT counting · an unreachable command-center not blocking the merged answer ·
      pr/spec fall-through with age from an injected `now` · a declared-but-missing spec being an
      error not `spec-sent` · no-repo vs unusable-repo · nothing-declared being `unknown`.
- [x] **Verified behaviour-neutral**: `--dry` output byte-identical before and after, 67 lines of
      git-coupled logic moved.

**Found while refactoring, and it would have hit the mini.** `landedRefs` probed for
`origin/staging` with `rev-parse --verify`. `runCommandArgs` swallows the non-zero exit, so it
worked — but it logged `Command failed: git … origin/staging` for every repo with no staging
branch, which is most of them. On this MacBook the probe never ran (the row repo isn't cloned, so
`openRepo` errored first); the refactor routed `command-center` through the same path and exposed
it. Now one `for-each-ref` listing intersected against `INTEGRATION_REFS` — no error path, no noise.
A cron log that cries wolf every run is a log nobody reads when something real breaks.

---

## Phase 13 addendum — a spec is not a landing (2026-09-09)

**What broke.** Four BidPro handoffs read red: *"Merged 0d ago, still not consumed here."* On the
mini, all four `landed:` literals resolve at `origin/staging` to exactly one file —
`docs/unified-bid-system-plan.md`, commit `1064ccde` by Pmurugesh at 12:29:59 — OUR plan, PR'd into
THEIR repo. BidPro had shipped nothing; the check matched the document that named the tables.
Three of the four had no `consumed_by:`, so "not consumed" was asserted without ever being tested.
And `consumed` was decided from our repo alone, before theirs was read — a placeholder field in
`RemoteBid` ("asked for in the handoff, not served yet") would have read as the handoff paying off.

**The fix** — engine first, data after deploy (the data change is unsafe under the old engine).

- [x] `landed` matches CODE only: `PROSE_PATHSPECS` excludes `*.md`/`docs` on both sides; optional
      `landed_in:` narrows further. The matching file is recorded (`handoff_file`) and shown.
- [x] `consumed` implies `merged`: their side first, ours only on top of it; consumed carries their
      ref and file.
- [x] `merged` with no `consumed_by` renders `active` ("no consumer declared"), never `stranded`.
- [x] Not-found names what it saw: "appears only in prose at … (file)" / "only outside landed_in".
- [x] Found on the way: `handoffRef` was parsed from `_status.md` but never joined onto the
      milestone, so "at origin/staging" never rendered. Joined, with `handoffFile`.
- [x] Tests for each; tsc, lint, build clean; the real git invocations proved against the mini's
      clone over ssh (read-only).
- [ ] AFTER merge + deploy: operations — `spec:` on p1–p3, p0 `consumed_by → src/lib/bid-sync.ts`,
      README schema, Log lines. `bidpro-won-signal` stays as is (`awarded_at` is in no spec yet).
- [ ] Trigger roadmap-check on the mini and read the board back.

---

# Phase 14 — The layout pass (2026-09-09) — DONE

## How this was measured

Dev server at 1728x1080 and 2560x1440, `getBoundingClientRect` over every
route, plus a Range-based measurement of *painted* text extent per list row (so
`truncate`d text is not counted as if it filled its box). Four parallel page
audits read every page component and the data on disk.

## Diagnosis — "whitespace" was four separate defects

### 1. The outer gutter — a hard 1280px cap

`layout.tsx` wrapped every page in `max-w-7xl mx-auto`:

| Window | Content | Wasted | Window used |
|---|---|---|---|
| 1440px | 1201px | 15px | 83% |
| 1728px | 1280px | 224px | 74% |
| 2560px | 1280px | **1056px** | **50%** |

The app was designed at ~1440px, where it is fine. Every pixel past that was
thrown away. Grid breakpoints across `src/`: `md:` x13, `lg:` x5, `xl:` x1,
`2xl:` x0 — from 768px to 2560px the layout never changed, it only stretched.

### 2. The inner dead gap — stretched rows (fixing #1 alone makes this WORSE)

Every list is `flex items-center justify-between` with `min-w-0 flex-1` left and
a `shrink-0` chip cluster right. Across Today's 30 rows at 1182px:
**median dead gap 873px — 74% of the row.** Widening the container widens the
hole. Rows want ~520px, which is what columns give them.

### 3. Vertical bloat — marketing defaults + collapse-by-default

`card.tsx` was stock shadcn: `p-6`, `text-2xl`. **15 of 27 `CardHeader`s
overrode to `pb-3`, and every single `CardTitle` overrode down.** The default
was wrong and was being patched one call site at a time.

/intel was the extreme: **6,949px to read 3,237 characters** — 61 cards, zero
expanded on load, so the entire height was chrome.

### 4. Accidental measure — markdown width was unowned

Three call sites, three measures, none deliberate: 768px in /library and
/bids/[id] (squeezing 42-row tables), ~160ch in /gtm, ~180ch in
/meetings/[slug]. This is why "fill the page" cannot be applied uniformly —
prose wants ~78ch, tables want everything.

## The fix — three layout modes, not one column

- **Board** — data. Full width; children flow into responsive ~520px columns.
- **Reader** — documents. Index rail + pane; prose capped, tables break out.
- **Focus** — forms and stubs. Centred and narrow; the only correct cap.

## Results, measured at 1728x1080

| Page | Height | Screens | chars/px |
|---|---|---|---|
| /intel | 6,949 → **1,073** (−85%) | 6.7 → 1.0 | 0.47 → **4.96** |
| /library | 4,121 → **1,040** (−75%) | 4.0 → 1.0 | 1.61 → **6.77** |
| /gtm | 2,804 → **1,040** (−63%) | 2.7 → 1.0 | 1.82 → **10.13** |
| /health | 3,136 → **1,040** (−67%) | 3.1 → 1.0 | 4.63 → **11.41** |
| /meetings | 2,738 → **1,040** (−62%) | 2.6 → 1.0 | 1.44 → **5.11** |
| /bids | 2,840 → **1,362** (−52%) | 2.7 → 1.3 | 0.91 → **3.85** |
| / (Today) | 5,706 → **3,757** (−34%) | 5.5 → 3.6 | 1.22 → 1.86 |
| /roadmap | 5,874 → **4,488** (−24%) | 5.6 → 4.3 | 1.37 → 1.84 |
| /channels | 2,948 → **1,650** (−44%) | 2.8 → 1.6 | 0.91 → 1.68 |
| /content | 3,204 → **2,056** (−36%) | 3.1 → 2.0 | 1.40 → 2.18 |
| /agencies | 2,300 → **1,858** (−19%) | 2.2 → 1.8 | 0.91 → 1.12 |
| /intake | 1,908 → **1,486** (−22%) | 1.9 → 1.4 | — → 2.28 |

Window used: **74% → 86% at 1728px; 50% → 91% at 2560px.**
Median row dead gap on Today: **873px → 454px.**

### What actually moved the needle

The container cap was the loudest defect but the smallest win — removing it
alone bought ~5% vertical on Today. **Columns and density did the rest.** The
pages that improved most are the ones whose layout MODE changed, not the ones
that merely got wider. Worth remembering the next time "it feels empty" gets
diagnosed as "the container is too narrow".

## Verified
- [x] `pnpm build` exit 0; `tsc --noEmit` clean; `next lint` clean.
- [x] 2560px: 91% of window used, Today 2.7 screens.
- [x] 1440px and 375px: zero horizontal overflow; sidebar still hidden on
      mobile; the bids table scrolls itself rather than the page.
- [x] Prose measure ~78ch; tables break out (verified /gtm 1,184 → 787px prose,
      /library table 768 → 1,041px).
- [x] /gtm#lead-rules opens the right doc instead of a collapsed card.

## Not done — still open in 14.2
The /system trio merge into one Machine page, /bids/[bidName] file+fact rails,
the /intel procurements table, the /outreach coverage strip, /agencies
master-detail, /content status kanban, and the /roadmap row-summary strip and
milestone matrix (rows went two-up instead). Each is written up above with its
measured cause.

---

# Phase 15 — Outreach drafts: stop internal shorthand reaching customers (2026-09-09) — DONE

`buildDraft()` interpolated two CRM fields straight into the email body:

```
The next step we agreed was: {contact.nextAction}
I know this is waiting on {contact.blockedOn} — happy to help move that along.
```

Those are shorthand written for Pavan. Real values on disk: `Personal follow-up
— upsell`, `Call — offer free 30-day pilot`, `Warm product path — services
client with no product conversation started`, `Confirm current status — six
meetings through Feb 2026, then silence`, and `blocked_on: product one-pager
does not exist`. Both bypassed `externalSafe()`, which only screened for repo
paths. The body also opened with `It has been {n} days since we last spoke` —
leading with our own neglect, frozen at write time, wrong within a week.

**One was sent.** `robert-cdt-mmbi`, `sent_at: 2026-09-01`, to a state CIO's
office.

## Who was responsible: not an agent

`writeDraft()` emits the commit trailer `via: dashboard`, and both bad drafts
carry it — so they came from the Draft button, not from any agent or cron.
Confirmed on the mini: no agent instruction mentioned `crm/drafts`, and nothing
in `scripts/` writes there. `pindi-oeis.md` — the one good draft — arrived as a
janitor `auto:` sweep, i.e. written directly, bypassing the template.

## Fixed
- `buildDraft` interpolates no internal field at all. Internal context moved to
  frontmatter `notes`, shown behind a "Context · not sent" disclosure.
- `findInternalLeaks()` enforced in `writeDraft()` — the invariant was
  previously a comment above the function that violated it.
- `scripts/verify-drafts.ts` sweeps every draft on disk, including
  agent-written ones that bypass `writeDraft`. Gates unsent leaks; records
  already-sent ones without failing, since a permanently-red check is ignored.
- operations (pushed): `workflows/follow-up-email.md`, the AGENTS.md content
  rule, both poisoned drafts regenerated, `pindi-oeis.md` → `edited: true`.

## Verified
- [x] All 108 contacts swept through `buildDraft`: **0 bodies leak an internal field**.
- [x] `verify-drafts.ts`: 0 unsent leaks, 1 already-sent recorded.

## Still open
- `robert-cdt-mmbi` is sent and cannot be unsent.
- Phase B unbuilt: 9 contacts need a draft and have none — see Phase 16.

---

# Phase 16 — Outreach Phase B: the auto-trigger scan (spec, 2026-09-09)

Phase A (queue, copy, edit, mark-sent) shipped. Phase B fills the queue. Today
the only thing that creates a draft is clicking **Draft** on Today's Moves.

## Design: code detects, agent writes, human sends

| Layer | Owner | Why |
|---|---|---|
| Detection — who needs a follow-up, and why | **code** | must be reviewable and identical every run |
| The brief — facts, thread, recipient, history | **code** | the agent must not go looking for its own facts |
| The prose | **agent** | the thing a template provably cannot do |
| The safety gate | **code** | applied to agent output too |
| Send | **human** | unchanged |

The deterministic template produced three emails that all leaked and one that
was sent; the only good draft in the store was agent-written. Turning `Warm
product path — services client with no product conversation started` into a
sentence a client should read is a language task.

**Precedent: Scribe** — already an agent-writes-artifacts cron (07:30/16:00,
staged mail → proposals, `.judgment-ledger` mtime as heartbeat, see
`src/lib/insights.ts:300`). Phase B is the same shape.

## B.1 Detection — `scripts/scan-outreach.ts`

| Trigger | Source | Rule |
|---|---|---|
| `crm-due` | `bucketize()` → overdue, dueToday | `nextActionDue` ≤ today on a worked contact |
| `cold-contact` | `bucketize()` → goingCold | `daysSinceTouch ≥ CRM_COLD_DAYS` (21) |
| `post-meeting` | `listMeetings()` + contact log | meeting whose contacts have no log entry and no draft after `meeting.date` |
| `bid-submitted` | `listBids()` | ships LAST, behind a flag — see below |

**`bid-submitted` ships last.** The only bid→contact join is the `agency`
string, many-to-many and unvalidated; CDT has several contacts, and emailing all
of them because one bid was submitted is worse than not emailing.
`discoveryEvent.businessUnit` is a tighter key and should be evaluated first.

### Suppression — matters more than detection
Never generate when: an unsent draft exists; a draft was sent within 14 days;
the contact is **blocked** (their blocker is our problem, not theirs); the
contact is **not-started** (`bucketize` separates these from `goingCold`
deliberately — "picking this back up" is a lie to a stranger); or the contact is
terminal.

Net target: overdue(1) + dueToday(1) + goingCold(8) = 10, minus drafted = **~9**.

### Volume cap
**5 new drafts per run** in steady state, oldest-aging first. A cap turns a bad
rule into a small mess rather than an outbox-shaped one.

## B.2 The brief — `buildBrief(contact, log, meetings, bids)`
A typed object, never prose. `intent` carries `nextAction`/`blockedOn`
explicitly so the writer knows *why* without mistaking them for sendable copy.
**Must also carry the last inbound message and whether it went unanswered** —
see the archive findings below.

## B.3 The writer
```ts
interface DraftWriter { write(brief: Brief): Promise<{subject, body, sender} | null> }
```
- **`AgentWriter`** — `openclaw agent --agent main`, prompted with the brief plus
  `operations/workflows/follow-up-email.md` as the rubric. **Primary.**
- **`TemplateWriter`** — today's `buildDraft`. Fallback on any failure.

### Two traps this codebase already documents
1. **`openclaw agent` exits 0 on a dead model call** (`insights.ts:305`). Exit
   status is not success — validate that output exists and is non-trivial.
2. **`triggerAgent()` (`intake.ts:77`) is fire-and-forget with `--deliver
   --channel telegram`** — it returns nothing. Confirm `openclaw agent` can
   return stdout synchronously before building on it; if not, the agent writes
   the draft file itself and the scan reads it back (the `pindi-oeis` route, now
   documented in the workflow doc).

## B.4 The gate — agent output is not trusted
Every draft passes `findInternalLeaks()` before persisting. The brief hands the
writer `nextAction` and `blockedOn`, so **the agent is the most likely future
source of exactly the leak Phase 15 fixed.** On failure: discard, fall back to
template, record.

## B.5 Schedule and install
Weekdays **07:15 PT**, before the 08:00 sales brief.
`scripts/mini/install-outreach-scan.sh`, idempotent, following
`install-bid-sync.sh`, added to `post-deploy.sh` **`GATED_INSTALLERS`**
(`--if-possible`, needs the gateway token). Deploys by merge. Register in
`scripts/heartbeat.ts` so a stopped scan is noticed — nothing currently consumes
`lib/heartbeat.ts`, and this is a reason to.

## B.6 Verify — not done until this passes
- [ ] `--dry` prints what it would create and why, writing nothing.
- [ ] Re-running immediately creates **zero** additional drafts.
- [ ] Blocked and not-started contacts are never drafted.
- [ ] `verify-drafts.ts` green after a real run.
- [ ] Force an agent failure → template fallback, scan still exits 0.
- [ ] Feed the agent a contact whose `next_action` is `Personal follow-up —
      upsell` and confirm the gate catches it if the agent echoes it.

## Decisions taken (2026-09-09)
1. **The agent path is live.** `AgentWriter` is primary; `TemplateWriter` is the
   safety net, not the plan.
2. **First run approved by hand, once.** `--dry` prints all ~9, reviewed in one
   pass, then a single `--apply`. The 5/run cap governs steady state only.
3. **Sender is per-thread, not per-contact** — settled by evidence, below.
4. **Contacts with no email** — 5 of 6 backfilled; skip the last with a
   data-gap flag rather than drafting to nobody.

## What the mail archive proved (2026-09-09)

- **`Christine.Asiata@lci.ca.gov`** — 34 messages, recovered from
  `crm/intake/email/`. Backfilled with `amarjot-ctc`, `mark-liu`,
  `robert-crowell`, `zachary-waller`, each verified by matching the address
  domain to the contact's agency. `john-wood` deliberately left empty: the
  archive's "John" hits were `jjohnston@comerit.com` and
  `peterjohn@4infinitesolutions.com`, substring matches against a DDS contact.
- **The premise of her follow-up was wrong.** Her last message is 2026-02-26 —
  one day *after* the recorded `last_touched`, and **inbound**. She shared the
  CEQA folder and asked us to *"provide some dates and times"*. Nobody replied,
  for 196 days. That inbound was missing from the CRM log entirely.
- **Sender cannot be a contact-level field.** She addressed Gana and Saravanan
  and only CC'd Pavan. `sender` must derive from the thread being answered,
  defaulting to Pavan only for genuinely new outreach.

**This is the Phase B acceptance test.** If `AgentWriter`, given Christine's
brief, produces a reply into the OPR-0650 thread that answers her question with
dates and does not open by announcing 196 days of silence, the design works.

---

## Phase 14 — the board follows the repos (2026-09-09)

**Why.** Today's test failed on every axis. Pavan and two devs pushed 55 commits across four
repos; the board showed none of them. Three causes, all mechanical: roadmap-check runs weekdays
08:00 only; it reads ONE ref per repo (`origin/HEAD`), so staging and every `claude/*` branch are
invisible; and 56 of 65 milestones can only reach `done` by someone typing a date, because build
and handoff milestones never had their proof evaluated even when declared. Pavan's ruling: the
board must be in sync with the repos, and "as much as possible, nothing should be manual — a
booked meeting is a calendar invite, not a person's say-so."

**Design.** No webhooks: the mini is tailnet-only and GitHub cannot reach it. Same pattern as
`commandcenter-deploy` — a launchd tick that asks origin whether anything moved.

- [x] 14.1 `scripts/mini/install-roadmap-watch.sh` — `com.paladin.roadmap-watch`, every 5 min:
      `git ls-remote --heads --tags origin` per clone (no fetch), hash the head list, compare to
      `~/.openclaw/state/roadmap-watch.heads`; on change POST
      `localhost:3000/api/system/cron/roadmap-check/run` (same path as the Rescore button, so the
      Telegram announce and the check log both happen); fall back to running the script directly if
      the dashboard is down; keep the old state on failure so the next tick retries. Registered in
      `post-deploy.sh` and in `heartbeat.ts` (declared gap 1h).
- [x] 14.2 Branch-aware evidence in `roadmap-check.ts`: `lastHumanCommit` and `humanCommitShas`
      scan `--remotes=origin` (dedup by SHA). The ref the newest commit was reached from is
      recorded as `last_evidence_ref` and rendered ("on claude/mailbox-ingestion") when it is not
      the default ref. Proof and handoff stay on main + staging: unmerged work is movement, never
      landing.
- [x] 14.3 Proof on every kind: `checkProof` runs for any milestone with a proof list, not only
      demand/decision. `deriveState` for build/handoff: proof fully true → `done` ("Proof satisfied
      n/n"); partial proof is shown in the reason. `deriveStage` unchanged. Lint allows proof on all
      kinds. `ProofList` renders for build/handoff when a proof exists.
- [x] 14.4 Tenth check, `calendar_event` — `{ title_match, after?, before? }` against the ICS
      feeds the dashboard already reads (`calendar.ts`), fetched once per run over a −90/+180 day
      window. A feed that will not fetch renders the check false with "calendar unreachable" in the
      detail — never a silent false. `meeting_logged` stays the check for "it happened".
- [x] 14.5 The Telegram announce carries the delta: when the #1 build-next changes, stdout leads
      with "Build next moved: A → B" so the team sees the new objective, not a table.
- [x] 14.6 Tests for each new branch (111 → 118); tsc, lint, build clean; `--dry` proved against
      the mini's clones over ssh from a scratch copy of this branch (read-only). Found on the way:
      `%S` names the ref git reached a commit from FIRST, so PR #47's commits read "on
      claude/design-…" an hour after merging. Fixed with `merge-base --is-ancestor` against the
      default ref: landed → no ref; otherwise the branch. After the fix: cc- milestones show
      today's date and no branch; cm- show 20:32 "on origin/claude/vibrant-payne-319061"; bidpro
      investment 171 → 184 (staging now counts).
- [x] 14.7 operations: README schema (proof on every kind, `calendar_event` + `attendee_domain`,
      `absent: true`, the watcher), proof blocks applied from a 65-milestone audit: **9 files /
      17 checks → 48 files / 107 checks**; 10 `proof: manual` with a stated reason; 7 build
      milestones left without proof because every candidate literal was a guess (a guessed proof
      that reads done for the wrong reason is worse than none). Four evidence-path defects fixed
      on the way (`Contract` lives in `shared.py`; two is-website files were filed under
      infiniteai-website; stale migration numbers; `supportsSandbox` is documented, not coded).
      Lint `[]`. The operations janitor (5-min tick) carries the edits to the mini.
      Still inexpressible: an OR of routes (`reporting-first-next-step`), a human-`via` CRM log
      line (`milestone-cdt-proposal`), live Supabase state (`cm-redesign-live`,
      `cm-second-live-book`), a reachable URL (hosted demo). Each is a candidate eleventh check
      with a named data source — see the Phase 14 review.
- [x] 14.8a Full `--dry` on the mini with all 107 checks (operations carried over by the
      janitors in ~8 min): 13s wall; 3 proofs fully true — `cc-direction-layer` 4/4 and
      `cc-scoreboard-truth` 3/3 are genuinely done; **`forge-triage` 1/1 was a wrong-reason
      green** (its `[DECISION]` grep matched `roadmap-test.ts`), replaced with a path check for
      the script it must produce. `calendar_event` reports "no calendar feeds configured" on the
      mini: `~/.openclaw/workspace/.credentials/calendar.json` exists on neither machine, so the
      check is honest but undecidable until Pavan places the ICS URLs there (a credential — his).
- [x] 14.8b PR #48 merged 21:01, deployed to the mini 40s later (acb3a27); post-deploy loaded
      `com.paladin.roadmap-watch`; first tick 04:04Z took the baseline over 7 repos (the five
      origin-less clones are skipped). The board is still the 08:00 snapshot until the next push
      to any repo or a Rescore — Pavan asked that Rescore not be clicked for him.
- [ ] 14.8 AFTER merge + deploy: watch `~/.openclaw/logs/roadmap-watch.log` on the mini for the
      first triggered tick, read the board back, confirm Jessica's staging work shows as movement
      on bidpro and the four cc- milestones moved to today's date.

**Not in scope.** Unpushed commits (nothing can see them — push at end of day is a team rule).
Linear/intent tracking (separate decision). Network-probe checks ("URL reachable") — still refused.

## Phase 14 addendum — BidPro is built by someone else, and the board should say what (2026-09-09)

**Pavan:** "I need to track her progress of what she is working on so I can step in and
supplement — answering the handoff questions or doing them." And: "just because they are internal
tools doesn't mean they shouldn't have milestones — implemented and used, these save money,
increase engagement or boost revenue."

- [x] The BidPro row held only handoffs and decisions (what the suite needs from BidPro). Its body
      said "read-only — every milestone is a handoff or a decision, never an edit", which conflated
      *not editing her repo* with *not tracking her work*. Reworded: two lists side by side.
- [x] Six `kind: build` milestones drafted from Jessica's own `docs/<workstream>-plan.md` files
      (subagent, every literal verified at origin/staging, main and the DMV branch): form grammar,
      scan requirement fixes, extraction eval corpus, multitenancy, staging database, docx form
      fill. Six `[DECISION]` lines carry the questions her trackers leave to the owner — they queue
      on Today. Rulings already recorded are listed so nothing is re-asked. 65 → 71 milestones,
      lint `[]`.
- [x] Found on the way: **proofs read `origin/main` only** (`GIT.open` → `originRef`), while
      handoff literals read main + staging. BidPro integrates on staging and releases in batches
      (main 29 commits behind), so a proof would flip weeks after the work. `openForProof` now
      returns `landedRefs`; present proofs hold at the first ref and say which, `absent` must hold
      at every ref, `flag_default` reads the first ref that has the file. Test added (120).
- [ ] After merge: dry run on the mini shows `bidpro-docx-form-fill` 1/1 (finished 09-08, Pavan
      may type `done:`), `bidpro-scan-requirement-fixes` 0/3 until the DMV branch merges.

**Are there others like BidPro?** No. Of 13 rows, BidPro was the only one with repos and zero build
milestones. `gtm` and `proc` have no build milestones because their one milestone each is a
decision by nature. What IS true of every `kind: internal` row (bidpro, command-center, gtm,
web-presence): the build-next ranking's pull term is CRM demand, which internal tools cannot earn,
so they rank only through `unlocks` and targets. That is a design choice worth a look, not a bug —
an internal tool that saves money has no contact at `meeting-booked`.
