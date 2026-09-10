#!/usr/bin/env bash
# Scribe's filing pass, gated on whether there is anything to file.
#
# Why: Scribe was the single largest token consumer in the system and 26 of its
# 32 runs produced nothing — ~11.0M tokens of the fleet's 27.5M/30d, spent
# re-reading 88 staged messages, the filer ledger, the review queue and 108 CRM
# contacts only to conclude that every stem was already in its judgment ledger.
# A no-op run cost 343,872 tokens on average; a productive one cost 375,924.
# The cost is loading the context, not doing the work — so the only fix that
# helps is one that decides BEFORE the agent boots.
#
# The decision is a set difference over two files, so it is exact and needs no
# model: staged stems minus judgment-ledger keys. That is the same conclusion
# Scribe reaches on its own, for free.
#
# This runs as the cron's command payload (see install-scribe-gate.sh). It
# prints one line when there is nothing to do, and otherwise delegates to the
# real agent turn and prints its reply — so the job's existing announce
# delivery carries exactly what it carried before.
#
# Deliberately NOT silent on skip: a one-line notice per run is what proves the
# pipeline is alive. Silence is how the Friday brief went unread for two weeks.
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

OPS="$HOME/repos/operations"
MAILDIR="$OPS/crm/intake/email"
LEDGER="$MAILDIR/.judgment-ledger"
SYNC_LOG="$HOME/.openclaw/logs/email-sync.log"
STALE_HOURS=3          # email-sync ticks every 15 min; 3h means something is wrong

# The message the agent turn used before this gate existed. Unchanged on purpose.
AGENT_MSG="Startup per AGENTS.md, then run THE JOB — one filing pass over unprocessed staged mail. Verify outputs by read-back; nothing found is a valid result."

[ -d "$MAILDIR" ] || { echo "scribe-gate: $MAILDIR missing — cannot decide, not skipping"; exit 1; }

# --- how many staged messages have never been through judgment? ---------------
unfiled=$(python3 - "$MAILDIR" "$LEDGER" <<'PY'
import json, os, sys, glob
maildir, ledger_path = sys.argv[1], sys.argv[2]
staged = {os.path.basename(p)[:-5] for p in glob.glob(os.path.join(maildir, "*.json"))}
try:
    with open(ledger_path) as fh:
        led = json.load(fh)
    filed = set(led) if isinstance(led, dict) else set(led)
except FileNotFoundError:
    filed = set()          # no ledger yet -> everything staged is unfiled
except (json.JSONDecodeError, TypeError):
    print("ERR"); raise SystemExit(0)
print(len(staged - filed))
PY
)

if [ "$unfiled" = "ERR" ] || ! [ "$unfiled" -eq "$unfiled" ] 2>/dev/null; then
  echo "scribe-gate: judgment ledger unreadable — running the filing pass rather than guessing"
  unfiled=1
fi

# --- anti-masking: a quiet inbox and a dead sync look identical from here ------
stale_note=""
if [ -f "$SYNC_LOG" ]; then
  age_h=$(( ( $(date +%s) - $(stat -f %m "$SYNC_LOG") ) / 3600 ))
  [ "$age_h" -ge "$STALE_HOURS" ] && stale_note=" ⚠️ email-sync last wrote ${age_h}h ago — intake may be stalled"
else
  stale_note=" ⚠️ no email-sync log — intake may never have run here"
fi

if [ "$unfiled" -eq 0 ]; then
  staged_n=$(ls "$MAILDIR"/*.json 2>/dev/null | wc -l | tr -d ' ')
  echo "✒️ Nothing to file — all ${staged_n} staged messages are already in the judgment ledger.${stale_note}"
  exit 0
fi

# --- there is real work: run the agent turn the cron used to run --------------
if [ -z "${OPENCLAW_GATEWAY_TOKEN:-}" ]; then
  OPENCLAW_GATEWAY_TOKEN="$(security find-generic-password -s openclaw-gateway-token -a openclaw -w 2>/dev/null || true)"
  export OPENCLAW_GATEWAY_TOKEN
fi

# Unique session key per run preserves the isolated-session semantics the job
# had as an agentTurn — Scribe must never inherit a previous pass's context.
SESSION_KEY="agent:scribe:gate:$(date +%Y%m%dT%H%M%S)"

out=$(openclaw agent \
        --agent scribe \
        --session-key "$SESSION_KEY" \
        --message "$AGENT_MSG" \
        --thinking low \
        --timeout 900 \
        --json 2>&1)
rc=$?

if [ $rc -ne 0 ]; then
  echo "scribe-gate: ${unfiled} message(s) to file, but the agent turn failed (exit $rc).${stale_note}"
  printf '%s\n' "$out" | tail -5
  echo "To revert this job to a plain agent turn:"
  echo "  openclaw cron edit <scribe-filing id> --message \"\$AGENT_MSG\""
  exit 1
fi

# Print the agent's reply so the cron's existing announce delivery carries it.
printf '%s' "$out" | python3 -c '
import json, sys
raw = sys.stdin.read()
try:
    d = json.loads(raw)
except json.JSONDecodeError:
    print(raw.strip()); raise SystemExit
for k in ("text", "reply", "message", "final", "content"):
    v = d.get(k) if isinstance(d, dict) else None
    if isinstance(v, str) and v.strip():
        print(v.strip()); raise SystemExit
print(json.dumps(d)[:2000])
'
[ -n "$stale_note" ] && echo "$stale_note"
exit 0
