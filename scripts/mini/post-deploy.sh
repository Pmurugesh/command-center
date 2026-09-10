#!/usr/bin/env bash
# Mini-side installers that deploy-on-merge.sh re-applies after every pull of
# origin/main — so a merge is the ONLY action a change to the mini ever needs.
#
# Rule for what belongs here: idempotent installers only (safe to run every
# deploy, no-op when already applied, never interactive). Anything that needs a
# human — a password, a one-time clone, a deploy key — stays a manual
# install-*.sh and is listed in its own header instead.
#
# Each runs in its own subshell so one failure cannot stop the rest; the deploy
# log gets one line per installer plus whatever it printed.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

INSTALLERS=(
  scripts/mini/widen-clones.sh            # single-branch clones hide the branch the work is on
  scripts/mini/install-nexus-sync.sh      # Nexus clone on origin/main before health scans
  scripts/mini/install-cron-delivery.sh   # no cron may run with delivery "last" and no target
  scripts/mini/install-heartbeat.sh       # nothing else notices when a pipeline stops
  scripts/mini/install-roadmap-watch.sh   # the board follows the repos, not the clock
)

# Installers that need the gateway token and skip cleanly without it. Kept apart
# only so the argument is visible; install-cron-delivery.sh above already proves
# openclaw cron changes work from here under launchd.
GATED_INSTALLERS=(
  "scripts/mini/install-roadmap-check.sh --if-possible"  # the board goes stale unless this job runs
)

for inst in "${INSTALLERS[@]}" "${GATED_INSTALLERS[@]}"; do
  # shellcheck disable=SC2086 — the gated entries carry their own flag.
  out=$(bash $inst 2>&1); rc=$?
  name=$(basename "${inst%% *}" .sh)
  printf '%s\n' "$out" | sed "s|^|    [$name] |"
  if [ "$rc" -eq 0 ]; then
    echo "post-deploy: $inst ok"
  else
    echo "post-deploy: $inst FAILED (exit $rc) — fix and merge; it retries next deploy"
  fi
done
