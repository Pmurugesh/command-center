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
- **[2026-08-24]** Reported "your mini is down" from `ping` failing. The machine was up —
  Tailscale's coordinator showed `Online: True`; only the peer-to-peer path was dead
  (`Active: False`, last handshake the previous morning). This is the fourth instance of one
  error this session: reporting a PROXY as the thing itself. A truncated grep became "no
  pricing exists"; a records check became "zero outbound touches"; a `last_touched` date became
  "88 days cold"; unreachability became "down". **State what the evidence shows, not what it
  suggests** — "I can't reach it from here" is both true and more useful than "it's down", and
  it points at the right fix instead of the wrong one.
- **[2026-08-24]** Twice this session, work was pushed to a branch whose PR had ALREADY merged
  (leads → PR #12, email connector → PR #14). Commits pushed to a merged branch have no path to
  `main`, and nothing surfaces it: `git status` is clean, the push succeeds, and the branch
  looks healthy. Both were found by accident — an import failing because `store.ts` was absent
  from a fresh branch, and a check for `sync-email.py` on main. **After a PR merges, start the
  next branch from `origin/main`** rather than continuing on the merged one. The
  "Deployed build" health row catches the deploy half of this; the branch half has no detector
  yet, so the habit is the control.
- **[2026-08-24]** A prior session "fixed" 12 dead bid-facing citations by repointing them at
  live files — and claimed "nothing claimed to the state was false." Independent triage
  against platform origin/main showed SIX of the twelve claims were false (OutputValidator
  and connector resilience deleted as never-wired dead code, code-level mTLS replaced by
  plane JWTs, Datadog removed) — the repoint made the VERIFIER pass while the PROSE stayed
  wrong, which is strictly worse than the honest failure: red is a work item, false green is
  a trap. **A citation fix must re-verify the claim, not just the path** — open the target
  file and confirm it contains the claimed capability before repointing. This is Tier-1's
  documented limit (citations resolve ≠ claims true) being exploited by a well-meaning fix;
  Tier-2's derived registry is the structural cure.
- **[2026-08-24]** Diagnosed "the mini sleeps" from consistent circumstantial evidence — one
  auto-commit per day at exactly 03:05, unreachable the rest of the time, a pending
  needs-sudo pmset fix that made the story satisfying. Ground truth: `uptime` said 32 days,
  the sleep log had ZERO sleep events. The machine never slept once. The actual fault was the
  Tailscale data path, and the second outage was cured by cycling Tailscale on the OBSERVING
  machine (`tailscale down && up` on the MacBook) — the remote side needed nothing. Two rules:
  **check ground truth (`uptime`, `pmset -g log`) before asserting machine state**, and
  **when a peer is unreachable, falsify your own network client first** — it is the only
  component you can test AND fix without the peer's cooperation, and here it was the culprit.
  Corollary: a fix applied right before recovery (waking the machine, the pmset command) gets
  credited by narrative, not evidence — the second outage 10 minutes later disproved both.
- **[2026-08-25]** Traced the cron false-green correctly in the CODE (unreachable openclaw →
  `''` → `[]` → "0 failing" → green) and then asserted it was live on the mini, having
  reproduced the `GatewaySecretRefUnavailableError` over ssh. The live instance disproved it in
  one curl: `/api/system/health` was already returning `overall:red, cronFailed:2`. The
  dashboard runs in a GUI login session where the secret ref resolves; my ssh session is a
  *different environment*, and I had generalized from it. Same family as the mini-sleep entry
  above, one layer in: **reproducing a failure in your own shell does not establish that the
  service fails — ask the running service.** Any long-lived process has an environment
  (PATH, keychain, session) that ssh does not share, so when one is up and exposes its own
  state, query THAT before describing production. The code defect was real and worth fixing;
  the claim about its live impact was not.
- **[2026-08-25]** Wrote the session plan with `cat > tasks/todo.md <<'MD'` and silently
  destroyed 854 lines of Phase-5 history. `git diff --cached --stat` caught it — "890
  deletions" on a file I thought I was creating — and `git show HEAD:` restored it. A
  heredoc `>` is a delete plus a write, and on a path that already exists the delete is the
  part you did not intend. **Append (`>>`) to living project files, and read the target before
  any `>` redirect to a path you did not just create.** Reviewing `--stat` before committing is
  the backstop that turned this into a non-event; the habit is not to need it.
- **[2026-08-25]** The email connector had logged `touches in 0 / out 0` for 124 consecutive
  runs and every surface agreed: 11 of 104 contacts had a `last_touched`, and Today told Pavan
  to chase Robert Payne as "27d overdue". A 180-day dry sweep found **76 real messages** — six
  CDT demo-prep threads, Caltrans, DMV, 32 of them SENT by him — and the CRM was simply wrong.
  Cause: `IMAP_SINCE_DAYS` defaults to 30, the connector went live ~Aug 24, and the most recent
  business thread was Jul 22, **34 days old**. It had been faithfully reporting zero against an
  empty window. The script's own docstring said "use a large number once for a backlog sweep";
  that one-time sweep was never run. **A steady stream of zeros from a filter is not evidence of
  absence — widen the window and re-run before believing it.** From the log alone a filtered
  message and a nonexistent one are identical, and the number that proved it (34 days) was
  visible on the dashboard the whole time, one line from the "0 touches" it contradicted.
- **[2026-08-25]** Built follow-up drafts from CRM log entries and the first output for Wesley
  Namikawa read: "Where we left off: Reporting tool demo delivered to Caltrans (date approximate
  — Pavan noted 2026-08-21 that this demo happened but was never recorded). Demo queries are
  documented in the Nexus repo at docs/reporting/caltrans_demo_reference.md." That was one click
  from being emailed to a Caltrans official. Log entries are written FOR US and carry internal
  bookkeeping, repo paths, and candid asides. **Anything assembled from internal notes and
  pointed outward needs an explicit external-safe pass** — strip parentheticals, take the first
  sentence, and return NOTHING rather than something questionable. "The user edits before
  sending" is not a safety argument; the default has to be safe on its own.
