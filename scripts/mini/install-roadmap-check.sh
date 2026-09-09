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
#
# `--if-possible` is the post-deploy mode (2026-09-08): skip the dry run, and
# treat an unreadable Keychain as a clean SKIP rather than a failure, so a merge
# can register this job without a human at the mini's screen. That became viable
# once install-cron-delivery.sh — which also mutates openclaw crons — started
# succeeding from post-deploy under launchd, answering Phase 12's standing
# "can launchd read the Keychain" question with yes. The interactive path is
# unchanged and still fails loudly, because there a human asked for it.
set -euo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

IF_POSSIBLE=0
[ "${1:-}" = "--if-possible" ] && IF_POSSIBLE=1

REPO_DIR="$HOME/repos/command-center"
NODE="$(command -v node)"

# The dry run fetches every clone, so it is the interactive proof that the
# runner works before a cron is registered — not something to repeat on every
# deploy. The job's own run log is the ongoing evidence.
if [ "$IF_POSSIBLE" -eq 0 ]; then
  echo "==> Runner sanity check (dry run — prints the board, writes nothing)"
  ( cd "$REPO_DIR" && "$NODE" --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/roadmap-check.ts --dry | grep -E '^\| (🔴|🟠|🟡|🟢|⚪|✅)' )
fi

# Same Keychain dance as install-bid-sync.sh — see the comment there.
if [ -z "${OPENCLAW_GATEWAY_TOKEN:-}" ]; then
  OPENCLAW_GATEWAY_TOKEN="$(security find-generic-password -s openclaw-gateway-token -a openclaw -w 2>/dev/null || true)"
  export OPENCLAW_GATEWAY_TOKEN
fi
if [ -z "$OPENCLAW_GATEWAY_TOKEN" ]; then
  if [ "$IF_POSSIBLE" -eq 1 ]; then
    echo "    no gateway token in this context — skipping (retries next deploy)."
    exit 0
  fi
  echo "    could not read the gateway token from the Keychain (locked to this session)."
  echo "    Run this script from a Terminal on the mini's own screen, or export"
  echo "    OPENCLAW_GATEWAY_TOKEN first. The dry run above already proved the check works."
  exit 1
fi
echo "==> Gateway token resolved from the Keychain"

run_cmd() {
  printf 'bash -lc %q' "cd $REPO_DIR && $NODE --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/$1"
}

# One `cron list` call, two questions: the job's id and its current schedule.
job_field() {
  openclaw cron list --json | python3 -c '
import json, sys
for j in json.load(sys.stdin).get("jobs", []):
    if j.get("name") == sys.argv[1]:
        print(j.get(sys.argv[2], "")); break
' "$1" "$2"
}
job_id() { job_field "$1" id; }

register() {
  local name="$1" schedule="$2" script="$3" desc="$4"
  local existing; existing=$(job_id "$name")
  if [ -n "$existing" ]; then
    # Reconcile, do not just skip. "Already registered" used to mean "leave it
    # alone", which made the schedule in this file a lie the moment it changed:
    # the job stayed on whatever it was first created with and nothing said so.
    # An installer that cannot correct the thing it installs is documentation.
    local current; current=$(job_field "$name" scheduleExpr)
    if [ "$current" = "$schedule" ]; then
      echo "    $name already registered ($existing) on $schedule PT — no change"
    else
      openclaw cron edit "$existing" --cron "$schedule" --tz "America/Los_Angeles"
      echo "    $name reschedule: $current -> $schedule PT"
    fi
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
# 08:00, not 06:00 — and the two hours matter more than they look.
#
# granola-sync writes the day's meeting files at 07:30. At 06:00 the roadmap
# check ran ninety minutes BEFORE the signal it most wants to read, so a meeting
# always missed that morning's rescore and waited for the next one: ~40 hours
# from a Tuesday meeting to the ranking moving, ~64 over a weekend. 08:00 puts
# it after granola-sync and beside sales-daily-bid-review, and costs a day less.
register roadmap-check "0 8 * * 1-5" roadmap-check.ts "Derive operations/roadmap/_status.md from human commits on origin, CRM pull, and the build-next ranking — runs after granola-sync so the day's meetings are in it"

echo "==> Done. Verify with: openclaw cron run $(job_id roadmap-check)  (then tail ~/.openclaw/logs/roadmap-check.log)"
