# Remote Access

The dashboard is reachable from anywhere via Tailscale. Nothing is synced or
copied — the app runs on the Mac mini next to the data, and your other devices
connect to it over a private encrypted network.

## The link

- **http://paladins-mac-mini:3000** (MagicDNS name, works on any tailnet device)
- `http://100.113.239.46:3000` (tailnet IP, same thing)

Works from any device signed into the Tailscale account
(pavanmurugesh2002@gmail.com) — home, cellular, hotel wifi, anywhere.

## Add a new device (phone, laptop)

1. Install the Tailscale app (iOS / Android / Mac App Store).
2. Sign in with the same Google account.
3. Open http://paladins-mac-mini:3000. On a phone, use "Add to Home Screen"
   for an app-like icon.

## How it runs on the mini (current state)

- launchd LaunchAgent **`com.paladin.commandcenter`** (RunAtLoad + KeepAlive:
  starts at boot, restarts on crash) running `npx next start -H 0.0.0.0` from
  `/Users/paladin/repos/command-center`.
- Logs: `~/.openclaw/logs/command-center.log` and `command-center-error.log`.
- The mini never sleeps (`pmset sleep 0`). Optional hardening for power
  outages: `sudo pmset -a autorestart 1` (boots back up after power loss).
- Remote admin: the MacBook has key-based SSH (`ssh paladins-mac-mini`,
  configured in `~/.ssh/config` with user `paladin`).

## Deploying dashboard changes

From the MacBook (or directly on the mini):

```bash
ssh paladins-mac-mini 'zsh -lc "cd ~/repos/command-center && git pull && ./scripts/mini/install-dashboard-service.sh"'
```

The script rebuilds the production bundle, rewrites the service plist, and
restarts the service (a few seconds of downtime after a ~2 min build). It is
idempotent — safe to re-run any time.

## Keep the link alive

- **Tailscale admin console → Machines → paladins-mac-mini → Disable key
  expiry** (https://login.tailscale.com/admin/machines). Otherwise the node
  key expires (currently ~Sept 2026) and the link dies until someone
  re-authenticates on the mini.

## Optional: HTTPS

On the mini: `tailscale serve --bg 3000` publishes the dashboard at
`https://paladins-mac-mini.tail722dc1.ts.net` with a real certificate —
still private to the tailnet. Useful if a browser nags about http.

## Why not Vercel + Supabase?

This dashboard is not just file rendering: it shells out to `openclaw` for
live system status, triggers cron runs (`/api/system/cron/[id]/run`), and
writes bid status back into the markdown files. A cloud deployment would need
a file-sync agent on the mini, a command queue for the actions, write-back
conflict handling, and auth on a public URL — and the data would always be
minutes stale while the mini still has to stay online. The tunnel keeps one
source of truth with everything live, for $0.

Supabase would earn its place later for things the filesystem can't do:
historical snapshots/trends (e.g. bid coverage over time) or read-only access
while the mini is down. It is not needed for remote access.
