#!/usr/bin/env bash
# Install the two qual-table connectors as OpenClaw crons on the Mac mini:
#   bid-sync   — weekdays, hourly 07:00–18:00 PT, scripts/sync-bids.ts
#   lead-sync  — weekdays 07:30 PT,               scripts/sync-leads.ts
#
# Both read the workbench with the service account whose five values live in
# ~/.openclaw/workspace/.credentials/qual-table.env (mode 600, outside git;
# created by Pavan 2026-09-08). Both are READ-ONLY against that app.
#
# Idempotent: a job that already exists under its name is left alone. Re-run
# after `git pull` to pick up script changes (the cron runs the file in place).
#
# Run ON the mini as `paladin`:
#   ./scripts/mini/install-bid-sync.sh
set -euo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

REPO_DIR="$HOME/repos/command-center"
ENV_FILE="$HOME/.openclaw/workspace/.credentials/qual-table.env"
NODE="$(command -v node)"

echo "==> Credentials"
[ -f "$ENV_FILE" ] || { echo "$ENV_FILE missing — create it first (five QUAL_TABLE_* lines, chmod 600)"; exit 1; }
[ "$(stat -f %Lp "$ENV_FILE")" = "600" ] || echo "    WARNING: $ENV_FILE is not mode 600"

echo "==> Runner sanity check (dry run against the workbench)"
( set -a; . "$ENV_FILE"; set +a
  cd "$REPO_DIR" && "$NODE" --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/sync-bids.ts --dry | tail -3 )

# The cron runs a shell so the env file is sourced at run time, never baked
# into the job definition (openclaw cron list --json would print it).
run_cmd() {
  printf 'bash -lc %q' "set -a; . $ENV_FILE; set +a; cd $REPO_DIR && $NODE --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/$1"
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
  # Delivery must be EXPLICIT: an isolated cron without a target reads as an
  # error on every run even when the command exits 0 (see the caleprocure
  # installer). --agent sales: attribution only, groups the job under Capture.
  openclaw cron add "$name" \
    --cron "$schedule" --tz "America/Los_Angeles" \
    --agent sales \
    --command "$(run_cmd "$script")" \
    --announce --channel telegram --to "telegram:8097059385" \
    --description "$desc"
  echo "    registered $name: $schedule PT"
}

echo "==> Registering crons"
register bid-sync  "0 7-18 * * 1-5" sync-bids.ts  "Mirror qual-table bids into operations/bids/*/.status.json (read-only, one GET per run) — Phase 11 connector, 2026-09-08"
register lead-sync "30 7 * * 1-5"   sync-leads.ts "Score qual-table discovery events through the product lens into crm/leads (read-only) — M3, scheduled 2026-09-08"

echo "==> Done. Verify with: openclaw cron run $(job_id bid-sync)  (then tail ~/.openclaw/logs/bid-sync.log)"
