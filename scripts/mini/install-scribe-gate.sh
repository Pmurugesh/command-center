#!/usr/bin/env bash
# Put Scribe's filing pass behind a deterministic work check, and take the
# cheap levers on granola-sync.
#
# Why: 48% of all model tokens in the fleet went to runs that produced nothing.
# Scribe alone was ~11.0M of 27.5M tokens/30d — 26 of 32 runs found every
# staged stem already in its judgment ledger and stopped, having already paid
# to load the whole corpus. granola-sync was another ~2.2M across 6 of 11 runs.
#
# Scribe's check is a set difference over two local files, so it becomes a
# command payload that only spends tokens when there is something to file
# (scripts/mini/scribe-gate.sh). granola-sync's "is there a new meeting?" lives
# behind the Granola MCP, and `openclaw mcp` has no subcommand that invokes a
# tool — so it cannot be answered from shell and the job keeps its agent turn.
# What it gets instead is the two levers that were never set on any job (a
# thinking level matched to spec-following work, and light bootstrap context)
# plus an ordering guard: ask Granola before reading the CRM, so a no-op run
# costs a couple of turns rather than a corpus.
#
# Idempotent — re-running changes nothing once applied. Applied on every merge
# by scripts/mini/post-deploy.sh (the Keychain resolves under launchd; over ssh
# it logs a skip and retries on the next deploy).
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

REPO="$HOME/repos/command-center"
GATE="$REPO/scripts/mini/scribe-gate.sh"

if [ ! -x "$GATE" ]; then
  chmod +x "$GATE" 2>/dev/null || {
    echo "    $GATE missing or not executable — nothing installed"
    exit 1
  }
fi

if [ -z "${OPENCLAW_GATEWAY_TOKEN:-}" ]; then
  OPENCLAW_GATEWAY_TOKEN="$(security find-generic-password -s openclaw-gateway-token -a openclaw -w 2>/dev/null || true)"
  export OPENCLAW_GATEWAY_TOKEN
fi
if [ -z "$OPENCLAW_GATEWAY_TOKEN" ]; then
  echo "    gateway token not readable here (locked Keychain) — skipped; re-applied on the next deploy"
  exit 0
fi

jobs_json="$(openclaw cron list --json)"

# id<TAB>alreadyGated<TAB>alreadyTuned
#
# The "already applied" fields are a courtesy, not a guard: `cron edit` is
# idempotent, so if the payload shape ever changes and detection goes blind we
# re-apply on every deploy rather than silently never applying. Only the id is
# load-bearing, and it is matched on name.
read_job() {
  printf '%s' "$jobs_json" | python3 -c '
import json, sys
want = sys.argv[1]
for j in json.load(sys.stdin).get("jobs", []):
    if j.get("name") != want:
        continue
    p = j.get("payload") or {}
    blob = json.dumps(p)                       # shape-agnostic on purpose
    gated = "yes" if "scribe-gate.sh" in blob else "no"
    tuned = "yes" if (p.get("thinking") == "low"
                      and bool(p.get("lightContext") or p.get("light_context"))) else "no"
    print("\t".join([j.get("id", ""), gated, tuned]))
    break
' "$1"
}

# The cron message, raw. Kept out of read_job because a message contains newlines
# and read_job's output is tab/line delimited.
read_msg() {
  printf '%s' "$jobs_json" | python3 -c '
import json, sys
want = sys.argv[1]
for j in json.load(sys.stdin).get("jobs", []):
    if j.get("name") == want:
        m = (j.get("payload") or {}).get("message")
        if isinstance(m, str):
            sys.stdout.write(m)
        break
' "$1"
}

# ---- 1. scribe-filing -> gated command payload -------------------------------
IFS=$'\t' read -r sid sgated _stuned <<< "$(read_job scribe-filing)"

if [ -z "${sid:-}" ]; then
  echo "    scribe-filing not found — skipped"
elif [ "$sgated" = "yes" ]; then
  echo "    scribe-filing already gated — nothing to do"
else
  openclaw cron edit "$sid" \
    --command "$GATE" \
    --timeout-seconds 1200 \
    --output-max-bytes 65536 >/dev/null
  echo "    scribe-filing ($sid): agentTurn -> gated command ($GATE)"
  echo "      the agent turn now runs only when staged mail is missing from the judgment ledger"
fi

# ---- 2. granola-sync -> cheap levers, agent turn kept ------------------------
IFS=$'\t' read -r gid _ggated gtuned <<< "$(read_job granola-sync)"

if [ -z "${gid:-}" ]; then
  echo "    granola-sync not found — skipped"
elif [ "$gtuned" = "yes" ]; then
  echo "    granola-sync already tuned — nothing to do"
else
  openclaw cron edit "$gid" --thinking low --light-context >/dev/null
  echo "    granola-sync ($gid): thinking=low, light-context on"
fi

# ---- 3. granola-sync -> ask Granola before reading the CRM -------------------
# There is no shell-callable Granola: `openclaw mcp` (2026.6.34) can list, probe,
# filter and authorize servers but has no subcommand that invokes a tool, so the
# "is there a new meeting?" question cannot be answered the way Scribe's "is there
# unfiled mail?" could. The lever that remains is ORDER — asking Granola first and
# stopping on "nothing new" turns a no-op run from a full corpus read into a
# couple of turns. That run order lives in operations/agents/granola-sync/SPEC.md;
# this pins the same rule to the cron message, which the agent reads first and
# always.
GUARD_MARK="BEFORE reading anything else"
GUARD_LINE="Ask Granola for new meetings BEFORE reading anything else. If nothing is new since the newest filename date in crm/meetings/, reply \"nothing new\" and stop — do not read the archive, do not read crm/contacts/."

if [ -n "${gid:-}" ]; then
  cur_msg="$(read_msg granola-sync)"
  if [ -z "$cur_msg" ]; then
    echo "    granola-sync: no message in payload — ordering guard left to SPEC.md"
  elif printf '%s' "$cur_msg" | grep -qF "$GUARD_MARK"; then
    echo "    granola-sync already carries the ordering guard — nothing to do"
  elif openclaw cron edit "$gid" --message "$cur_msg

$GUARD_LINE" >/dev/null 2>&1; then
    echo "    granola-sync ($gid): ordering guard appended to the cron message"
  else
    echo "    granola-sync: could not set --message — ordering guard lives in SPEC.md only"
  fi
fi
