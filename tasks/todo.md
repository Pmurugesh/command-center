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
