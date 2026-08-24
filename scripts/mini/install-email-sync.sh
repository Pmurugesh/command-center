#!/usr/bin/env bash
# Install the email-intake timer on the Mac mini — step 3 of moving email
# intake off the MacBook (step 1 was merging the connector to main, step 2 the
# credentials file, which stays a human act because it holds a password).
#
# Idempotent: rewrites ~/bin/email-sync.sh and the LaunchAgent
# `com.paladin.email-sync` (15 min), then (re)loads it. The wrapper exits 0
# silently while ~/.config/command-center/mail.env is absent, so this can be
# installed before the credentials exist without filling the log with errors.
#
# Run ON the mini as `paladin`:
#   ./scripts/mini/install-email-sync.sh
set -euo pipefail

LABEL="com.paladin.email-sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
WRAPPER="$HOME/bin/email-sync.sh"
LOG_DIR="$HOME/.openclaw/logs"
ENV_FILE="$HOME/.config/command-center/mail.env"

mkdir -p "$HOME/bin" "$HOME/Library/LaunchAgents" "$LOG_DIR" "$(dirname "$ENV_FILE")"

cat > "$WRAPPER" <<'EOF'
#!/bin/bash
# Email intake tick — inert until the credentials file exists.
ENV_FILE="$HOME/.config/command-center/mail.env"
[ -f "$ENV_FILE" ] || exit 0
set -a; . "$ENV_FILE"; set +a
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
exec /usr/bin/python3 "$HOME/repos/command-center/scripts/sync-email.py"
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
  <key>StartInterval</key><integer>900</integer>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string><key>HOME</key><string>$HOME</string></dict>
  <key>StandardOutPath</key><string>$LOG_DIR/email-sync.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/email-sync.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootout "user/$(id -u)/$LABEL" 2>/dev/null || true
DOMAIN="gui/$(id -u)"
launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null \
  || { DOMAIN="user/$(id -u)"; launchctl bootstrap "$DOMAIN" "$PLIST"; }

echo "==> Loaded $LABEL in $DOMAIN (every 15 min)"
if [ -f "$ENV_FILE" ]; then
  echo "==> $ENV_FILE present — intake is LIVE; log: $LOG_DIR/email-sync.log"
else
  echo "==> Waiting on credentials. Create $ENV_FILE (chmod 600) with:"
  echo "    IMAP_HOST=...  IMAP_USER=...  IMAP_PASSWORD=<app password>"
  echo "    (optional: IMAP_PORT, IMAP_SINCE_DAYS, IMAP_FOLDERS)"
fi
