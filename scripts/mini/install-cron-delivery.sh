#!/usr/bin/env bash
# Give every OpenClaw cron an explicit delivery target.
#
# Why: isolated crons with delivery `channel: last` and no `to` complete their
# run, then fail delivery and are marked error — every time, silently. Found
# 2026-09-08: `sales-friday-pipeline-brief` (Capture's weekly pipeline readout)
# had never reached Pavan; it had been failing this way since it was created.
# The same gotcha bit caleprocure-scan in August. This installer closes the
# class, not the instance: any enabled job whose delivery has no target gets
# the one target everything else uses.
#
# Idempotent — a job that already has a `to` is left exactly as it is. Applied
# on every merge by scripts/mini/post-deploy.sh (the Keychain resolves under
# launchd, so it works there; over ssh it logs a skip).
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

# id<TAB>name for every enabled job with no delivery target.
untargeted=$(openclaw cron list --json | python3 -c '
import json, sys
for j in json.load(sys.stdin).get("jobs", []):
    if not j.get("enabled"): continue
    d = j.get("delivery") or {}
    if not d.get("to"):
        print(j["id"] + "\t" + j.get("name", "?"))
')

if [ -z "$untargeted" ]; then
  echo "    every enabled cron already has a delivery target — nothing to do"
  exit 0
fi
while IFS=$'\t' read -r id name; do
  openclaw cron edit "$id" --announce --channel telegram --to "$TARGET" >/dev/null
  echo "    $name ($id): delivery -> $TARGET"
done <<< "$untargeted"
