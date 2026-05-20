Read CLAUDE.md and review the current state of the app.

# Command Center UI Overhaul — Readability & Design

The dashboard is functional but hard to read and doesn't look polished. Fix this.

## Design System

### Color Palette (Dark Mode)
- Background: `slate-950` (#020617)
- Card background: `slate-900` (#0f172a)
- Card border: `slate-800` (#1e293b)
- Primary text: `slate-100` (#f1f5f9)
- Secondary text: `slate-400` (#94a3b8)
- Accent blue: `blue-500` (#3b82f6)
- Success green: `emerald-500` (#10b981)
- Warning amber: `amber-500` (#f59e0b)
- Error red: `red-500` (#ef4444)
- Info purple: `violet-500` (#8b5cf6)

### Typography
- Use clear hierarchy: page title (2xl bold), section headers (lg semibold), card titles (md semibold), body (sm)
- Increase line height for readability (leading-relaxed on body text)
- Use font-mono for data values, counts, dates
- Ensure adequate contrast — no light gray on medium gray

### Spacing
- Consistent padding: cards get p-6, sections get gap-6 between them
- Don't cram content — whitespace is readability
- Page content max-width for wide screens (max-w-7xl mx-auto)

## Page-by-Page Improvements

### Overview (/)
- Hero section: system health as a large, clear indicator (green circle with "All Systems Operational" or red with count of issues)
- Stats row: 4 cards with large numbers (bids analyzed, requirements tracked, scans this week, active opportunities)
- Bid pipeline: horizontal kanban-style cards grouped by status (Analyzing → Draft Ready → Submitted → Won)
- Critical alerts: red-bordered cards that stand out
- Recent activity: timeline-style feed of latest actions across all systems
- Remove clutter — only show what needs attention

### Bids (/bids)
- Card grid (not a list) — each bid gets a card with:
  - Bid name (large, bold)
  - Entity badge (IS / NovaEra / InfiniteAI) in entity color
  - Status badge (color-coded)
  - Agency name
  - Key dates
  - Coverage % as a progress bar
- Click → detail view

### Bid Detail (/bids/[bidName])
- Clean tabbed interface — active tab clearly highlighted
- Tab content: render markdown with proper prose styling (prose-invert for dark mode)
- [HUMAN DECISION NEEDED] flags: render as prominent red alert boxes with icon
- Sticky tab bar at top when scrolling
- Document list sidebar showing raw files
- Metadata card at top: entity, status, dates, coverage

### Health (/health)
- Report cards with severity indicators
- Critical findings count as red badge
- Expand/collapse for full report
- Last scan timestamp prominent
- Delta indicators ("+2 new", "-1 resolved")

### Intel (/intel)
- Daily alerts as a scrollable feed with dates
- Weekly briefings in expandable accordion
- Executive summary pulled out and highlighted
- Category filters (procurement / policy / competitor / tech)

### Library (/library)
- File tree with icons (📁 folders, 📄 files)
- Click file → render markdown in a reading pane
- Search bar to find content across library

### System (/system)
- Cron jobs as a table with clear status badges
- "Run Now" buttons prominent
- Group by category with collapsible sections
- Next run times in human-readable format ("in 3 hours", "tomorrow 2am")
- Scripts list with last-modified dates

## General UI Rules
- All tables: use alternating row backgrounds for readability
- All badges: rounded-full, consistent size, clear color meaning
- All timestamps: relative ("3 hours ago") with hover for exact time
- Loading states: skeleton placeholders, not blank pages
- Empty states: helpful message with icon, not just blank
- Error states: clear message with retry option
- Smooth transitions between pages (no flash of unstyled content)
- Sidebar: compact, icons + labels, active item highlighted with accent color
- Mobile responsive (at minimum readable on tablet for screen share)

## New Pages to Add

### Finance Alerts (/finance)
- Read from ~/repos/operations/finance-alerts/ (when it exists)
- Show sanitized alerts only (overdue payments, missing timesheets, contract renewals)
- No dollar amounts or rate data — just action signals
- Link to "Open Finance System" button that opens the separate app
- If no data exists yet, show placeholder: "Finance system not connected yet"

### Opportunities (/opportunities)
- Read from opportunity generator output data
- Scored pipeline view
- Agency cards with signal strength
- If no data exists yet, show placeholder: "Opportunity generator not connected yet"

### Content (/content)
- Read from ~/repos/content-engine/
- Show drafts by entity and status
- Calendar view for the week
- If no drafts exist, show placeholder

## Verification
- [ ] All pages load without errors
- [ ] Dark mode consistent everywhere — no white flashes or wrong backgrounds
- [ ] Text is readable at normal zoom — good contrast, clear hierarchy
- [ ] Cards have clear borders/separation
- [ ] Status badges are color-coded and consistent
- [ ] Markdown renders with proper prose styling
- [ ] No horizontal scroll on any page
- [ ] Navigation is clear and responsive
- [ ] Empty states look intentional, not broken
