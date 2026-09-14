#!/usr/bin/env bash
# Narrow an already-installed com.paladin.commandcenter plist to loopback.
#
# install-dashboard-service.sh writes `-H 127.0.0.1` for new installs, but it
# also rebuilds and restarts, so it is not something post-deploy.sh can run on
# every merge. This script does the one-line correction and a kickstart, and
# is a no-op once the plist is right — which is what post-deploy.sh needs.
#
# Why: Tailscale Serve proxies the tailnet URL to 127.0.0.1:3000 and the API
# has no auth, so a 0.0.0.0 bind exposed 14 mutating routes to the LAN for no
# benefit (audit 2026-09-14).
set -euo pipefail

LABEL="com.paladin.commandcenter"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ ! -f "$PLIST" ]; then
  echo "dashboard-bind: $PLIST not installed; nothing to narrow"
  exit 0
fi

if ! grep -q '<string>0.0.0.0</string>' "$PLIST"; then
  echo "dashboard-bind: already loopback-only"
  exit 0
fi

sed -i '' 's|<string>0.0.0.0</string>|<string>127.0.0.1</string>|' "$PLIST"
echo "dashboard-bind: plist narrowed to 127.0.0.1"

# launchd only re-reads ProgramArguments on bootstrap, so a kickstart alone
# would restart with the old bind. Bootout + bootstrap, gui domain first.
UID_NUM="$(id -u)"
launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || launchctl bootout "user/$UID_NUM/$LABEL" 2>/dev/null || true
sleep 1
launchctl bootstrap "gui/$UID_NUM" "$PLIST" 2>/dev/null || launchctl bootstrap "user/$UID_NUM" "$PLIST"
sleep 5
if lsof -nP -iTCP:3000 -sTCP:LISTEN | grep -q '127.0.0.1:3000'; then
  echo "dashboard-bind: listening on 127.0.0.1:3000"
else
  echo "dashboard-bind: WARNING — port 3000 listener is not loopback-only yet:"
  lsof -nP -iTCP:3000 -sTCP:LISTEN || true
  exit 1
fi
