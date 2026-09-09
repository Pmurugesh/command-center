#!/usr/bin/env bash
# Deploy command-center on the Mac mini whenever origin/main moves — the
# code-side mirror of the operations janitor.
#
# Why: on 2026-09-08 PR #39 was merged and pulled onto the mini, and the live
# dashboard still served 404 for /roadmap for hours. `next start` serves the
# bundle in .next/, and nothing rebuilt it. Data synced within two minutes
# (the janitor); code needed a human to remember a script. This is that human.
#
# Every tick (launchd StartInterval, see the installer):
#   fetch → if origin/main == HEAD, exit silently
#         → refuse if not on main or the tree is dirty (someone is mid-work)
#         → pull --ff-only, pnpm install, pnpm build
#         → run scripts/mini/post-deploy.sh (idempotent mini-side installers)
#         → on success restart the service; on failure log and KEEP the old
#           process serving (its .next may be partially overwritten — the same
#           exposure install-dashboard-service.sh has always had; a failed
#           build is fixed by merging a fix, which this job then deploys).
#
# One line per event in ~/.openclaw/logs/command-center-deploy.log; silent
# when there is nothing to do, so the log is a history of deploys, not ticks.
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

REPO_DIR="$HOME/repos/command-center"
LABEL="com.paladin.commandcenter"
LOG="$HOME/.openclaw/logs/command-center-deploy.log"
mkdir -p "$(dirname "$LOG")"
log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG"; }

# Machine-readable twin of the log line above.
#
# The log has always recorded what happened; nothing READ it. So the failure this
# script's own header describes — "BUILD FAILED … old bundle still serving" —
# left the dashboard looking completely normal while serving stale code, and the
# only trace was a line in a file nobody opens. This file is what makes that
# state visible on /system.
#
# Written at EVERY exit path, including the skips: "did not deploy because the
# tree was dirty" is exactly as important as "deployed", and a state file that
# only records successes would go stale in precisely the situations it exists for.
STATE="$HOME/.openclaw/state/command-center-deploy.json"
state() { # result, sha, target, extra-json
  mkdir -p "$(dirname "$STATE")"
  cat > "$STATE" <<JSON
{
  "at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "result": "$1",
  "sha": "$2",
  "target": "$3",
  "subject": $(git log -1 --format=%s "$2" 2>/dev/null | head -c 160 | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo '""'),
  "host": "$(hostname -s)"${4:+,
  $4}
}
JSON
}

cd "$REPO_DIR" || { log "FAIL: $REPO_DIR missing"; exit 0; }
git fetch -q origin main 2>/dev/null || { log "fetch failed (offline?)"; exit 0; }

local_sha=$(git rev-parse HEAD)
remote_sha=$(git rev-parse origin/main)
if [ "$local_sha" = "$remote_sha" ]; then
  # Nothing to do — but RECORD it, so "current" is a fresh fact rather than the
  # absence of news. Without this the state file would age out and read stale on
  # a perfectly healthy mini.
  state "current" "$local_sha" "$remote_sha"
  exit 0
fi

branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" != "main" ]; then
  log "SKIP: checked out on $branch, not main — ${remote_sha:0:7} waiting"
  state "skipped-branch" "$local_sha" "$remote_sha" "\"branch\": \"$branch\""
  exit 0
fi
if [ -n "$(git status --porcelain)" ]; then
  log "SKIP: working tree dirty — ${remote_sha:0:7} waiting"
  state "skipped-dirty" "$local_sha" "$remote_sha"
  exit 0
fi

git pull -q --ff-only origin main || {
  log "pull --ff-only failed at ${local_sha:0:7}"
  state "pull-failed" "$local_sha" "$remote_sha"
  exit 0
}
log "pulled ${local_sha:0:7} -> ${remote_sha:0:7}: $(git log -1 --format=%s | cut -c1-80)"

if pnpm install --frozen-lockfile --silent >>"$LOG" 2>&1 && pnpm build >>"$LOG" 2>&1; then
  launchctl kickstart -k "gui/$(id -u)/$LABEL" 2>/dev/null \
    || launchctl kickstart -k "user/$(id -u)/$LABEL" 2>/dev/null \
    || log "restart failed — service not bootstrapped? run install-dashboard-service.sh"
  sleep 6
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:3000/ || echo 000)
  log "deployed ${remote_sha:0:7} — HTTP $code"
  state "deployed" "$remote_sha" "$remote_sha" "\"http\": $code"
else
  log "BUILD FAILED at ${remote_sha:0:7} — old bundle still serving; merge a fix"
  # `sha` is what is SERVING, `target` is what should be. The gap is the point.
  state "build-failed" "$local_sha" "$remote_sha"
fi

# Mini-side installers ride the same merge (see post-deploy.sh for the rule).
# Independent of the build: a broken bundle must not hold back a cron fix.
bash scripts/mini/post-deploy.sh >>"$LOG" 2>&1 || log "post-deploy hook exited non-zero"
