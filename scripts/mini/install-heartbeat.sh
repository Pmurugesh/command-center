#!/usr/bin/env bash
# Install the pipeline heartbeat as a launchd job on the Mac mini (hourly).
#
# Why launchd and not an OpenClaw cron, unlike roadmap-check:
#
#   * It runs HOURLY. An openclaw cron needs an explicit delivery target or every
#     run reads as an error, and with one attached this would be 24 Telegram
#     messages a day — most of them "all pipelines healthy". A check that has to
#     be muted is worse than no check, so its findings go where findings already
#     go: a dated intel alert in operations, surfaced by /intel and Today, written
#     ONLY when they change.
#   * Installing it needs no gateway token, so it rides a merge with no Keychain
#     dance at all. It still READS the cron schedules at runtime to derive each
#     pipeline's expectation, and a launchd GUI agent can reach the Keychain —
#     the same thing install-cron-delivery.sh proved. When it cannot, every
#     expectation falls back to the declared one and the report says so.
#
# What it cannot do: notice its own death. A heartbeat has no heartbeat. The
# machine going dark is already covered from the other side by the MacBook's
# `com.pavan.mini-watchdog`; this job dying while the mini stays up is an
# uncovered case, and saying so is better than implying it is covered.
#
# Idempotent: rewrites the plist and re-bootstraps every time.
#   ./scripts/mini/install-heartbeat.sh
set -euo pipefail

REPO_DIR="${1:-$HOME/repos/command-center}"
LABEL="com.paladin.heartbeat"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/.openclaw/logs/heartbeat.log"
NODE="$(command -v node || echo /opt/homebrew/bin/node)"

[ -f "$REPO_DIR/scripts/heartbeat.ts" ] || {
  echo "install-heartbeat: $REPO_DIR/scripts/heartbeat.ts missing — skipping"; exit 0; }

mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
cat > "$PLIST" <<PLI
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd $REPO_DIR &amp;&amp; $NODE --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/heartbeat.ts</string>
  </array>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
PLI

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null \
  || launchctl load -w "$PLIST" 2>/dev/null \
  || { echo "install-heartbeat: could not bootstrap $LABEL"; exit 1; }
echo "install-heartbeat: $LABEL installed (hourly) -> $LOG"
