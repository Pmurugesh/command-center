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
- [ ] **Tier 2 — derive the facts that can be derived.** A weekly sync reads the platform's
      module manifests + git and regenerates `products/_registry.md` (marked DO NOT HAND-EDIT):
      canonical slug, display name, mounted, license-gated, LOC, route/component counts, last
      commit touching the module. Authored positioning (tagline, buyers, market evidence,
      pricing) stays in the per-product files. **Derived and authored facts never share a
      file** — the same split that fixed the bid statuses.
- [ ] **Tier 2a — make status claims checkable.** "demo-ready" / "needs-frontend" are currently
      remembered, not measured. Derive the signals: does the module have a frontend beyond a
      nav shell, a demo seed endpoint, tests? `procurement` is "needs-frontend" because its
      frontend is 102 lines — that is a computable fact, not an opinion.
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
- [ ] **Integration shape: command-center reads, qual-table fetches.** The qual-table backend
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

## Open gates

1. ITN-37485: submitted-then-disqualified (`lost`) or pulled-out-first (`no-bid`)?
2. FTB: confirm `status: submitted, stage: pre-response`.
3. Private GitHub repo for operations: OK?
4. Granola signup + MacBook app install.
5. RFO site name.

## Review
(to be filled in per milestone)
