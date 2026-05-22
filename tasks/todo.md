> **⚠ Read `tasks/next-session.md` FIRST.** A pickup instruction from Pavan is waiting there and takes precedence over anything in this file.

# Phase 3: Page-by-Page UI Rebuild

Goal: turn the dashboard from "file viewer" into something Pavan opens daily and feels good using. Use [QUEUED-UI-OVERHAUL.md](../QUEUED-UI-OVERHAUL.md) as the spec; deliver in small phases with screenshots after each so we can course-correct.

---

## Phase 3.0 — Setup & foundation (must come first)

These are the cross-cutting changes that every later phase depends on.

- [ ] **Seed sample data** locally (`~/repos/Nexus/bids/`, `intelligence/`, `tasks/reports/`, etc.) so the UI actually renders during iteration. 2 sample bids with 4-6 markdown files each, 3 intel alerts, 2 scan reports, a few library files. This data stays in `.gitignore`'d directories so it never gets committed.
- [ ] **Design tokens**: replace the HSL theme in `globals.css` with the slate palette + named status colors from the queued doc. Expose as semantic CSS vars (`--status-success`, `--status-warning`, etc.) AND extend Tailwind config so usage stays terse.
- [ ] **Layout container**: `max-w-7xl mx-auto` on `main` in [src/app/layout.tsx](src/app/layout.tsx). Otherwise everything stretches on wide monitors.
- [ ] **Loading skeletons**: add `loading.tsx` for `/`, `/bids`, `/bids/[bidName]`, `/health`, `/intel`, `/library`, `/system`, `/system/cron`. Skeleton component shared.
- [ ] **Fix StatusBadge**: today only 3 of 8 bid statuses get a real color (Won/Lost get colors, everything else collapses to slate). Add explicit color mapping for Discovered / Analyzing / Draft Ready / Under Review / Submitted / No-Bid.
- [ ] **font-mono utility**: add JetBrains Mono (or similar) for numeric data — stat values, dates, durations, sizes.

**Verification**: dev server runs, every page renders with sample data, no console errors, tsc clean.

---

## Phase 3.1 — Bids list ([src/app/bids/page.tsx](src/app/bids/page.tsx))

- [ ] Remove duplicated `displayName` + `name` (lines 37, 42)
- [ ] Remove file-name chip cloud (lines 52-60) — pure noise
- [ ] New card layout: entity badge (color per entity) · status pill (full workflow colors) · doc count · "X decisions needed" (if `totalFlags > 0`)
- [ ] 3-col grid on `lg`, 2 on `md`, 1 on `sm`
- [ ] Sort/group by status (active bids first, Won/Lost at bottom)

**Out of scope** (data gap): agency name, deadline, coverage %. Flag for follow-up.

---

## Phase 3.2 — Bid detail ([src/app/bids/[bidName]/](src/app/bids/[bidName]/))

- [ ] Group the 13 tabs into 4 logical sections — Analysis / Strategy / Response / Compliance. Use a two-level nav OR a left rail of tabs.
- [ ] Sticky tab bar + action-items banner when scrolling
- [ ] Source documents → right-side rail (not footer)
- [ ] [HUMAN DECISION NEEDED] flags rendered as red alert cards inline in markdown, not just inline badges

---

## Phase 3.3 — Health ([src/app/health/](src/app/health/))

- [ ] Drop the 4-stat row at top (redundant with per-row badges)
- [ ] Sort reports: critical → has new findings → resolved-only → clean
- [ ] Inline severity strip on each card (red/yellow/green left border)
- [ ] Last-scan timestamp prominent in the header

---

## Phase 3.4 — Intel ([src/app/intel/](src/app/intel/))

- [ ] Drop the 4 stat cards (duplicates the tabs below)
- [ ] Single nav: tabs only
- [ ] Pull each alert's executive summary out as the visible preview (not just date + filename)
- [ ] Category filter chips inside each tab
- [ ] Date strip showing alert density over recent days

---

## Phase 3.5 — Library ([src/app/library/](src/app/library/))

- [ ] Search bar above the tree (fuzzy match on filenames + content)
- [ ] "Recently viewed" pinned at top of tree
- [ ] Slightly better tree typography + folder icons
- [ ] Reader pane: respect prose width, add a copy button

---

## Phase 3.6 — System + Cron ([src/app/system/](src/app/system/))

- [ ] **Decide**: merge `/system` + `/system/cron` into one page with tabs, or keep split. Recommend merge — cron is the only thing System has, the split is artificial.
- [ ] Cron rows: failed jobs at top, tighter row layout (clear hierarchy: name · status · next/last, not 5 inline pieces of muted text)
- [ ] Hover-reveal "Run Now" button instead of always-on
- [ ] Group cron by category in a collapsible accordion instead of separate cards
- [ ] Remove or commit on "Coming soon" Finance/Email cards (lines 103-122)

---

## Phase 3.7 — Overview ([src/app/page.tsx](src/app/page.tsx)) — do LAST

Held until other pages settle, since Overview composes signals from them.

- [ ] Reframe as "Today" — actionables, not summaries
- [ ] **Decisions needed**: roll up `totalFlags` across all bids with deep links
- [ ] **Failures**: failed crons + critical scan findings as one combined list
- [ ] **Today's briefing**: latest intel alert with executive summary excerpt
- [ ] **Deadlines** (placeholder until data exists): next 7 days of cron next-runs as a proxy
- [ ] Remove 5-card stat row
- [ ] Remove Quick Actions row (sidebar duplicates)
- [ ] Mini-kanban moves to /bids as a view toggle

---

## Phase 3.8 — Layout shell

- [ ] Sidebar: flatten the 4 collapsible sections, replace with subtle dividers. 6 items don't need accordions.
- [ ] Top bar: either delete (move health to sidebar footer) or earn the space — next-upcoming-deadline + cmd-K placeholder
- [ ] Sidebar gets entries for Finance / Opportunities / Content with "Not connected yet" empty-state pages

---

## Verification (after each phase)

- [ ] `pnpm dev` running, no console errors
- [ ] Screenshot each touched page (compare before/after)
- [ ] `pnpm exec tsc --noEmit` clean
- [ ] `pnpm build` succeeds
- [ ] Commit per phase so we can revert any phase independently

---

## Data gaps to flag (NOT in scope for this rebuild)

These would unlock UI we want but require touching the data layer:
- Bid: `agency`, `deadline`, `coverage` % — likely from frontmatter
- Intel: structured `executive_summary` field
- Scan reports: structured severity level (not just regex over content)
- Bid detail: per-tab "last updated" timestamp

Suggest tackling these as Phase 4 after the UI rebuild settles.

---

## Review (filled in as we go)

_To be added after each phase._
