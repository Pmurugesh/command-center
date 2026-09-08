#!/usr/bin/env bash
# Keep the mini's read-only Nexus clone on origin/main automatically, so the
# codebase health scans never read a stale tree.
#
# Why: the live scan (`product-weekly-code-scan`, Forge, Mondays 03:00 PT)
# scans ~/repos/Nexus as-is. Nothing pulled it — the clone was refreshed only
# when a human remembered (last by hand 2026-08-28). On 2026-09-08 it sat 5
# commits behind origin/main, and those 5 were the security fixes closing most
# of Paladin's own open findings; the next scan would have re-reported them.
#
# Two layers, either one alone is enough:
#   1. ~/bin/nexus-sync.sh + LaunchAgent `com.paladin.nexus-sync`, daily 02:30
#      PT (30 min before the scan). Fast-forward ONLY — the clone is read-only
#      by rule, so it never merges, rebases, resets, or touches the untracked
#      bid/intel files the bid workflow drops in there.
#   2. The Forge cron prompt gets the sync as its first instruction, so the
#      scan itself pulls "each time" even if launchd missed a tick. This half
#      needs the gateway token (Keychain), which only resolves in the mini's
#      on-screen Terminal — over ssh it prints the command to paste instead.
#
# Idempotent: safe to re-run for every deploy.
#
# Run ON the mini as `paladin`:
#   ./scripts/mini/install-nexus-sync.sh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

LABEL="com.paladin.nexus-sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
WRAPPER="$HOME/bin/nexus-sync.sh"
LOG_DIR="$HOME/.openclaw/logs"
JOB_NAME="product-weekly-code-scan"

mkdir -p "$HOME/bin" "$HOME/Library/LaunchAgents" "$LOG_DIR"

cat > "$WRAPPER" <<'EOF'
#!/bin/bash
# Fast-forward ~/repos/Nexus to origin/main. Read-only clone: ff-only, never
# reset/rebase/stash; untracked files (bids/, intelligence/) are left alone.
# Exit non-zero on anything unexpected so the log and the calling scan see it.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
REPO="$HOME/repos/Nexus"
stamp() { date "+%Y-%m-%d %H:%M:%S %Z"; }
cd "$REPO" || { echo "[$(stamp)] nexus-sync: $REPO missing"; exit 1; }

branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" != "main" ]; then
  echo "[$(stamp)] nexus-sync: clone is on '$branch', not main — refusing to touch it"; exit 1
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "[$(stamp)] nexus-sync: tracked files modified in the read-only clone — refusing to merge over them"
  git status --short --untracked-files=no; exit 1
fi

before=$(git rev-parse --short HEAD)
if ! git fetch --quiet origin main; then
  echo "[$(stamp)] nexus-sync: fetch failed (network or deploy key) — scan will run on $before"; exit 1
fi
if ! git merge --ff-only --quiet origin/main; then
  echo "[$(stamp)] nexus-sync: cannot fast-forward $before to origin/main — local main has diverged"; exit 1
fi
after=$(git rev-parse --short HEAD)
if [ "$before" = "$after" ]; then
  echo "[$(stamp)] nexus-sync: up to date at $after"
else
  n=$(git rev-list --count "$before..$after")
  echo "[$(stamp)] nexus-sync: $before -> $after ($n commits)"
fi
EOF
chmod +x "$WRAPPER"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$WRAPPER</string></array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>30</integer></dict>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string><key>HOME</key><string>$HOME</string></dict>
  <key>StandardOutPath</key><string>$LOG_DIR/nexus-sync.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/nexus-sync.log</string>
</dict>
</plist>
EOF

echo "==> LaunchAgent $LABEL (daily 02:30, local time)"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "    loaded. Running once now:"
if "$WRAPPER"; then :; else echo "    (sync failed — see $LOG_DIR/nexus-sync.log)"; fi

echo "==> Forge scan prompt: run the sync first"
# Same Keychain lookup install-bid-sync.sh uses; empty over ssh by design.
if [ -z "${OPENCLAW_GATEWAY_TOKEN:-}" ]; then
  OPENCLAW_GATEWAY_TOKEN="$(security find-generic-password -s openclaw-gateway-token -a openclaw -w 2>/dev/null || true)"
  export OPENCLAW_GATEWAY_TOKEN
fi
PREFIX="FIRST, run the shell command ~/bin/nexus-sync.sh and note its output line in the report header (it fast-forwards ~/repos/Nexus to origin/main; if it fails, say so in the report and scan what is there). THEN: "
if [ -z "$OPENCLAW_GATEWAY_TOKEN" ]; then
  echo "    gateway token not available in this shell (expected over ssh)."
  echo "    In the mini's on-screen Terminal, run this installer again, or paste:"
  echo "      openclaw cron list --json | python3 -c 'import json,sys; print(*[j[\"id\"]+\" \"+j[\"payload\"][\"message\"] for j in json.load(sys.stdin)[\"jobs\"] if j[\"name\"]==\"$JOB_NAME\"])'"
  echo "      openclaw cron edit <id> --message \"$PREFIX<existing message>\""
  exit 0
fi
read -r JOB_ID JOB_MSG < <(openclaw cron list --json | python3 -c '
import json, sys
for j in json.load(sys.stdin).get("jobs", []):
    if j.get("name") == sys.argv[1]:
        print(j["id"], j.get("payload", {}).get("message", "").replace("\n", " ")); break
' "$JOB_NAME")
if [ -z "${JOB_ID:-}" ]; then
  echo "    no cron named $JOB_NAME — nothing to patch"; exit 0
fi
case "$JOB_MSG" in
  *nexus-sync.sh*) echo "    $JOB_ID already runs nexus-sync first — leaving as is" ;;
  *) openclaw cron edit "$JOB_ID" --message "$PREFIX$JOB_MSG"
     echo "    patched $JOB_ID: scan now syncs before it reads" ;;
esac
