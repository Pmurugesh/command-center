#!/bin/bash
# Mini watchdog — the one health check that cannot live on the mini.
#
# The dashboard's health panel reports on every organ except the failure mode
# where the dashboard itself is unreachable. This runs MacBook-side every 30
# minutes and raises a macOS notification when the mini stops answering, again
# every 6 hours while it stays down, and once when it comes back.
#
# The notification has to say WHICH failure it is, because the fixes are opposite:
#
#   - Tailscale can't see the mini at all -> the machine is off the network. Since
#     June that has always meant it restarted (power blip or a self-installed macOS
#     update) and FileVault is holding it at the password screen, where nothing runs.
#     Only a person at the machine fixes it. (2026-09-10: this watchdog said "toggle
#     Tailscale" for twelve hours while the mini sat at that screen.)
#   - Tailscale sees the mini but the dashboard doesn't answer -> the path is wedged
#     or the dashboard service stopped. Toggling Tailscale on this MacBook is the
#     proven cure for the first.
#
# Last mini-authored commit age rides along as context: the janitor pulls origin
# every 5 minutes, so the local clone already carries whatever the mini last pushed.

URL="${MINI_URL:-https://paladins-mac-mini.tail722dc1.ts.net}"
TS="${TAILSCALE_BIN:-/Applications/Tailscale.app/Contents/MacOS/Tailscale}"
OPS="$HOME/repos/operations"
STATE="$HOME/.local/state/mini-watchdog"
REALERT_SECS=21600 # 6h

mkdir -p "$(dirname "$STATE")"

# If the MacBook itself is offline, everything is unreachable and alerting is noise.
curl -s -o /dev/null --max-time 10 https://github.com || exit 0

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$URL/")
if [ "$code" = "200" ]; then now_state=up; else now_state=down; fi

# The coordinator's view of the mini: online | offline | unknown (CLI missing,
# this MacBook's own Tailscale stopped, or the peer not listed).
peer=$("$TS" status --json 2>/dev/null | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    print("unknown"); raise SystemExit
for p in (d.get("Peer") or {}).values():
    if (p.get("DNSName") or "").startswith("paladins-mac-mini."):
        print("online" if p.get("Online") else "offline"); break
else:
    print("unknown")
' 2>/dev/null)
peer=${peer:-unknown}

last_mini=$(git -C "$OPS" log --author='Paladin (mac mini)' -1 --format=%ct 2>/dev/null)
age_h=$(( ($(date +%s) - ${last_mini:-0}) / 3600 ))

prev_state=$(sed -n 1p "$STATE" 2>/dev/null); prev_state=${prev_state:-up}
last_alert=$(sed -n 2p "$STATE" 2>/dev/null); last_alert=${last_alert:-0}

notify() {
  osascript -e "display notification \"$1\" with title \"Mini watchdog\"" 2>/dev/null
  echo "$(date '+%Y-%m-%d %H:%M') [$peer] $1"
}

now=$(date +%s)
if [ "$now_state" = down ]; then
  if [ "$prev_state" = up ] || [ $((now - last_alert)) -ge "$REALERT_SECS" ]; then
    case "$peer" in
      offline)
        notify "Mini is off the network (last commit ${age_h}h ago). It has most likely restarted and is waiting at the FileVault password screen, or lost power. Someone has to go to it: power it on if the light is off, type the password if it is at the unlock screen." ;;
      online)
        notify "Mini is online but the dashboard is not answering (last commit ${age_h}h ago). On this MacBook: Tailscale down, then up. If that does not clear it, the dashboard service on the mini has stopped." ;;
      *)
        if [ "$age_h" -lt 26 ]; then
          notify "Dashboard unreachable; the mini committed ${age_h}h ago, so it was working recently. Check Tailscale on this MacBook, then whether the mini restarted."
        else
          notify "Dashboard unreachable AND no mini commit for ${age_h}h — the mini is probably down or at the FileVault password screen."
        fi ;;
    esac
    last_alert=$now
  fi
elif [ "$prev_state" = down ]; then
  notify "Mini is back — dashboard answering again."
fi

printf '%s\n%s\n' "$now_state" "$last_alert" > "$STATE"
