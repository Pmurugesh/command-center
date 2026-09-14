#!/usr/bin/env bash
# Declarative agent-turn crons: scripts/mini/cron-jobs.json is the desired
# state, this makes the mini's cron store match it.
#
# Why: the agent redesign (docs, 2026-09-14) rewrote every agent's job — new
# messages, tighter tool lists, cheaper models, two new jobs, three retired,
# thirteen disabled legacy rows never removed. Until now each of those was a
# hand-typed `openclaw cron add` on the mini's own screen, and the messages
# lived only in the sqlite store. Now the message is a file in git, reviewed in
# a PR, and applied on merge like everything else.
#
# For each spec entry: missing → `openclaw cron add`; present → `openclaw cron
# edit` with ONLY the fields that differ (message compared byte-for-byte,
# tools as a set, schedule as expr+tz); listed under `delete` → `openclaw cron
# rm` (names in `delete_only_disabled` lose only their enabled=false rows);
# `patch` → schedule-only edits. An entry with just name + enabled flips the
# flag and leaves the payload alone. Idempotent: the second run prints only
# `unchanged: N`.
#
#   --dry   print the plan, run no `openclaw` mutation. Works over ssh too: when
#           `openclaw cron list` cannot reach the gateway (Keychain locked) it
#           reads the ENABLED jobs from the dashboard API instead, so a dry run
#           there cannot see disabled rows and will not list their deletes.
#
# Applied on every merge by scripts/mini/post-deploy.sh, BEFORE
# install-cron-alerts.sh so a job added here gets its failure alert in the
# same deploy. Over ssh without --dry it logs a skip (no gateway token).
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

SPEC="$(cd "$(dirname "$0")" && pwd)/cron-jobs.json"
DRY=0
for arg in "$@"; do
  case "$arg" in
    --dry) DRY=1 ;;
    --spec=*) SPEC="${arg#--spec=}" ;;
    *) echo "usage: $0 [--dry] [--spec=path]" >&2; exit 2 ;;
  esac
done
[ -f "$SPEC" ] || { echo "spec not found: $SPEC" >&2; exit 2; }

if [ "$DRY" -eq 0 ]; then
  if [ -z "${OPENCLAW_GATEWAY_TOKEN:-}" ]; then
    OPENCLAW_GATEWAY_TOKEN="$(security find-generic-password -s openclaw-gateway-token -a openclaw -w 2>/dev/null || true)"
    export OPENCLAW_GATEWAY_TOKEN
  fi
  if [ -z "$OPENCLAW_GATEWAY_TOKEN" ]; then
    echo "    gateway token not readable here (locked Keychain) — skipped; re-applied on the next deploy"
    exit 0
  fi
fi

DRY="$DRY" SPEC="$SPEC" python3 - <<'PY'
import json, os, subprocess, sys

DRY = os.environ["DRY"] == "1"
spec = json.load(open(os.environ["SPEC"]))

# ── live jobs ───────────────────────────────────────────────────────────────
# `--all` matters: without it the CLI hides disabled jobs, and the legacy rows
# this spec retires are exactly those.
def live_jobs():
    try:
        out = subprocess.run(["openclaw", "cron", "list", "--all", "--json"],
                             capture_output=True, text=True, timeout=60)
        if out.returncode == 0:
            return json.loads(out.stdout).get("jobs", []), "openclaw cron list --all"
    except (OSError, subprocess.TimeoutExpired, ValueError):
        pass
    if not DRY:
        print("    could not list cron jobs (gateway unreachable) — nothing applied", file=sys.stderr)
        sys.exit(1)
    out = subprocess.run(["curl", "-sf", "localhost:3000/api/system"], capture_output=True, text=True, timeout=30)
    if out.returncode != 0:
        print("    neither openclaw nor the dashboard API answered — no plan", file=sys.stderr)
        sys.exit(1)
    return json.loads(out.stdout).get("cronJobs", []), "dashboard API (enabled jobs only; disabled rows invisible)"

jobs, source = live_jobs()
by_name = {}
for j in jobs:
    by_name.setdefault(j.get("name"), []).append(j)
print(f"    live: {len(jobs)} jobs via {source}")

changes = 0
unchanged = 0

