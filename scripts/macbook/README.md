# MacBook-side machine scripts

Source of truth for the two launchd jobs that run on the MacBook. The live
copies run from `~/bin` (scripts) and `~/Library/LaunchAgents` (plists); this
directory exists so the machine's own plumbing is versioned like everything
else. If you edit a script here, re-install it — launchd runs the `~/bin`
copy, not this one.

| Job | Interval | What it does |
|---|---|---|
| `operations-janitor` | 5 min | Auto-commit `~/repos/operations`, pull --rebase, push. The MacBook half of the two-way git sync (the mini runs its counterpart every 2 min). |
| `mini-watchdog` | 30 min | Notices when the mini stops answering (dashboard URL down) and raises a macOS notification — the one health check that cannot live on the mini itself. |
| `drift-check` | Mon 9:00 | Facts vs evidence: dead citations in authored docs, agency slugs with no profile, stale agent context. Runs here because the platform clone lives here. Findings land as a dated intel alert, re-announced only when they change. Runs `scripts/drift-check.ts` from `~/repos/command-center` main — no `~/bin` copy. |

## Install / update

```bash
cp scripts/macbook/mini-watchdog.sh ~/bin/ && chmod +x ~/bin/mini-watchdog.sh
cp scripts/macbook/com.pavan.mini-watchdog.plist ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.pavan.mini-watchdog.plist 2>/dev/null
launchctl load ~/Library/LaunchAgents/com.pavan.mini-watchdog.plist
```

Same pattern for the janitor with its two files.

## Disable

```bash
launchctl unload ~/Library/LaunchAgents/com.pavan.mini-watchdog.plist
```

State lives in `~/.local/state/mini-watchdog`; logs in `/tmp/mini-watchdog.log`
and `/tmp/operations-janitor.log`.
