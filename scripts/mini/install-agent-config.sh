#!/usr/bin/env bash
# Three OpenClaw config settings the 2026-09-14 agent audits called for, applied
# by merge so nobody edits openclaw.json by hand:
#
#   1. anthropic/claude-opus-4-7 gets cacheRetention: long. Paladin's Telegram
#      session carries a 4-7 override, and without the 1h retention that the
#      4-6 and sonnet entries already have, ~75% of its cost was 5-minute
#      cache re-writes ($32 of $52 in 30 days).
#   2. main is denied the cron and session tools. In 30 days it created its
#      own crons (a 3-minute poller), spawned sessions, and edited jobs by
#      proxy; RED-LINES 10 forbids it and the tool list now enforces it.
#      exec stays (the API is called with curl).
#   3. memory-core is disabled. Its index is dead (provider openai, no key,
#      0 files indexed, "vector search paused") and every memory_search
#      returned an error.
#
# Idempotent: no change means no write and no restart. A change is validated
# with `openclaw config validate`; on failure the backup is restored and the
# installer exits 1 so post-deploy reports it. A valid change restarts the
# gateway once (a running agent turn is cut; the cron re-runs it).
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

CFG="$HOME/.openclaw/openclaw.json"
[ -f "$CFG" ] || { echo "    $CFG not found; skipped"; exit 0; }

changed=$(python3 - "$CFG" <<'PY'
import json, sys, copy
p = sys.argv[1]
cfg = json.load(open(p))
before = copy.deepcopy(cfg)

models = cfg.setdefault('agents', {}).setdefault('defaults', {}).setdefault('models', {})
entry = models.setdefault('anthropic/claude-opus-4-7', {})
entry.setdefault('params', {})['cacheRetention'] = 'long'

for a in cfg['agents'].setdefault('list', []):
    if a.get('id') == 'main':
        tools = a.setdefault('tools', {})
        deny = set(tools.get('deny') or [])
        deny |= {'cron', 'sessions_spawn', 'sessions_send', 'sessions_yield'}
        tools['deny'] = sorted(deny)

cfg.setdefault('plugins', {}).setdefault('entries', {}).setdefault('memory-core', {})['enabled'] = False

if cfg == before:
    print('no')
else:
    import time
    bak = f"{p}.bak-agent-config-{int(time.time())}"
    open(bak, 'w').write(json.dumps(before, indent=2) + '\n')
    open(p, 'w').write(json.dumps(cfg, indent=2) + '\n')
    print(bak)
PY
)

if [ "$changed" = "no" ]; then
  echo "    agent config already applied (4-7 cache, main tool deny, memory-core off)"
  exit 0
fi

if ! openclaw config validate >/dev/null 2>&1; then
  cp "$changed" "$CFG"
  echo "    openclaw config validate REJECTED the change; restored $changed"
  exit 1
fi
echo "    openclaw.json updated (backup: $changed); restarting the gateway"
openclaw gateway restart >/dev/null 2>&1 || launchctl kickstart -k "gui/$(id -u)/ai.openclaw.gateway"
sleep 8
if curl -s -m 10 -o /dev/null -w '%{http_code}' http://127.0.0.1:18789/ | grep -qE '^(200|401|403|404)$'; then
  echo "    gateway back up"
else
  echo "    WARNING: gateway not answering on :18789 after restart"
  exit 1
fi
