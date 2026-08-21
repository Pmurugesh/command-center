# Lessons Learned

## Project-Specific
(none yet)

- **[2026-08-21]** The one-way rsync mirror had stranded 26 files — including FTB's
  final response + compliance matrix — not just the 3 known .status.json orphans. Lesson:
  before retiring/replacing any sync mechanism, diff BOTH directions file-by-file; the
  known divergence is usually the tip. (Found during M0 git adoption; recovered in a1ca540.)

- **[2026-08-21]** Two M1 bugs that only appeared on the FIRST REAL RUN, not in typecheck or
  build: (a) a lock that treated every mkdir failure as contention, so a missing parent dir
  burned the full timeout and reported the wrong cause — catch-alls in retry loops must
  distinguish "busy" from "broken"; (b) serialize() adding a `# Name` heading that parse()
  handed back as body content, so every read-modify-write appended another copy. Lesson: for
  any file format, explicitly test N consecutive round trips — single-write tests pass while
  the format quietly accretes.
- **[2026-08-21]** Seeding judgement: the first seeder gave all 94 contacts the agency-level
  "recommended next step" as next_action and blocked ~60 on a one-pager. That invents a to-do
  list nobody committed to and makes `blocked` meaningless. Distinguish COMMITMENTS (8 owned,
  dated actions) from LEADS (86 researched contacts) — leads surface as "going cold", which is
  their true state.

- **[2026-08-21]** Never derive "how fresh is this data" from file mtime in a git-backed store:
  a clone stamps every file with the checkout time, so the M2 health panel reported the intel
  scans as "0d old" when they had been dead for 37 days — the exact failure that panel exists
  to catch. Read the date from the filename (`2026-07-08-daily.md`) or from git. Same class of
  error as the original Phase 4.3 activity-feed design.
- **[2026-08-21]** The mtime-freshness trap bit twice in one day, in code written six weeks
  apart (PR #5's `getPipelineFreshness`, and M2's health panel). Both reported dead pipelines
  as fresh once operations became a git repo. When a signal exists to detect silence, verify it
  on a CLONE, not just on the machine that produced the files.
- **[2026-08-21]** Seeding a store from research produced the same class of error three times in
  one session: badge scans became "88 days cold", a plan that never started became "85 days
  overdue", and 92 business cards were listed as pipeline. Each time the fix was the same —
  distinguish INVENTORY (we hold this person's details) from COMMITMENT (someone decided to
  pursue them). When seeding any future store, make that distinction in the first write rather
  than discovering it three corrections later. A board that shows research as though it were
  owed work is both false and demotivating, and it is the fastest way to make someone stop
  opening the tool.
