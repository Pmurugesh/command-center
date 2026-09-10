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
- **[2026-09-08]** Phase 13's proof vocabulary shipped a false green for about ten minutes.
  `flag_default` reused `fieldMatches`, whose `equals: true` rule means "present and truthy" —
  the right reading for a YAML frontmatter field, where `0` and `false` are real values. But a
  flag default is lifted out of SOURCE, so the value is always a **string**, and the non-empty
  string `"False"` is truthy. `di_grounding_enabled: bool = False` read as `done`. The first
  `--dry` run caught it only because I stopped to verify the single milestone that came back
  green instead of taking the pass at face value. **A comparison helper is written against one
  type of input; reusing it on another type is a silent coercion bug, not reuse.** There are now
  two named functions — `fieldMatches` for parsed YAML, `literalMatches` for source tokens — and
  a regression test that names the date. The wider rule: **when a check you just wrote reports
  success, go read the underlying file before believing it.** A vocabulary designed to prevent
  false greens is worth nothing if its own first green is unverified.
- **[2026-09-08]** Five BidPro handoff milestones resolved to `unknown` on the mini, with the
  useless reason "Handoff state not resolved". The cause was two levels away from the roadmap
  files: the mini's `qual_table_automations` clone is single-branch
  (`+refs/heads/main:refs/remotes/origin/main`), and that team's work merged into `staging` —
  a branch the clone can never fetch. The check was answering correctly against a ref that is
  not where the answer lives. **When a check reports "cannot tell", the reason string has to
  name what it looked at**, or the finding costs an investigation every time someone reads the
  board. The state is now `unknown` with `"<literal>" not found at origin/main in
  qual_table_automations — and this clone tracks only origin/main`, and the decision about which
  ref counts as "landed" went to Pavan in `operations/workflows/` rather than being guessed.
- **[2026-09-08]** Five subagents authored the 65 milestone files in parallel and three of them
  flagged judgement calls I then had to overturn — most importantly `milestone-cdt-proposal`,
  where a `contact_stage ≥ contacted` proof would have read **done** because both CDT contacts
  already sit at `pilot-discussion`, while the proposal itself has been owed since 2026-07-29.
  The agent followed my instruction exactly and said so rather than silently deviating, which is
  the only reason it was caught. **When fanning out authoring work, require the report to name
  every judgement call — and read those reports as findings, not as status.** Three of the five
  reports contained a defect in MY specification, not in their work.
- **[2026-09-08]** I told Pavan the roadmap-check cron "was never registered". It was — enabled,
  weekdays 06:00 PT, simply not yet fired. The check I trusted was `openclaw cron list --json`
  over ssh, which fails with `GatewaySecretRefUnavailableError` because the gateway token is a
  Keychain secret reference and **the Keychain is empty in an ssh session**. I had piped it
  through `grep -c` and read `0` as absence. **A grep over a command that failed to authenticate
  counts zero the same way an empty result does — check the exit status and the stderr, not just
  the matches.** The ssh-safe way to ask the gateway anything is the dashboard's own API, which
  runs under launchd and can read the Keychain (`cronReachable: true`, 13 jobs); that path was
  already recorded in memory and I reached for the CLI anyway.
- **[2026-09-08]** The board asserted "Candor: 165 human commits in 90 days and **no recorded
  pull**" and "Attest: pull 0". Both were arithmetic, not findings: `product?: string` on a CRM
  contact is single-valued, nobody in 104 contacts carried `plan-review`, and the OEIS CIO's own
  log recorded her asking for two products she could not be filed under. **A derived metric can
  only be as true as the schema underneath it can express. Before reporting a zero as a finding,
  ask whether the field could have been non-zero at all** — a metric that is structurally
  incapable of a value is a schema bug wearing the costume of a fact. The tell was available the
  whole time: `plan-review` appeared in no contact anywhere, and a product-demand column where
  one product is categorically absent should have read as broken, not as bad news.
- **[2026-09-08]** Pavan's "yes they should" (make DWR and OEIS visible as demand) looked like a
  two-record data-entry task. It was a schema change plus one record — OEIS already existed, and
  the missing half for DWR was a name I did not have. **I stopped and asked rather than creating a
  plausible contact**, and the name he gave then unlocked a real internal source
  (`intelligence/priority-outreach.md:31` already had Jim Wang's email, the demo he organized, and
  three more uncreated attendees) that was better evidence than the web lookup he offered.
  Asking for the one fact I was missing was cheaper than inventing it and cheaper than guessing.
- **[2026-09-08]** `title_match: '(?i)(demo|…)'` — a Python inline flag in a JavaScript RegExp.
  The check returned "not a regex" instead of evaluating, and it was invisible because
  `deriveState` reached `no-target` first for an unrelated reason. **Authoring errors and genuine
  unknowns must not render the same.** Absence renders unknown by design; a pattern that cannot
  compile now fails in `lintRoadmap`, loudly, before the board is generated.
