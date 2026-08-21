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
