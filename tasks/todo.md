# Phase 2: Production Hardening & Feature Expansion

## Architecture Foundation
- [x] `src/lib/config.ts` — Centralized paths, polling intervals, sidebar/views config, bid statuses, entities, tab ordering, cron categories
- [x] `src/types/index.ts` — Full types for bids, reports, intel, cron, system health, library, data sources, scripts
- [x] Shared component library: StatusBadge, MarkdownRenderer (with [HUMAN DECISION NEEDED] badges), DataCard, PageHeader, EmptyState, LoadingState, ErrorBoundary, TimeAgo, FileTree
- [x] Hooks: usePolling, useSystemHealth
- [x] API client: `src/lib/api.ts` — typed fetch wrappers for all endpoints

## API Routes
- [x] Error handling on all existing API routes (try/catch, proper HTTP status codes)
- [x] `GET /api/system/health` — Aggregate health (cron status, critical findings, bid count)
- [x] `POST /api/system/cron/[id]/run` — Run cron job on demand
- [x] `GET/PUT /api/bids/[bidName]/status` — Bid status tracking (stored in .status.json)
- [x] `GET /api/library` — Response library file tree
- [x] `GET /api/system/info/data-sources` — Data source status
- [x] `GET /api/system/info/scripts` — Script inventory

## Sidebar & Navigation
- [x] Dynamic sidebar driven by NAV_SECTIONS config (not hardcoded)
- [x] Collapsible sections: Operations, Engineering, Intelligence, System
- [x] Active page highlighting
- [x] Collapsible sidebar (panel icon toggle)
- [x] Top bar with system health dot + current date/time

## Pages
- [x] Overview (/) — Health aggregate, stats row, quick actions, critical alerts, mini-kanban bid pipeline, cron summary, latest intel
- [x] Bid Pipeline (/bids) — Cards with status, entity, document count, file tags
- [x] Bid Detail (/bids/[bidName]) — Auto-discovered tabs (14 files, ordered per spec), action items banner with flag counts, status dropdown, entity selector, source document viewer
- [x] Cron Jobs (/system/cron) — Grouped by category, Run Now button, last run details, TimeAgo
- [x] Codebase Health (/health) — Reports with delta badges, critical counts, expandable rendering
- [x] Intelligence (/intel) — Tabbed: Daily / Weekly / Procurement, expandable alerts
- [x] Response Library (/library) — File tree browser + markdown renderer
- [x] System Settings (/system) — Data sources with status, scripts inventory, placeholder Finance/Email sections

## Verification
- [x] All pages return 200 (verified: /, /bids, /health, /intel, /library, /system, /system/cron)
- [x] All API endpoints return 200 (/api/system/health, /api/bids, /api/library)
- [x] TypeScript compiles clean (`npx tsc --noEmit` — exit 0)
- [x] Next.js build succeeds (`pnpm build` — all routes compiled)
- [x] Real data renders: 2 bids, 14 files in FTB bid, 12 decision flags, 1 source doc, 5 library files
- [x] Bid detail tabs auto-discover from files (14 tabs for FTB bid)
- [x] Tab ordering matches spec (inventory → requirements → gap-analysis → ... → delta-log → rest)
- [x] [HUMAN DECISION NEEDED] rendered as red alert badges via CSS
- [x] Dark mode is default with consistent slate palette
- [x] No hardcoded bid names, report names, or file paths in components
- [x] Auto-discovery: new bid folder / report / intel file / library file appears automatically

## Results
Phase 2 complete. Dashboard expanded from 4 pages to 8 pages with:
- 10 API endpoints (5 new) with proper error handling
- 9 shared components + 2 custom hooks
- Config-driven sidebar with collapsible sections
- System health aggregate (green/yellow/red)
- Bid status tracking persisted in .status.json
- Cron job "Run Now" capability
- Response library browser with file tree navigation
- All 200+ TypeScript types, zero `any` leaks in components
