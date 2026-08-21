# Lessons Learned

## Project-Specific
(none yet)

- **[2026-08-21]** The one-way rsync mirror had stranded 26 files — including FTB's
  final response + compliance matrix — not just the 3 known .status.json orphans. Lesson:
  before retiring/replacing any sync mechanism, diff BOTH directions file-by-file; the
  known divergence is usually the tip. (Found during M0 git adoption; recovered in a1ca540.)
