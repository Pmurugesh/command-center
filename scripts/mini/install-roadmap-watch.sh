#!/usr/bin/env bash
# Install roadmap-watch on the Mac mini: a launchd tick, every 5 minutes, that
# asks each clone's origin whether ANY branch head moved and, if one did, runs
# roadmap-check in `--quiet` mode. The board follows the repos; the 08:00 cron
# (install-roadmap-check.sh) stays as the one daily Telegram announce.
#
# Why polling and not a webhook: the mini is reachable on the tailnet only, so
# GitHub cannot call it, and opening a public Funnel for this is the wrong
# trade. Same pattern as commandcenter-deploy. Why ls-remote and not fetch:
# one round trip per repo (~1s each), no objects, no working-tree side effects;
# the check does its own fetch when it runs.
#
# Cost: shell and git only — no model call, no tokens. Nothing is announced.
#
# Idempotent; runs from post-deploy.sh on every merge. Re-running rewrites the
# wrapper and reloads the agent.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

LABEL="com.paladin.roadmap-watch"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
WRAPPER="$HOME/bin/roadmap-watch.sh"
LOG_DIR="$HOME/.openclaw/logs"
STATE_DIR="$HOME/.openclaw/state"
INTERVAL_SECONDS=300

mkdir -p "$HOME/bin" "$HOME/Library/LaunchAgents" "$LOG_DIR" "$STATE_DIR"

cat > "$WRAPPER" <<'WRAP'
#!/usr/bin/env bash
# roadmap-watch — see scripts/mini/install-roadmap-watch.sh in command-center.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=10"
REPOS="$HOME/repos"
CC="$HOME/repos/command-center"
STATE="$HOME/.openclaw/state/roadmap-watch.heads"
LOCK="$HOME/.openclaw/state/roadmap-watch.lock"
stamp() { date -u "+%Y-%m-%dT%H:%M:%SZ"; }

# One tick at a time: a check can take a minute, the tick fires every five.
if [ -e "$LOCK" ] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then
  echo "$(stamp) skipped another tick is running"; exit 0
fi
echo $$ > "$LOCK"; trap 'rm -f "$LOCK"' EXIT

# Every clone with an origin. A repo whose ls-remote fails keeps its previous
# line (marked), so a flaky network never reads as "something moved".
prev="$(cat "$STATE" 2>/dev/null || true)"
next=""; moved=""; failed=""
for dir in "$REPOS"/*/; do
  dir=${dir%/}; name=$(basename "$dir")
  [ -d "$dir/.git" ] || continue
  git -C "$dir" remote get-url origin >/dev/null 2>&1 || continue
  if heads=$(git -C "$dir" ls-remote --heads --tags origin 2>/dev/null); then
    sum=$(printf '%s' "$heads" | shasum | cut -c1-12)
  else
    failed="$failed $name"
    sum=$(printf '%s\n' "$prev" | awk -v n="$name" '$1==n{print $2}')
    [ -n "$sum" ] || sum="unreachable"
  fi
  next="$next$name $sum"$'\n'
  old=$(printf '%s\n' "$prev" | awk -v n="$name" '$1==n{print $2}')
  [ "$old" = "$sum" ] || moved="$moved $name"
done

if [ -z "$prev" ]; then
  # First tick: take the baseline without a run — the 08:00 cron already
  # produced today's board, and a deploy must not fire a check on its own.
  printf '%s' "$next" > "$STATE"
  echo "$(stamp) quiet baseline taken ($(printf '%s' "$next" | wc -l | tr -d ' ') repos)"; exit 0
fi
if [ -z "$moved" ]; then
  echo "$(stamp) quiet${failed:+ (unreachable:$failed)}"; exit 0
fi

echo "$(stamp) triggered moved:$moved${failed:+ (unreachable:$failed)}"
NODE="$(command -v node)"
if ( cd "$CC" && "$NODE" --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/roadmap-check.ts --quiet ) >>"$HOME/.openclaw/logs/roadmap-watch-run.log" 2>&1; then
  printf '%s' "$next" > "$STATE"
  echo "$(stamp) ok roadmap-check ran; baseline advanced"
else
  # Keep the old baseline: the next tick retries the same delta.
  echo "$(stamp) error roadmap-check failed (see roadmap-watch-run.log); baseline kept"
  exit 1
fi
WRAP
chmod +x "$WRAPPER"

cat > "$PLIST" <<EOF2
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$WRAPPER</string></array>
  <key>StartInterval</key><integer>$INTERVAL_SECONDS</integer>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string><key>HOME</key><string>$HOME</string></dict>
  <key>StandardOutPath</key><string>$LOG_DIR/roadmap-watch.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/roadmap-watch.log</string>
</dict>
</plist>
EOF2

echo "==> LaunchAgent $LABEL (every ${INTERVAL_SECONDS}s; log: $LOG_DIR/roadmap-watch.log)"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "    loaded. First tick takes the baseline; the next push to any repo triggers a check."