def run(argv, what):
    global changes
    changes += 1
    if DRY:
        print(f"    would: {what}")
        return
    r = subprocess.run(argv, capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        print(f"    FAILED: {what}\n      {r.stderr.strip() or r.stdout.strip()}", file=sys.stderr)
        sys.exit(1)
    print(f"    {what}")

def pick(name):
    """The row a spec entry manages: the enabled one if several share the name."""
    rows = by_name.get(name, [])
    enabled = [r for r in rows if r.get("enabled")]
    return (enabled or rows or [None])[0]

def delivery_flags(d):
    if d.get("mode") == "none":
        return ["--no-deliver"]
    return ["--announce", "--channel", d["channel"], "--to", d["to"]]

def payload_flags(p, live=None):
    """Flags for the payload fields that differ from `live` (all of them when live is None)."""
    flags, fields = [], []
    lp = (live or {}).get("payload") or {}
    same_kind = lp.get("kind") == p["kind"]
    if p["kind"] == "command":
        if not same_kind or lp.get("argv") != p["argv"]:
            flags += ["--command-argv", json.dumps(p["argv"])]; fields.append("argv")
    else:
        if not same_kind or lp.get("message") != p["message"]:
            flags += ["--message", p["message"]]; fields.append("message")
        if "model" in p and (not same_kind or lp.get("model") != p["model"]):
            flags += ["--model", p["model"]]; fields.append("model")
        if "thinking" in p and (not same_kind or lp.get("thinking") != p["thinking"]):
            flags += ["--thinking", p["thinking"]]; fields.append("thinking")
        if "lightContext" in p and (not same_kind or bool(lp.get("lightContext")) != p["lightContext"]):
            if p["lightContext"]:
                flags.append("--light-context")
            elif live is not None:
                flags.append("--no-light-context")
            fields.append("lightContext")
        if "toolsAllow" in p and (not same_kind or set(lp.get("toolsAllow") or []) != set(p["toolsAllow"])):
            flags += ["--tools", ",".join(p["toolsAllow"])]; fields.append("tools")
    if "timeoutSeconds" in p and (not same_kind or lp.get("timeoutSeconds") != p["timeoutSeconds"]):
        flags += ["--timeout-seconds", str(p["timeoutSeconds"])]; fields.append("timeout")
    return flags, fields

def summary(s):
    p = s["payload"]
    kind = p["kind"] if p["kind"] == "command" else f"agentTurn {p.get('model', 'default model')}"
    return f"agent {s['agentId']}, {s['schedule']['expr']} {s['schedule']['tz']}, {kind}, {s['delivery']['mode']}"

# ── 1. spec jobs: add or patch ──────────────────────────────────────────────
for name, s in spec.get("jobs", {}).items():
    live = pick(name)
    if "payload" not in s:                       # enabled-only entry
        if live is None:
            print(f"    skip: {name} not present (spec only sets enabled={s['enabled']})")
        elif bool(live.get("enabled")) == s["enabled"]:
            unchanged += 1
        else:
            flag = "--enable" if s["enabled"] else "--disable"
            run(["openclaw", "cron", "edit", live["id"], flag], f"edit {name} ({live['id']}): {flag}")
        continue

    if live is None:
        argv = ["openclaw", "cron", "add", name,
                "--agent", s["agentId"], "--cron", s["schedule"]["expr"], "--tz", s["schedule"]["tz"],
                "--session", s["sessionTarget"]]
        pf, _ = payload_flags(s["payload"])
        argv += pf + delivery_flags(s["delivery"])
        if not s["enabled"]:
            argv.append("--disabled")
        run(argv, f"add {name}: {summary(s)}")
        continue

    flags, fields = [], []
    if live.get("agentId") != s["agentId"]:
        flags += ["--agent", s["agentId"]]; fields.append("agent")
    sch = live.get("schedule") or {}
    if sch.get("expr") != s["schedule"]["expr"] or sch.get("tz") != s["schedule"]["tz"]:
        flags += ["--cron", s["schedule"]["expr"], "--tz", s["schedule"]["tz"]]; fields.append("schedule")
    if live.get("sessionTarget") != s["sessionTarget"]:
        flags += ["--session", s["sessionTarget"]]; fields.append("session")
    pf, pfields = payload_flags(s["payload"], live)
    flags += pf; fields += pfields
    d, ld = s["delivery"], live.get("delivery") or {}
    if d.get("mode") == "none":
        if ld.get("mode") not in (None, "none"):
            flags += delivery_flags(d); fields.append("delivery")
    elif (ld.get("mode"), ld.get("channel"), ld.get("to")) != (d["mode"], d["channel"], d["to"]):
        flags += delivery_flags(d); fields.append("delivery")
    if bool(live.get("enabled")) != s["enabled"]:
        flags.append("--enable" if s["enabled"] else "--disable"); fields.append("enabled")
    if not flags:
        unchanged += 1
        continue
    run(["openclaw", "cron", "edit", live["id"]] + flags, f"edit {name} ({live['id']}): {', '.join(fields)}")

# ── 2. schedule-only patches ────────────────────────────────────────────────
for p in spec.get("patch", []):
    live = pick(p["name"])
    if live is None:
        print(f"    skip: {p['name']} not present (patch)")
        continue
    sch = live.get("schedule") or {}
    if sch.get("expr") == p["schedule"]["expr"] and sch.get("tz") == p["schedule"]["tz"]:
        unchanged += 1
        continue
    run(["openclaw", "cron", "edit", live["id"], "--cron", p["schedule"]["expr"], "--tz", p["schedule"]["tz"]],
        f"edit {p['name']} ({live['id']}): schedule {sch.get('expr')!r} -> {p['schedule']['expr']!r} {p['schedule']['tz']}")

# ── 3. deletes ──────────────────────────────────────────────────────────────
only_disabled = set(spec.get("delete_only_disabled", []))
for name in spec.get("delete", []):
    for row in by_name.get(name, []):
        if name in only_disabled and row.get("enabled"):
            continue
        state = "enabled" if row.get("enabled") else "disabled"
        run(["openclaw", "cron", "rm", row["id"]], f"rm {name} ({row['id']}, {state})")

print(f"    {'planned' if DRY else 'applied'}: {changes} change(s)")
print(f"    unchanged: {unchanged}")
PY
