#!/bin/bash
# mini-backup — nightly pull of everything on the mini that lives outside git.
#
# Audit 2026-09-14: Time Machine on the mini has no destination, and these
# exist nowhere else: the live cron store and auth profiles (sqlite), the
# OpenClaw config, every agent's memory/ (gitignored), the qual-table
# credentials, the staged mail and its ledgers, the launchd plists, ~/bin, the
# deploy keys. A disk failure loses all of it. This pulls a daily snapshot to
# ~/Backups/paladins-mac-mini/<date>/ over the tailnet, hard-linking unchanged
# files against the previous snapshot (rsync --link-dest), and keeps 14 days.
#
# Pull-side on purpose: the mini keeps no credential for the MacBook, and the
# copy lands on a machine that already holds the same secrets.
#
# What it cannot copy: the two Keychain items (gateway token, Telegram bot
# token). Both are re-creatable (BotFather; a fresh gateway token), which the
# restore notes in README.md say.
set -uo pipefail
HOST="${MINI_SSH:-paladins-mac-mini}"
ROOT="$HOME/Backups/paladins-mac-mini"
LOG="$HOME/.local/state/mini-backup.log"
KEEP_DAYS=14
DATE=$(date +%F)
DEST="$ROOT/$DATE"
LATEST="$ROOT/latest"

mkdir -p "$ROOT" "$(dirname "$LOG")"
chmod 700 "$ROOT"
log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >> "$LOG"; }
notify() { osascript -e "display notification \"$1\" with title \"mini backup\"" 2>/dev/null || true; }
fail() { log "FAILED: $1"; notify "FAILED: $1"; exit 1; }

# Offline MacBook or unreachable mini: not an error, just no snapshot tonight.
ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST" true 2>/dev/null \
  || { log "mini unreachable; skipped"; exit 0; }

# 1. Consistent sqlite copies on the mini (the live files use WAL; a raw copy
#    mid-write is corrupt). Staged under ~/.openclaw/backup-staging.
ssh -o BatchMode=yes "$HOST" 'set -e
  S=$HOME/.openclaw/backup-staging; mkdir -p "$S/agents"
  sqlite3 "$HOME/.openclaw/state/openclaw.sqlite" ".backup $S/state.sqlite"
  for d in "$HOME"/.openclaw/agents/*/agent; do
    a=$(basename "$(dirname "$d")")
    [ -f "$d/openclaw-agent.sqlite" ] && sqlite3 "$d/openclaw-agent.sqlite" ".backup $S/agents/$a.sqlite"
  done
  date -u +%FT%TZ > "$S/STAGED_AT"' || fail "sqlite staging on the mini"

# 2. Pull. Each part links unchanged files to the same part of the last snapshot.
#    -R keeps the full path relative to the mini home (openrsync ignores the
#    GNU "/./" anchor), so operations-private/ holds repos/operations/... .
mkdir -p "$DEST"
pull() {  # pull <part> <rsync args...>
  local part=$1; shift
  local link=()
  [ -d "$LATEST/$part" ] && link=(--link-dest="$LATEST/$part/")
  mkdir -p "$DEST/$part"
  # ${link[@]+"${link[@]}"}: macOS ships bash 3.2, where an empty array is
  # "unbound" under set -u.
  rsync -a --delete ${link[@]+"${link[@]}"} "$@" "$DEST/$part/" 2>>"$LOG" || fail "rsync $part"
}
pull openclaw \
  --exclude='agents/*/sessions/' --exclude='logs/' --exclude='tmp/' --exclude='cache/' \
  --exclude='media/' --exclude='*.sqlite-wal' --exclude='*.sqlite-shm' \
  "$HOST:.openclaw/"
pull operations-private -R \
  "$HOST:repos/operations/agents/main/.credentials" \
  "$HOST:repos/operations/crm/intake/email"
# agents/*/memory: globs expand on the remote side, one -R source each.
for m in $(ssh -o BatchMode=yes "$HOST" 'ls -d repos/operations/agents/*/memory 2>/dev/null'); do
  rsync -a -R "$HOST:$m" "$DEST/operations-private/" 2>>"$LOG" || fail "rsync $m"
done
# --exclude the ssh-agent socket: openrsync cannot create sockets (mkstempsock).
pull home -R --exclude=".ssh/agent" --exclude="*.sock" \
  "$HOST:./bin" "$HOST:./.config/command-center" "$HOST:./.ssh" "$HOST:./.local/state" \
  "$HOST:./Library/LaunchAgents/"

# 3. Rotate.
ln -sfn "$DEST" "$LATEST"
find "$ROOT" -maxdepth 1 -type d -name '20[0-9][0-9]-*' -mtime +"$KEEP_DAYS" -exec rm -rf {} + 2>/dev/null
date -u +%FT%TZ > "$ROOT/LAST_OK"
log "ok $DATE $(du -sh "$DEST" | cut -f1) (snapshots: $(ls -d "$ROOT"/20* | wc -l | tr -d ' '))"
