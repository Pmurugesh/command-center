# Next-session pickup

Read this BEFORE starting any new task in this project. The user left explicit
instructions for the next session — they take precedence over anything else
listed in `todo.md`.

---

## Pending instruction from Pavan (left 2026-05-22)

> Open `plans/pr-3b-2-module-manifest-rollout.md`. Run `/audit-phase PR-3B.1`
> to verify the upstream baseline (PR #339). Surface any gaps. Read the
> 4 Open Questions at the bottom of the plan and propose answers for each
> (especially **OQ-1 primary-vs-sub for procurement + delivery-management**,
> and **OQ-3 component field placement** — those shape everything else).
> Then **WAIT for my "go"** before proposing or executing. Do not begin
> work until I confirm.

### Step-by-step

1. **Find and open** `plans/pr-3b-2-module-manifest-rollout.md`. This is likely
   in a sibling repo, not in this `command-center` worktree — check
   `~/repos/operations/`, `~/repos/Nexus/`, or wherever the OpenClaw/Nexus
   plans live. Do NOT create a new file with that name; locate the existing one.
2. **Run `/audit-phase PR-3B.1`** (custom skill — invoke via the Skill tool if
   listed in available skills). Goal: verify the upstream baseline at PR #339
   is correct. Report gaps. Don't fix anything yet.
3. **Read the Open Questions section** at the bottom of the plan. Propose an
   answer for each. Pay extra attention to:
   - **OQ-1**: primary-vs-sub treatment for `procurement` and
     `delivery-management` modules
   - **OQ-3**: where the `component` field lives in the manifest
4. **Stop. Wait.** Do NOT propose a plan, do NOT begin work. The user has to
   say "go" first.

### Hard rules

- 🚫 Do not edit the plan file.
- 🚫 Do not implement any module-manifest changes.
- 🚫 Do not skip the audit step to jump straight to OQ answers.
- ✅ Do surface ambiguity. If the plan or PR #339 is unreachable, say so and ask
  where to find them rather than guessing.

---

## Context from previous session (Phase 3 UI overhaul)

Phase 3.0–3.5 of the command-center UI rebuild is **done** (foundation + all
five page polishes). See `todo.md` for what was in scope. The dev server runs
locally at `http://localhost:3000`, reading from `~/repos/operations/` which
was mirrored from the Mac mini over Tailscale via:

```bash
python3 /tmp/mirror-mac-mini.py   # re-run anytime to refresh
```

The Mac mini's deployed dashboard is still serving the OLD UI at
`http://100.113.239.46:3000` until the Phase 3 commit is pulled there. Phase 3
has NOT been committed yet — that's a separate decision.

### Files touched in Phase 3 (uncommitted)

If Pavan asks to commit, these are the changes:

```
src/app/globals.css                                 (slate palette + status helpers + skeleton shimmer)
src/app/layout.tsx                                  (JetBrains Mono + max-w-7xl container)
src/app/page.tsx                                    (Overview rewrite — 4 metrics, no quick-actions, Needs Attention)
src/app/bids/page.tsx                               (filter tabs + TimeAgo + chip cleanup)
src/app/bids/[bidName]/page.tsx                     (copy fix, status-danger tokens)
src/app/bids/[bidName]/bid-detail-tabs.tsx          (max-w-3xl content, clearer flag indicator)
src/app/intel/page.tsx                              (3 count cards, Latest pill in header)
src/app/system/page.tsx                             (collapseHome paths, sources-connected header)
src/app/system/cron/page.tsx                        (rich empty state)
src/app/library/library-browser.tsx                 (tree search input)
src/components/shared/status-badge.tsx              (all 8 bid statuses + system states)
src/components/shared/data-card.tsx                 (font-mono + tabular-nums on value)
src/components/shared/time-ago.tsx                  (font-mono + tabular-nums)
src/components/shared/skeleton.tsx                  (new — Skeleton + SkeletonPage)
src/app/loading.tsx + 6 segment loading.tsx files   (new — per-route skeletons)
src/lib/config.ts                                   (normalizeBidStatus helper)
src/lib/files.ts                                    (updatedAt on Bid + normalizeBidStatus integration)
src/types/index.ts                                  (Bid.updatedAt field)
tailwind.config.js                                  (status + bid color namespaces, mono fontFamily, safelist)
```

### Loose ends from Phase 3 (not blockers)

- **Tailscale access from other devices**: dev server binds localhost-only. To
  reach `http://100.117.13.85:3000` (this MacBook over Tailscale) from a phone
  etc., change `launch.json`'s `runtimeArgs` to `["dev", "--", "-H", "0.0.0.0"]`
  OR modify `package.json`'s dev script. Not done — Pavan only viewed from this
  MacBook's browser.
- **Mirror script user**: `/tmp/mirror-mac-mini.py` is in `/tmp` so will vanish
  on reboot. If keeping long-term, move into the repo as
  `scripts/mirror-from-mac-mini.py` and commit.
- **CLAUDE.md drift**: CLAUDE.md still says paths use `~` resolving to
  `/Users/paladin` and references `~/repos/Nexus/bids/`. Actual code uses
  `~/repos/operations/bids/`. Worth updating CLAUDE.md to match reality.
- **Mac mini ssh**: Remote Login is off on the Mac mini. If Pavan wants
  rsync-based mirroring (instead of API-based), he'd need to physically enable
  it. The API approach is sufficient for now.
- **Phase 3.6 wishlist** (not started): text search on bids, sort controls on
  bids list, agency/deadline fields (data gap — not in current `.status.json`),
  unify "Updated Xm ago" with absolute timestamp on hover.

---

_Last updated: 2026-05-22 by Claude (Phase 3 UI rebuild session)._