- **[2026-09-08]** Third instance of one class of defect, so it gets a name: **a check that is
  mechanically right and substantively wrong.** (1) `flag_default` read a non-empty string as
  truthy. (2) `milestone-cdt-proposal` passed a `contact_stage ≥ contacted` threshold while the
  proposal itself had been owed since 2026-07-29. (3) `attest-oeis-demo` used `meeting_logged` with
  a title regex — and when Pavan gave me the real 2026-08-31 meeting to log, an honest write-up of a
  **partial** Attest showing that ended with the client asking to see more sat one title-word away
  from flipping the milestone to **done**. **The tell in all three: the check proves a PROXY for the
  claim, not the claim.** Before adding a check, ask what the cheapest way to make it pass would be,
  and whether that way would satisfy the definition of done. Two structural traps to watch for
  specifically: a `proof:` list is an AND that reads done when every entry passes, so a
  necessary-but-insufficient check cannot live in one; and a check whose input a person authors
  (a meeting title, a file name) is self-fulfilling. `proof: manual` is not a failure to automate —
  it is the correct answer when a person is genuinely required.
- **[2026-09-08]** I set the first three targets and the board immediately produced its first green:
  `platform-hosted-demo` read **on-track**. It rested on
  `fix(security): close Paladin C2/C3/H5/H6… harden data-plane CORS` — infrastructure work touching
  `deployment/`, nothing to do with a demo tenant. The derivation was correct; **my evidence paths
  were too broad**. **When a state changes, check what it changed BECAUSE of before reporting it** —
  the first green on a board that had none is exactly the result most worth distrusting. I recorded
  the limitation in the milestone rather than repointing the paths by guess, because no path in that
  repo uniquely means "a seeded tenant exists at a URL", and inventing precision would have been the
  same mistake in the other direction.
- **[2026-09-08]** I wrote "that window passed with no meeting logged" about Pavan's warmest contact,
  inferring a lapsed calendar invite from two `via recall` log lines. Pavan: "she was trying to
  reschedule our 8/31 meeting but we ended up having it." The meeting had happened; only the *record*
  was missing. **Absent evidence about a HUMAN interaction is not evidence of absence** — the board's
  "absence renders unknown, never green" rule applies to states, and I had applied its spirit to
  commits and repos but not to people. When a record gap concerns something only a person witnessed,
  the honest render is "not recorded", and the next move is to ask them, not to narrate what the gap
  implies.
- **[2026-09-08]** Pavan: "my system does[n't] have a good grasp on what the date actually is."
  He was right, and I had already been bitten by it without diagnosing it. `new Date()
  .toISOString().slice(0, 10)` is the UTC day, so in PDT it returns **tomorrow from 17:00 until
  midnight** — seven hours, 29% of every day, and only in the evening, which is when this system is
  used most. Proof: `resolveDecision` wrote `[RESOLVED 2026-09-09]` from a commit made at 18:04
  local on 2026-09-08. Earlier that afternoon I hand-corrected four files carrying tomorrow's date
  and wrote it up as **my own** slip. It was not mine; it was this line, in five places.
  **When the same small wrongness appears more than once, stop fixing instances and go find the
  generator.** A second occurrence is data, not coincidence.
- **[2026-09-08]** The other half of that fix matters as much: two call sites that looked identical
  were correct and had to be left alone. `toDateStr()` and `weekOf()` take a value already parsed
  as **UTC midnight** (`new Date('2026-09-08')`), where reading local components yields 2026-09-07 —
  so "converting a Date to a date string" and "asking what day it is" want **opposite** timezones
  and are one character apart on screen. **Before applying a fix everywhere a pattern matches, ask
  what each site's input actually is.** A blanket sed would have introduced a new off-by-one in
  exactly the places that were already right.
- **[2026-09-08]** The same UTC-vs-local bug had a second, more expensive instance I only found by
  sweeping for the *pattern* rather than stopping at the first fix: `moves.ts` sliced
  `Opportunity.deadlineAt`, a UTC instant built from a **local** wall-clock time, and
  `parseDeadline` defaults to **17:00 when a solicitation gives no time** — which in PDT is exactly
  midnight UTC. So it was not an edge case, it was the common path: **4 of 18 live solicitation
  deadlines were rendering a day late**, feeding both the urgency score and the `daysUntil > 7`
  gate that decides whether a bid appears on Today at all. **After fixing a bug, grep for its shape,
  not its line** — and rank the hits by what each one costs. A stale "last run" label is cosmetic; a
  bid deadline a day late is not.
