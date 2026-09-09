#!/usr/bin/env bash
# Widen single-branch clones so the roadmap check can see the branch the work is
# actually on.
#
# Why this exists (2026-09-08): the mini's `qual_table_automations` clone was
# created with `remote.origin.fetch = +refs/heads/main:refs/remotes/origin/main`,
# so no other branch is ever fetched. That team works on `staging` — 634 commits
# there in 90 days, and the unified-bid plan merged to staging on 2026-09-08 —
# so all five BidPro handoff milestones read `unknown`. The check was answering
# correctly against a ref where the answer does not live.
#
# Pavan, 2026-09-08: "fetch staging too because i need to know where progress is
# frequently."
#
# This changes ONLY the local clone's fetch refspec. It writes nothing to the
# remote and creates no commits — the read-only rule is about the repository's
# contents, and this is our own copy's configuration. Idempotent: it rewrites the
# refspec only when it is narrow, and a widened clone is left alone.
set -uo pipefail

WIDE='+refs/heads/*:refs/remotes/origin/*'

# Every repo the roadmap check reads. Nexus and operations are already wide; they
# are listed so a future narrow clone of either is caught rather than silently
# tolerated.
for dir in \
  "$HOME/repos/qual_table_automations" \
  "$HOME/repos/contract-management" \
  "$HOME/repos/Nexus" \
  "$HOME/repos/operations"
do
  [ -d "$dir/.git" ] || continue
  name=$(basename "$dir")

  # `mapfile` is bash 4; macOS ships bash 3.2, so read the lines portably.
  specs=$(git -C "$dir" config --get-all remote.origin.fetch 2>/dev/null)

  # NO refspec configured is git's DEFAULT, which is already every branch. An
  # earlier cut of this script read "empty" as "narrow" and rewrote a clone that
  # was fine — harmless here, but the same mistake on a repo with a deliberate
  # partial fetch would not be. Absent means leave alone.
  if [ -z "$specs" ]; then
    echo "widen-clones: $name has no explicit refspec (git default = all branches)"
    continue
  fi

  case "$specs" in
    *'/*'*)
      echo "widen-clones: $name already fetches all branches"
      continue
      ;;
  esac

  echo "widen-clones: $name is single-branch ($(echo "$specs" | tr '\n' ' ')) — widening"
  git -C "$dir" config --replace-all remote.origin.fetch "$WIDE" || {
    echo "widen-clones: $name FAILED to set refspec"; continue; }
  # Fetch once now so the first check after this deploy already sees the branches;
  # --prune keeps deleted remote branches from resolving.
  if git -C "$dir" fetch -q --prune origin; then
    echo "widen-clones: $name now sees $(git -C "$dir" branch -r | grep -c .) remote branches"
  else
    echo "widen-clones: $name refspec set but fetch failed — next deploy retries"
  fi
done
