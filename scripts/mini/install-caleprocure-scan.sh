#!/usr/bin/env bash
# Install the API-based Cal eProcure scan cron on the Mac mini — and remove
# the legacy browser-automation job, so there is exactly ONE way this scan
# runs (Pavan's call, 2026-08-24: the browser job had produced nothing since
# 2026-07-14, timing out at 600s every weekday).
#
# The scan itself is scripts/caleprocure-scan.py in this repo, which consumes
# qual_table_automations' proven client read-only (one request per run against
# suppliers.fiscal.ca.gov). This installer:
#   1. ensures the qual_table clone exists at ~/repos/qual_table_automations
#      (tries a --ff-only pull when it can; without a deploy key the clone is
#      a snapshot, which is fine until the relevance rules change upstream)
#   2. sanity-checks the runner imports on this machine's python3
#   3. removes any job named caleprocure-scan with an agentTurn payload (the
#      legacy browser approach, whether disabled or not)
#   4. registers the command-payload cron: weekdays 07:00 PT, same slot the
#      legacy job had
#
# Idempotent: safe to re-run for every deploy.
#
# Run ON the mini as `paladin`:
#   ./scripts/mini/install-caleprocure-scan.sh
set -euo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

REPO_DIR="$HOME/repos/command-center"
QT_DIR="$HOME/repos/qual_table_automations"
BACKEND="$QT_DIR/qual_table_app/backend"
RUNNER="$REPO_DIR/scripts/caleprocure-scan.py"
JOB_NAME="caleprocure-scan"

echo "==> qual_table_automations clone"
if [ -d "$QT_DIR/.git" ]; then
  if git -C "$QT_DIR" pull --ff-only 2>/dev/null; then
    echo "    updated to $(git -C "$QT_DIR" log --oneline -1)"
  else
    echo "    snapshot at $(git -C "$QT_DIR" log --oneline -1) — no pull auth."
    echo "    To enable updates, add a read-only deploy key for this repo:"
    echo "      gh repo deploy-key add ~/.ssh/id_ed25519_qual_table.pub \\"
    echo "        -R Pmurugesh/qual_table_automations --title 'mac-mini read-only'"
  fi
else
  git clone git@github.com:Pmurugesh/qual_table_automations.git "$QT_DIR" \
    || { echo "clone failed — add a deploy key (see above) or rsync a clone to $QT_DIR"; exit 1; }
fi

echo "==> Runner sanity check"
[ -f "$RUNNER" ] || { echo "$RUNNER missing — pull command-center first"; exit 1; }
QUAL_TABLE_BACKEND="$BACKEND" python3 - <<PY
import os, sys
sys.path.insert(0, os.environ["QUAL_TABLE_BACKEND"])
from app.services import eprocure_parser, eprocure_relevance  # noqa: F401
from app.core.eprocure_config import get_eprocure_config      # noqa: F401
print(f"    imports ok · relevance rules v{eprocure_relevance.RELEVANCE_VERSION}")
PY

# Jobs of a given payload kind under our name. (The JSON is piped to -c code;
# a heredoc script would fight the pipe for stdin.)
jobs_of_kind() {
  openclaw cron list --json | python3 -c '
import json, sys
kind = sys.argv[1]
for j in json.load(sys.stdin).get("jobs", []):
    if j.get("name") == "caleprocure-scan" and j.get("payload", {}).get("kind") == kind:
        print(j["id"])
' "$1"
}

echo "==> Removing legacy browser-automation job(s)"
for job_id in $(jobs_of_kind agentTurn); do
  openclaw cron rm "$job_id"
  echo "    removed legacy job $job_id"
done

echo "==> Registering command-payload cron"
EXISTING=$(jobs_of_kind command | head -1)
if [ -n "$EXISTING" ]; then
  echo "    already registered ($EXISTING) — leaving as is"
else
  openclaw cron add "$JOB_NAME" \
    --cron "0 7 * * 1-5" --tz "America/Los_Angeles" \
    --command "python3 $RUNNER" \
    --command-env "EPROCURE_ENABLED=true" \
    --command-env "QUAL_TABLE_BACKEND=$BACKEND" \
    --description "Daily Cal eProcure scan via suppliers.fiscal.ca.gov list export (qual_table client, 1 request/run) — replaced browser automation 2026-08-24"
  echo "    registered: weekdays 07:00 PT"
fi

echo "==> Done. Verify with: openclaw cron run $JOB_NAME  (writes today's report immediately)"