- **[2026-09-09]** Four BidPro handoffs read `merged` in the same second, and I explained it as
  "under 24h, floor() rounds to 0" before asking why four unrelated literals would land
  together at all. They were all matching `docs/unified-bid-system-plan.md` on their `staging` —
  OUR plan, PR'd into THEIR repo the day before. A proof engine that greps for a literal will
  always match the document that introduced the literal; the README rule ("in THEIR code, not
  prose") was policy the engine never enforced. Two rules. **When several independent checks
  flip at the same instant, that is one event, not several — find the commit before explaining
  the number.** And **a check must exclude the artefact that named what it is checking for**:
  the spec on their side, the placeholder wire type on ours. My first proposed fix (point
  `consumed_by` at the file holding the type stub) would have turned a false red into a false
  green — the re-audit caught it only because I read the stub's comment before believing the grep.
- **[2026-09-09]** Destroyed ~30 files of finished, verified, uncommitted work by
  running `git worktree remove --force` over a list filtered with
  `grep -v "<dirname>$"`. `git worktree list` prints the SHA and branch AFTER the
  path, so no line ends with the directory name, the filter matched nothing, and
  the loop deleted the worktree it was running in. **Never build a destructive
  target list from a pattern without printing the list first**, and never run
  `--force` against a set you have not seen. To prove a commit builds in
  isolation, clone to a temp dir — do not add a worktree to the repo you are
  working in. The deeper failure was upstream: that work had been sitting
  uncommitted for hours because I was batching the commit until asked. **Commit
  each coherent piece as it lands.** An uncommitted hour is an hour you can lose.
- **[2026-09-09]** A dashboard pasted CRM `next_action` / `blocked_on` verbatim
  into customer-facing follow-up emails for months — values like "Personal
  follow-up — upsell" and "product one-pager does not exist" — and one such email
  was sent to a state CIO's office. The sanitiser meant to prevent this
  (`externalSafe`) screened only for repo paths, and the two most dangerous
  fields did not call it. **A field written for an internal reader must never be
  interpolated into external prose**, and that rule has to be enforced by code,
  not stated in a comment above the function that breaks it. The structural fix
  (interpolate nothing; put internal facts in frontmatter the UI shows
  separately) beats any regex sanitiser, because it removes the channel rather
  than filtering it.
- **[2026-09-09]** `edited: false` meant two different things: "machine
  scaffolding, safe to regenerate" and "nobody has touched it yet". The best
  hand-written draft in the store carried it and was one migration away from
  being destroyed. **When a flag guards destruction, verify what actually carries
  it** — do not assume every writer agreed on its meaning.
- **[2026-09-09]** Traced authorship of generated content through the git commit
  *trailer* (`via: dashboard`), not the committer identity — every commit in
  operations is authored by the janitor, so `%an` says nothing. **Design
  automated commits so their message identifies the writer**; it is the only
  forensic trail when everything commits as the same user.
- **[2026-09-09]** "There's too much whitespace" read as one defect and was four:
  the container cap, dead space *inside* stretched rows, vertical bloat from
  shadcn's landing-page card defaults, and an unowned markdown measure. They
  interact — removing `max-w-7xl` alone makes the row problem WORSE, because
  every list row is `flex justify-between` and more width means a bigger hole in
  the middle. **Measure the row, not just the page.** A Range-based probe of
  painted text extent found a median 873px dead gap that no amount of container
  widening would have fixed; columns did.
- **[2026-09-09]** Ran `pnpm build` while `next dev` served the same `.next`
  directory. The dev server's CSS silently degraded — `h-screen` and
  `overflow-auto` stopped applying — and the measurements taken next were garbage
  (`/agencies` read 6,404px when it was really 2,260px). The tell was a
  *physically impossible* reading: `main` had `overflow-y: visible` when its class
  says `overflow-auto`. **Never build against a live dev server's `.next`**, and
  when a measurement contradicts the source, suspect the apparatus before
  rewriting the code. Corollary seen twice since: a measurement taken while a
  route is still compiling reads short — re-measure before believing a regression.

## 2026-09-09 — a doctrine is not a requirement (Phase 14)

**What happened.** Pavan tested the board by shipping: he and two devs pushed 55 commits in a
day and nothing moved. The audit found three mechanical gaps (daily-only run, one ref per repo,
proof never evaluated on build/handoff) — and one that was mine: I had defended "nine checks and
no tenth" and "proof is for demand/decision only" as design purity. His ruling: *"as much as
possible, nothing should be manual — a booked meeting is a calendar invite, not a person's
say-so."* He was right. 56 of 65 milestones could only reach `done` by someone typing a date.

**The pattern.** A small vocabulary is a virtue only while it covers the facts the owner needs
decided. When the owner names a decidable data source (a calendar feed the dashboard already
reads), refusing it is not rigour, it is a board that lies by omission. The entry requirement is
"decidable from a file, a git tree, or a feed with no judgement" — not "nine".

**Rules.**
1. When the founder says a thing should be automatic and names its data source, the question is
   "is it decidable?", never "is it in the list?". Grow the vocabulary; keep the entry test.
2. Every kind carries proof when the vocabulary can express its DoD. `proof: manual` is an
   exception that states its reason, never the default for a kind.
3. Sync cadence follows what the reader needs, not the job's cost. "Constant monitoring" was the
   wrong frame — the BOARD should be constant, the MESSAGES should not. Silent recompute on
   change, one announce a morning.
4. Cost questions get a number, not reassurance: the watcher is a dozen `ls-remote` calls every
   five minutes and zero tokens. Say so.
