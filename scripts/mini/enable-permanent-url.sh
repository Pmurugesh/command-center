#!/usr/bin/env bash
# Give the Command Center a permanent HTTPS URL on the tailnet.
#
# Turns  http://paladins-mac-mini:3000  (MagicDNS short name, plain HTTP,
# non-standard port, no cert) into:
#
#     https://paladins-mac-mini.tail722dc1.ts.net
#
# Stable forever, real certificate, no port number, works on every device
# signed into the tailnet including iPhone and iPad.
#
# Run ON the mini as `paladin`:  ./scripts/mini/enable-permanent-url.sh
#
# DELIBERATELY tailnet-only. See the funnel note at the bottom of this file
# before considering public exposure.
set -euo pipefail

PORT="${1:-3000}"
TS="$(command -v tailscale || echo /Applications/Tailscale.app/Contents/MacOS/Tailscale)"

if [ ! -x "$TS" ]; then
  echo "tailscale CLI not found. Install the Tailscale app first."
  exit 1
fi

echo "==> Checking tailnet connection"
if ! "$TS" status >/dev/null 2>&1; then
  echo "Tailscale is not running on this machine. Start it, then re-run."
  exit 1
fi
"$TS" status | head -3

echo
echo "==> Checking the dashboard is actually up on :$PORT"
if ! curl -sf -o /dev/null --max-time 5 "http://127.0.0.1:$PORT"; then
  echo "Nothing responding on http://127.0.0.1:$PORT"
  echo "Start the service first:  launchctl kickstart -k gui/\$(id -u)/com.paladin.commandcenter"
  exit 1
fi
echo "    dashboard responding"

echo
echo "==> Publishing to the tailnet over HTTPS"
# --bg keeps it running across restarts; the config is persisted by tailscaled,
# so this survives reboots without a launchd wrapper of its own.
"$TS" serve --bg "$PORT"

echo
echo "==> Current serve config"
"$TS" serve status || true

echo
URL="$("$TS" status --json 2>/dev/null | python3 -c 'import json,sys;d=json.load(sys.stdin);n=d["Self"]["DNSName"].rstrip(".");print("https://"+n)' 2>/dev/null || echo "https://<machine>.<tailnet>.ts.net")"
cat <<MSG

  Permanent URL:  $URL

  Bookmark it on every device. It does not change.

  If the browser shows a certificate error, HTTPS certs are not enabled for the
  tailnet yet. One-time toggle, then re-run this script:
      https://login.tailscale.com/admin/dns  ->  enable MagicDNS + HTTPS Certificates

  To undo:  tailscale serve --https=443 off

  ---------------------------------------------------------------------------
  DO NOT run 'tailscale funnel' on this service.

  Funnel publishes to the public internet. This dashboard has NO authentication
  (no middleware.ts, no login) and serves bid strategy, agency contact details,
  competitive intelligence, and pricing. On the tailnet, the tailnet IS the auth
  and that is why no login is needed. On the public internet, anyone with the
  URL has all of it.

  If the dashboard ever genuinely needs to be public, build auth FIRST.
  ---------------------------------------------------------------------------

MSG
