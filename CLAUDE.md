# CLAUDE.md — Founder Command Center

## Project Overview
A local web dashboard for monitoring and interacting with all OpenClaw workflows, bid analysis, codebase health, and strategic intelligence. Built for a single user (Pavan) running on a Mac mini.

## Tech Stack
- **Framework**: Next.js 14+ (App Router)
- **Styling**: Tailwind CSS + shadcn/ui components
- **Data**: File-driven — reads markdown files and shell commands, NO database
- **Runtime**: Node.js on Mac mini, served locally (accessible on local network)
- **Package Manager**: pnpm

## Architecture: File-Driven Dashboard
This dashboard does NOT have its own database. All data lives in existing files:

### Data Sources
```
~/repos/Nexus/bids/                          ← Bid pipeline (folders = bids, .md files = reports)
~/repos/Nexus/bids/_platform-knowledge.md    ← Platform capability inventory
~/repos/Nexus/bids/_requirement-tracker.md   ← Cross-bid requirement tracking
~/repos/Nexus/bids/_response-library/        ← Response templates and style guide
~/repos/Nexus/tasks/reports/                 ← Codebase scan reports
~/repos/Nexus/intelligence/                  ← Research/intel reports
~/.openclaw/workspace/business/              ← Business context files
~/.claude/scheduled-tasks/                   ← Task definitions
```

### System Status (via shell commands)
```
openclaw cron list --json                    ← Cron job status, next/last run
openclaw status                              ← OpenClaw system health
ps aux | grep claude                         ← Active Claude Code processes
```

### Key Design Principle
When a new workflow is added (new bid folder, new cron job, new report type), the dashboard should auto-discover it. No manual wiring. Scan directories and render what's there.

## Dashboard Views

### 1. Overview (/)
- System health: OpenClaw status, cron jobs summary (green/yellow/red)
- Active bid pipeline: card per bid with coverage %, stage, entity
- Latest critical alerts from intelligence
- Quick stats: bids analyzed, requirements tracked, scans run this week

### 2. Bid Pipeline (/bids)
- All bids as cards/rows: name, stage, entity, dates, coverage
- Click → bid detail view with all reports rendered as HTML
- Status tracking: analyzing → draft ready → under review → submitted → awarded

### 3. Bid Detail (/bids/[bid-name])
- Tabbed view: inventory | requirements | gap analysis | strategy | response draft | action items
- Render markdown as formatted HTML
- Highlight [HUMAN DECISION NEEDED] flags

### 4. Codebase Health (/health)
- All scan reports with latest results
- Delta indicators (new issues, resolved, unchanged)
- Click into any report for full detail
- Timeline view when multiple runs exist

### 5. Intelligence (/intel)
- Daily alerts feed
- Weekly briefings
- Procurement pipeline
- Filter by: procurement | policy | competitor | technology

### 6. Response Library (/library)
- Browse company profiles, capability blocks, methodology templates
- Tag-based filtering
- Which bid used which content

## API Routes (Server-Side)
Use Next.js API routes to:
- Read and parse markdown files from the data source paths
- Execute shell commands for system status (openclaw cron list, etc.)
- Return JSON to frontend components
- Use `gray-matter` for frontmatter parsing, `marked` or `react-markdown` for rendering

## File Structure
```
command-center/
├── CLAUDE.md
├── package.json
├── next.config.js
├── tailwind.config.js
├── tasks/
│   ├── todo.md
│   └── lessons.md
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx              ← Overview
│   │   ├── bids/
│   │   │   ├── page.tsx          ← Bid pipeline
│   │   │   └── [bidName]/
│   │   │       └── page.tsx      ← Bid detail
│   │   ├── health/
│   │   │   └── page.tsx          ← Codebase health
│   │   ├── intel/
│   │   │   └── page.tsx          ← Intelligence feed
│   │   ├── library/
│   │   │   └── page.tsx          ← Response library
│   │   └── api/
│   │       ├── bids/
│   │       ├── health/
│   │       ├── intel/
│   │       ├── system/
│   │       └── library/
│   ├── components/
│   │   ├── layout/
│   │   ├── bids/
│   │   ├── health/
│   │   ├── intel/
│   │   └── shared/
│   ├── lib/
│   │   ├── files.ts              ← File reading utilities
│   │   ├── markdown.ts           ← Markdown parsing/rendering
│   │   ├── shell.ts              ← Shell command execution
│   │   └── paths.ts              ← Data source path constants
│   └── types/
│       └── index.ts
└── public/
```

## Workflow Orchestration

### 1. Plan Mode Default
Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
If something goes sideways, STOP and re-plan immediately - don't keep pushing
Use plan mode for verification steps, not just building
Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy to keep main context window clean
Offload research, exploration, and parallel analysis to subagents
For complex problems, throw more compute at it via subagents
One task per subagent for focused execution

### 3. Self-Improvement Loop
After ANY correction from the user: update 'tasks/lessons.md' with the pattern
Write rules for yourself that prevent the same mistake
Ruthlessly iterate on these lessons until mistake rate drops
Review lessons at session start for relevant project

### 4. Verification Before Done
Never mark a task complete without proving it works
Diff behavior between main and your changes when relevant
Ask yourself: "Would a staff engineer approve this?"
Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
For non-trivial changes: pause and ask "is there a more elegant way?"
If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
Skip this for simple, obvious fixes - don't over-engineer
Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
When given a bug report: just fix it. Don't ask for hand-holding
Point at logs, errors, failing tests -> then resolve them
Zero context switching required from the user
Go fix failing CI tests without being told how

## Task Management
- Plan First: Write plan to 'tasks/todo.md' with checkable items
- Verify Plan: Check in before starting implementation
- Track Progress: Mark items complete as you go
- Explain Changes: High-level summary at each step
- Document Results: Add review to 'tasks/todo.md'
- Capture Lessons: Update 'tasks/lessons.md' after corrections

## Core Principles
- Simplicity First: Make every change as simple as possible. Impact minimal code.
- No Laziness: Find root causes. No temporary fixes. Senior developer standards.
- Minimal Impact: Changes should only touch what's necessary. Avoid introducing bugs.

## Environment
- macOS (Apple Silicon)
- Node.js 22+
- pnpm
- Data source paths use `~` which resolves to `/Users/paladin`
- Dashboard runs on port 3000 (or next available)
- Only accessible locally / on local network — no auth needed
