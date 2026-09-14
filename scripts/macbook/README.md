# MacBook-side machine scripts

Source of truth for the two launchd jobs that run on the MacBook. The live
copies run from `~/bin` (scripts) and `~/Library/LaunchAgents` (plists); this
directory exists so the machine's own plumbing is versioned like everything
else. If you edit a script here, re-install it — launchd runs the `~/bin`
copy, not this one.

| Job | Interval | What it does |
|---|---|---|
| `operations-janitor` | 5 min | Auto-commit `~/repos/operations`, pull --rebase, push. The MacBook half of the two-way git sync (the mini runs its counterpart every 2 min). |
| `mini-watchdog` | 30 min | Notices when the mini stops answering (dashboard URL down) and raises a macOS notification naming which failure it is: off the network (it restarted and is waiting at the FileVault password screen — someone has to go to it; see `scripts/mini/harden-restarts.sh`) or online but unreachable (toggle Tailscale here). The one health check that cannot live on the mini itself. |
| `mini-backup` | daily 3:30 | Pulls a snapshot of everything on the mini that lives outside git (OpenClaw config and sqlite stores, agent memory, credentials, staged mail and ledgers, launchd plists, `~/bin`, deploy keys) to `~/Backups/paladins-mac-mini/<date>/`, hard-linked against the previous day; keeps 14 days. Skips quietly when the mini is unreachable; a macOS notification on failure. Added 2026-09-14 after the audit found no backup of any of it. |
| `weekly-sync` | Mon 9:00 | The derived-truth pass (needs the platform clone, which lives here): regenerates `products/_registry.md` from the platform's module manifests, then runs drift-check (dead citations, orphan agency slugs, stale agent context → dated intel alert, re-announced only on change). Runs `scripts/macbook/weekly-sync.sh` from `~/repos/command-center` main. Replaced the drift-check-only job 2026-08-24. |

## Install / update

```bash
cp scripts/macbook/mini-watchdog.sh ~/bin/ && chmod +x ~/bin/mini-watchdog.sh
cp scripts/macbook/com.pavan.mini-watchdog.plist ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.pavan.mini-watchdog.plist 2>/dev/null
launchctl load ~/Library/LaunchAgents/com.pavan.mini-watchdog.plist
```

Same pattern for the janitor and for `mini-backup` with their two files.

## Restoring the mini from a backup

`~/Backups/paladins-mac-mini/latest/` holds three parts: `openclaw/` (drop into `~/.openclaw`; the consistent sqlite copies are under `backup-staging/`: `state.sqlite` is the cron store and `agents/<id>.sqlite` the auth profiles), `operations-private/repos/operations/` (`agents/*/memory`, `agents/main/.credentials`, `crm/intake/email` with both ledgers), and `home/` (`bin`, `.config/command-center`, `.ssh`, `.local/state`, `Library/LaunchAgents`). Two things are not in it and must be re-created: the Telegram bot token (BotFather) and the gateway token, both stored in the mini's Keychain under `openclaw-telegram-bot-token` and `openclaw-gateway-token`. The cron job definitions are also in git as `operations/agents/main/cron-jobs.json` (written by the heartbeat whenever they change).

## Disable

```bash
launchctl unload ~/Library/LaunchAgents/com.pavan.mini-watchdog.plist
```

State lives in `~/.local/state/mini-watchdog`; logs in `/tmp/mini-watchdog.log`
and `/tmp/operations-janitor.log`.
