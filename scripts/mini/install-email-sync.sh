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
# Email intake tick — one connector pass per account, then one filing pass.
#
# Accounts are env files in ~/.config/command-center: `mail.env` plus any
# `mail-<name>.env` (e.g. mail-infiniteai.env). Each carries its own
# IMAP_HOST / IMAP_USER / IMAP_PASSWORD (and optionally IMAP_FOLDERS — folder
# names differ per server). Dropping a new file in makes that account live on
# the next tick; nothing else to install. Each pass runs in a subshell so one
# account's variables never leak into the next.
#
# All accounts stage into the same dir (dedupe is by message hash, so a message
# two accounts both hold is staged once), and the filer runs once at the end —
# it never needs to know which account a message came from. It also runs even
# if a connector pass failed: staged-but-unfiled mail should never wait on a
# mailbox being reachable.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
CFG="$HOME/.config/command-center"
found=0
for env_file in "$CFG/mail.env" "$CFG"/mail-*.env; do
  [ -f "$env_file" ] || continue
  found=1
  (
    set -a; . "$env_file"; set +a
    echo "== account: $IMAP_USER =="
    /usr/bin/python3 "$HOME/repos/command-center/scripts/sync-email.py"
  )
done
[ "$found" = 1 ] || exit 0
cd "$HOME/repos/command-center" || exit 0
node --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/scribe.ts
# Regenerate the 8am brief's source view from the store — the M4 fix for the
# hand-edited file that died in May. No-op (zero commits) when nothing changed.
node --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/generate-outreach.ts
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
accounts=$(ls "$HOME/.config/command-center"/mail.env "$HOME/.config/command-center"/mail-*.env 2>/dev/null | wc -l | tr -d ' ' || true)
if [ "$accounts" != "0" ]; then
  echo "==> $accounts account file(s) present — intake is LIVE; log: $LOG_DIR/email-sync.log"
else
  echo "==> Waiting on credentials. Create $ENV_FILE (chmod 600) with:"
  echo "    IMAP_HOST=...  IMAP_USER=...  IMAP_PASSWORD=<app password>"
  echo "    (optional: IMAP_PORT, IMAP_SINCE_DAYS, IMAP_FOLDERS)"
  echo "    Additional accounts: mail-<name>.env beside it, same format."
fi
