#!/bin/bash
# Mini watchdog — the one health check that cannot live on the mini.
#
# The dashboard's health panel reports on every organ except the failure mode
# where the dashboard itself is unreachable. That happened 2026-08-23/24: the
# mini slept, its Tailscale went quiet, and nothing said so until a person
# happened to try the URL. This runs MacBook-side every 30 minutes and raises a
# macOS notification when the mini stops answering, again every 6 hours while
# it stays down, and once when it comes back.
#
# Two signals, because they separate "asleep or unplugged" from "Tailscale wedged":
#   - dashboard URL answering        -> can Pavan look at it right now
#   - last mini-authored commit age  -> is the machine doing its job at all
#     (the janitor pulls origin every 5 minutes, so the local clone already
#     carries whatever the mini last pushed; no extra fetch needed)

URL="https://paladins-mac-mini.tail722dc1.ts.net"
OPS="$HOME/repos/operations"
STATE="$HOME/.local/state/mini-watchdog"
REALERT_SECS=21600 # 6h

mkdir -p "$(dirname "$STATE")"

# If the MacBook itself is offline, everything is unreachable and alerting is noise.
curl -s -o /dev/null --max-time 10 https://github.com || exit 0

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$URL/")
if [ "$code" = "200" ]; then now_state=up; else now_state=down; fi

last_mini=$(git -C "$OPS" log --author='Paladin (mac mini)' -1 --format=%ct 2>/dev/null)
age_h=$(( ($(date +%s) - ${last_mini:-0}) / 3600 ))

prev_state=$(sed -n 1p "$STATE" 2>/dev/null); prev_state=${prev_state:-up}
last_alert=$(sed -n 2p "$STATE" 2>/dev/null); last_alert=${last_alert:-0}

notify() {
  osascript -e "display notification \"$1\" with title \"Mini watchdog\"" 2>/dev/null
  echo "$(date '+%Y-%m-%d %H:%M') $1"
}

now=$(date +%s)
if [ "$now_state" = down ]; then
  if [ "$prev_state" = up ] || [ $((now - last_alert)) -ge "$REALERT_SECS" ]; then
    # The 3am product-health scan commits daily, so a commit in the last ~26h
    # means the machine wakes and works — the network path is what is broken.
    if [ "$age_h" -lt 26 ]; then
      notify "Dashboard unreachable, but the mini committed ${age_h}h ago — asleep or Tailscale wedged. At the mini: toggle Tailscale, then: sudo pmset -a sleep 0 autorestart 1"
    else
      notify "Dashboard unreachable AND no mini commit for ${age_h}h — the mini may be fully down."
    fi
    last_alert=$now
  fi
elif [ "$prev_state" = down ]; then
  notify "Mini is back — dashboard answering again."
fi

printf '%s\n%s\n' "$now_state" "$last_alert" > "$STATE"
