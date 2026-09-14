#!/usr/bin/env bash
# Failure alerts on, "nothing changed" announces off — for every OpenClaw cron.
#
# Measured 2026-09-14: about 105 Telegram cron messages a week, 38 of
# bid-sync's 39 saying "created 0, updated 0, unchanged 16", while its six
# timeouts that week were never delivered (lastFailureNotificationDeliveryStatus
# was "not-requested" on every job). The signal was inverted. Two changes:
#
#   1. Every enabled job gets a failure alert: after 2 consecutive errors,
#      6h cooldown, skipped runs not counted, announced to the same Telegram
#      target everything else uses.
#   2. bid-sync, lead-sync and roadmap-check run with --on-change, so their
#      stdout is empty when nothing changed and OpenClaw skips the announce
#      (the gateway only announces a non-empty summary).
#
# Idempotent: a job that already has an alert, or already carries --on-change,
# is left alone. Applied on every merge by scripts/mini/post-deploy.sh, where
# the Keychain resolves the gateway token; over ssh it logs a skip.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

TARGET="telegram:8097059385"

if [ -z "${OPENCLAW_GATEWAY_TOKEN:-}" ]; then
  OPENCLAW_GATEWAY_TOKEN="$(security find-generic-password -s openclaw-gateway-token -a openclaw -w 2>/dev/null || true)"
  export OPENCLAW_GATEWAY_TOKEN
fi
if [ -z "$OPENCLAW_GATEWAY_TOKEN" ]; then
  echo "    gateway token not readable here (locked Keychain) — skipped; re-applied on the next deploy"
  exit 0
fi

jobs_json=$(openclaw cron list --json)

# ── 1. failure alerts ───────────────────────────────────────────────────────
need_alert=$(printf '%s' "$jobs_json" | python3 -c '
import json, sys
for j in json.load(sys.stdin).get("jobs", []):
    if not j.get("enabled"): continue
    fa = j.get("failureAlert") or {}
    if fa.get("to") and fa.get("mode"): continue
    print(j["id"] + "\t" + j.get("name", "?"))
')
if [ -z "$need_alert" ]; then
  echo "    every enabled cron already has a failure alert"
else
  while IFS=$'\t' read -r id name; do
    [ -z "$id" ] && continue
    openclaw cron edit "$id" \
      --failure-alert --failure-alert-after 2 --failure-alert-cooldown 6h \
      --failure-alert-exclude-skipped --failure-alert-mode announce \
      --failure-alert-channel telegram --failure-alert-to "$TARGET" >/dev/null
    echo "    $name ($id): failure alert -> $TARGET after 2 errors"
  done <<< "$need_alert"
fi

# ── 2. --on-change on the three chatty command jobs ─────────────────────────
# argv[2] is "bash -lc <%q-quoted command>"; appending "\ --on-change" extends
# the quoted command with a real " --on-change" argument when bash runs it.
need_flag=$(printf '%s' "$jobs_json" | python3 -c '
import json, sys
for j in json.load(sys.stdin).get("jobs", []):
    if j.get("name") not in ("bid-sync", "lead-sync", "roadmap-check"): continue
    p = j.get("payload") or {}
    argv = p.get("argv") or []
    if p.get("kind") != "command" or len(argv) != 3 or "--on-change" in argv[2]: continue
    argv = argv[:2] + [argv[2] + "\\ --on-change"]
    print(j["id"] + "\t" + j["name"] + "\t" + json.dumps(argv))
')
if [ -z "$need_flag" ]; then
  echo "    bid-sync, lead-sync and roadmap-check already announce on change only"
else
  while IFS=$'\t' read -r id name argv; do
    [ -z "$id" ] && continue
    openclaw cron edit "$id" --command-argv "$argv" >/dev/null
    echo "    $name ($id): now runs with --on-change"
  done <<< "$need_flag"
fi
