#!/usr/bin/env bash
# Build & (re)deploy the Command Center dashboard on the Mac mini.
# Idempotent: manages the EXISTING launchd service `com.paladin.commandcenter`
# (rewrites its plist, rebuilds, restarts). Safe to re-run for every deploy.
#
# Run ON the mini as `paladin`:
#   ./scripts/mini/install-dashboard-service.sh [/path/to/command-center]
set -euo pipefail

# Homebrew's bin is NOT on the PATH of a non-interactive SSH session, so a
# remote `ssh mini './install-dashboard-service.sh'` failed with
# "pnpm: command not found" while the same script worked when run by hand.
# The LaunchAgent below already hard-codes this PATH; the build half needs it too.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

REPO_DIR="${1:-$HOME/repos/command-center}"
LABEL="com.paladin.commandcenter"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/.openclaw/logs"

if [ ! -f "$REPO_DIR/package.json" ]; then
  echo "Dashboard repo not found at $REPO_DIR"
  echo "Pass the path explicitly: $0 /path/to/command-center"
  exit 1
fi

echo "==> Building production bundle"
cd "$REPO_DIR"
pnpm install
pnpm build

echo "==> Writing LaunchAgent $LABEL"
mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/npx</string>
    <string>next</string>
    <string>start</string>
    <string>-H</string>
    <string>0.0.0.0</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <key>StandardOutPath</key><string>$LOG_DIR/command-center.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/command-center-error.log</string>
</dict>
</plist>
EOF

# Restart under launchd. The gui domain needs a logged-in console session;
# fall back to the user domain when running headless.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootout "user/$(id -u)/$LABEL" 2>/dev/null || true
# Free port 3000 if a manually-started server is still holding it
lsof -ti :3000 | xargs kill 2>/dev/null || true
sleep 1
DOMAIN="gui/$(id -u)"
launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null \
  || { DOMAIN="user/$(id -u)"; launchctl bootstrap "$DOMAIN" "$PLIST"; }

echo "==> Power settings (best effort; needs sudo)"
sudo -n pmset -a sleep 0 autorestart 1 2>/dev/null \
  || echo "    Skipped — run manually: sudo pmset -a sleep 0 autorestart 1"

echo "==> Verifying"
sleep 5
curl -s -o /dev/null -w "Dashboard responded with HTTP %{http_code}\n" http://localhost:3000/ \
  || echo "Not up yet — check $LOG_DIR/command-center-error.log"
echo
echo "Tailnet URL: http://paladins-mac-mini:3000"
