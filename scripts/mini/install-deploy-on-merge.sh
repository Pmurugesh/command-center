#!/usr/bin/env bash
# Install deploy-on-merge.sh as a launchd job on the Mac mini (every 5 min).
# Idempotent: rewrites the plist and re-bootstraps. Pair of
# install-dashboard-service.sh, which must have run once first (it creates
# the service this job restarts).
#
# Run ON the mini as `paladin`:
#   ./scripts/mini/install-deploy-on-merge.sh
set -euo pipefail

REPO_DIR="${1:-$HOME/repos/command-center}"
LABEL="com.paladin.commandcenter-deploy"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/.openclaw/logs"
SCRIPT="$REPO_DIR/scripts/mini/deploy-on-merge.sh"

[ -x "$SCRIPT" ] || chmod +x "$SCRIPT"
launchctl print "gui/$(id -u)/com.paladin.commandcenter" >/dev/null 2>&1 \
  || echo "    WARNING: com.paladin.commandcenter is not bootstrapped — run install-dashboard-service.sh first"

echo "==> Writing LaunchAgent $LABEL"
mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$SCRIPT</string>
  </array>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <key>StandardOutPath</key><string>$LOG_DIR/command-center-deploy.out</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/command-center-deploy.err</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootout "user/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null \
  || launchctl bootstrap "user/$(id -u)" "$PLIST"

echo "==> Installed. Deploys land in $LOG_DIR/command-center-deploy.log within 5 min of a merge to main."
