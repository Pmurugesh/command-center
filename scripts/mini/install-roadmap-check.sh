#!/usr/bin/env bash
# Install roadmap-check as an OpenClaw cron on the Mac mini:
#   roadmap-check — weekdays 06:00 PT, scripts/roadmap-check.ts
#
# The mini is the ONLY machine that may run this for real: it holds every clone
# the ten initiatives reference (Nexus, contract-management, both websites…).
# The script refuses to write from a machine missing any of them (exit 2), so a
# MacBook run can never degrade the board — but it also means the board goes
# stale unless THIS job runs. Daily because the at-risk window is 14 days and a
# weekly check could miss most of it; cheap because it only rewrites
# operations/roadmap/_status.md when a fact changed (new human commit, handoff
# state, target), not when a day passed.
#
# No credentials: it reads git remotes with the same keys the janitor uses.
#
# Idempotent: a job that already exists under its name is left alone. Re-run
# after `git pull` to pick up script changes (the cron runs the file in place).
#
# Run ON the mini as `paladin`, from a Terminal on its own screen (Keychain):
#   ./scripts/mini/install-roadmap-check.sh
set -euo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

REPO_DIR="$HOME/repos/command-center"
NODE="$(command -v node)"

echo "==> Runner sanity check (dry run — prints the board, writes nothing)"
( cd "$REPO_DIR" && "$NODE" --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/roadmap-check.ts --dry | grep -E '^\| (🔴|🟠|🟡|🟢|⚪|✅)' )

# Same Keychain dance as install-bid-sync.sh — see the comment there.
if [ -z "${OPENCLAW_GATEWAY_TOKEN:-}" ]; then
  OPENCLAW_GATEWAY_TOKEN="$(security find-generic-password -s openclaw-gateway-token -a openclaw -w 2>/dev/null || true)"
  export OPENCLAW_GATEWAY_TOKEN
fi
if [ -z "$OPENCLAW_GATEWAY_TOKEN" ]; then
  echo "    could not read the gateway token from the Keychain (locked to this session)."
  echo "    Run this script from a Terminal on the mini's own screen, or export"
  echo "    OPENCLAW_GATEWAY_TOKEN first. The dry run above already proved the check works."
  exit 1
fi
echo "==> Gateway token resolved from the Keychain"

run_cmd() {
  printf 'bash -lc %q' "cd $REPO_DIR && $NODE --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/$1"
}

job_id() {
  openclaw cron list --json | python3 -c '
import json, sys
for j in json.load(sys.stdin).get("jobs", []):
    if j.get("name") == sys.argv[1]:
        print(j["id"]); break
' "$1"
}

register() {
  local name="$1" schedule="$2" script="$3" desc="$4"
  local existing; existing=$(job_id "$name")
  if [ -n "$existing" ]; then
    echo "    $name already registered ($existing) — leaving as is"
    return
  fi
  # Delivery must be EXPLICIT (an isolated cron without a target reads as an
  # error on every run). Most days the message is one line — "no change" —
  # and only a real change in the board produces the ten-row summary.
  # --agent product: attribution only, groups the job under Forge.
  openclaw cron add "$name" \
    --cron "$schedule" --tz "America/Los_Angeles" \
    --agent product \
    --command "$(run_cmd "$script")" \
    --announce --channel telegram --to "telegram:8097059385" \
    --description "$desc"
  echo "    registered $name: $schedule PT"
}

echo "==> Registering cron"
register roadmap-check "0 6 * * 1-5" roadmap-check.ts "Derive operations/roadmap/_status.md from human commits on origin — Phase 12 commitments board, 2026-09-08"

echo "==> Done. Verify with: openclaw cron run $(job_id roadmap-check)  (then tail ~/.openclaw/logs/roadmap-check.log)"
