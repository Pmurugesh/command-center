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
  scripts/mini/install-nexus-sync.sh      # Nexus clone on origin/main before health scans
  scripts/mini/install-cron-delivery.sh   # no cron may run with delivery "last" and no target
)

for inst in "${INSTALLERS[@]}"; do
  out=$(bash "$inst" 2>&1); rc=$?
  printf '%s\n' "$out" | sed "s|^|    [$(basename "$inst" .sh)] |"
  if [ "$rc" -eq 0 ]; then
    echo "post-deploy: $inst ok"
  else
    echo "post-deploy: $inst FAILED (exit $rc) — fix and merge; it retries next deploy"
  fi
done
