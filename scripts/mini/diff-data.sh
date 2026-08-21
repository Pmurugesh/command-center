#!/usr/bin/env bash
# Compare the MacBook's operations mirror against the mini (source of truth).
#
# READ-ONLY. Changes nothing on either machine. Run it before adding --delete
# to the rsync, and before Phase 5 write-back lands.
#
# Run from the MacBook:  ./scripts/mini/diff-data.sh
#
# Needs SSH to the mini. If it fails with "agent has no identities", load the
# key first:   ssh-add --apple-use-keychain ~/.ssh/id_ed25519
# Works over Tailscale (paladins-mac-mini) or the LAN (paladins-mac-mini.local).
set -uo pipefail

LOCAL_DIR="$HOME/repos/operations"
REMOTE_DIR="repos/operations"

# Prefer the tailnet name; fall back to mDNS on the LAN with the host key
# pinned to the already-trusted tailnet entry (so this is not blind TOFU).
if ssh -o ConnectTimeout=5 -o BatchMode=yes paladins-mac-mini true 2>/dev/null; then
  SSH=(ssh paladins-mac-mini)
  echo "==> Reaching the mini over Tailscale"
elif ssh -o ConnectTimeout=5 -o BatchMode=yes -o HostKeyAlias=paladins-mac-mini \
        paladin@paladins-mac-mini.local true 2>/dev/null; then
  SSH=(ssh -o HostKeyAlias=paladins-mac-mini paladin@paladins-mac-mini.local)
  echo "==> Reaching the mini over the LAN (host key verified against the tailnet entry)"
else
  echo "Cannot reach the mini."
  echo "  - Tailscale running?   tailscale status"
  echo "  - SSH key loaded?      ssh-add --apple-use-keychain ~/.ssh/id_ed25519"
  exit 1
fi

echo
echo "=============================================================="
echo " 1. Files that exist ONLY on the MacBook"
echo "    (rsync has no --delete, so these are never cleaned up and"
echo "     never pushed up - they look like real data but aren't)"
echo "=============================================================="
"${SSH[@]}" "cd $REMOTE_DIR 2>/dev/null && find . -type f | sort" 2>/dev/null > /tmp/_mini_files.txt
( cd "$LOCAL_DIR" && find . -type f | sort ) > /tmp/_mac_files.txt
comm -13 /tmp/_mini_files.txt /tmp/_mac_files.txt | grep -v "^\./\.git/" | head -50
echo "  (count: $(comm -13 /tmp/_mini_files.txt /tmp/_mac_files.txt | grep -vc '^\./\.git/'))"

echo
echo "=============================================================="
echo " 2. Files that exist ONLY on the mini"
echo "    (a stale mirror - re-run the rsync to pull these down)"
echo "=============================================================="
comm -23 /tmp/_mini_files.txt /tmp/_mac_files.txt | grep -v "^\./\.git/" | head -50
echo "  (count: $(comm -23 /tmp/_mini_files.txt /tmp/_mac_files.txt | grep -vc '^\./\.git/'))"

echo
echo "=============================================================="
echo " 3. Every bid .status.json, both machines, side by side"
echo "    (the known divergence - decide which wins per bid)"
echo "=============================================================="
for bid in $(cd "$LOCAL_DIR/bids" && ls -d */ 2>/dev/null | tr -d '/'); do
  loc="$LOCAL_DIR/bids/$bid/.status.json"
  echo "--- $bid"
  if [ -f "$loc" ]; then
    echo "    macbook: $(tr -d '\n ' < "$loc")"
  else
    echo "    macbook: (none)"
  fi
  rem="$("${SSH[@]}" "cat $REMOTE_DIR/bids/$bid/.status.json 2>/dev/null | tr -d '\n '" 2>/dev/null)"
  echo "    mini   : ${rem:-(none)}"
done

echo
echo "=============================================================="
echo " 4. Structured status vs narrative status (same machine)"
echo "    A .status.json and a README that disagree is a bug that"
echo "    rsync cannot cause and re-syncing cannot fix."
echo "=============================================================="
for bid in $(cd "$LOCAL_DIR/bids" && ls -d */ 2>/dev/null | tr -d '/'); do
  [ "$bid" = "_templates" ] && continue
  st="$LOCAL_DIR/bids/$bid/.status.json"
  rd="$LOCAL_DIR/bids/$bid/README.md"
  [ -f "$st" ] || continue
  echo "--- $bid"
  echo "    .status.json : $(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("status","?"))' "$st" 2>/dev/null)"
  [ -f "$rd" ] && echo "    README       : $(grep -i "Current Stage" "$rd" 2>/dev/null | head -1 | sed 's/^[[:space:]]*//')"
done

echo
echo "Nothing was modified. Reconcile by hand, THEN make the mirror read-only."
