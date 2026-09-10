#!/usr/bin/env bash
# Stop a restart from turning into an outage. Run on the mini, as paladin, with sudo:
#
#   sudo bash ~/repos/command-center/scripts/mini/harden-restarts.sh                 # default
#   sudo bash ~/repos/command-center/scripts/mini/harden-restarts.sh --no-filevault  # restarts need nobody
#
# Why (evidence gathered 2026-09-10 from `last`, softwareupdate history, pmset and
# DiagnosticReports on the mini): it has gone dark five times since June —
# Jun 21 (8 days), Jul 23 (29 days), Aug 27 (9h), Sep 7 (25h), Sep 10 (12h).
# Every one had the same shape. The machine restarted, and FileVault held it at the
# password screen — before the network, before Tailscale, before a single LaunchAgent
# — until a person typed the password. Nothing on the mini can report that, because
# nothing on the mini is running yet.
#
# What restarted it: four of the five left no panic or reset report and no UPS is
# attached, so they were most likely power interruptions. The fifth was macOS
# installing Tahoe 26.6.2 by itself at 01:38 on Sep 10, whose shutdown stalled
# (shutdown_stall_2026-09-10-013842). Two earlier update restarts (Jun 11, Jul 14)
# came back in two minutes, because macOS carries the unlock through a CLEAN update
# restart — that is luck, not a design.
#
# Default: stops macOS installing updates (and restarting) on its own schedule, and
# re-asserts autorestart after power loss. Security data files (XProtect etc.) keep
# installing automatically. This removes one trigger; it does not make a power cut
# survivable while FileVault is on.
#
# --no-filevault: turns FileVault off and logs paladin in automatically at startup,
# so ANY restart — power, crash, update — is back online in about two minutes with
# nobody present. Tailscale (standalone app) and every com.paladin.* LaunchAgent
# start at login, so login is the only thing that was ever missing. The cost is
# physical: anyone who takes the machine, or plugs a keyboard and screen into it,
# gets a logged-in session with the CRM, the mail archive and the API credentials.
#
# Needs a human (sudo, and the account password for --no-filevault), so this is a
# manual script, not a post-deploy installer. Idempotent.
set -euo pipefail

[ "$(uname -s)" = "Darwin" ] || { echo "macOS only"; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "run with sudo: sudo bash $0 $*"; exit 1; }
USER_NAME="${SUDO_USER:-paladin}"

NO_FILEVAULT=no
for arg in "$@"; do
  case "$arg" in
    --no-filevault) NO_FILEVAULT=yes ;;
    *) echo "unknown option: $arg"; exit 1 ;;
  esac
done

SU=/Library/Preferences/com.apple.SoftwareUpdate

echo "==> macOS updates: download automatically, install only when you choose"
defaults write "$SU" AutomaticallyInstallMacOSUpdates -bool false
echo "    AutomaticallyInstallMacOSUpdates = $(defaults read "$SU" AutomaticallyInstallMacOSUpdates)"
echo "    (security data files still install on their own: CriticalUpdateInstall = $(defaults read "$SU" CriticalUpdateInstall 2>/dev/null || echo unset))"

echo "==> power: never sleep, start again by itself after a power cut"
pmset -a sleep 0 autorestart 1
pmset -g | grep -E ' (sleep|autorestart) ' | sed 's/^/   /' || true

if [ "$NO_FILEVAULT" = yes ]; then
  echo
  echo "This turns OFF disk encryption and logs $USER_NAME in automatically at every startup."
  echo "Anyone with physical access to the mini gets a logged-in session."
  printf 'Type YES to continue: '
  read -r answer </dev/tty
  [ "$answer" = "YES" ] || { echo "stopped — nothing about FileVault changed"; exit 1; }

  if fdesetup status | grep "FileVault is On" >/dev/null; then
    echo "==> FileVault: turning off (asks for a user name and password; decrypts in the background)"
    fdesetup disable   # no -user flag on 26.x: `man fdesetup` gives only `disable [-verbose]`
  fi
  echo "    $(fdesetup status | head -1)"

  echo "==> automatic login as $USER_NAME (asks for the password again)"
  if sysadminctl -autologin set -userName "$USER_NAME" -password - ; then
    :
  else
    echo "    not accepted yet — macOS refuses automatic login until FileVault has finished"
    echo "    turning off. When 'fdesetup status' says 'FileVault is Off.', run:"
    echo "      sudo sysadminctl -autologin set -userName $USER_NAME -password -"
  fi
fi

echo
echo "==> result"
echo "    $(fdesetup status | head -1)"
echo "    automatic login: $(defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null || echo off)"
echo "    macOS auto-install: $(defaults read "$SU" AutomaticallyInstallMacOSUpdates | sed 's/0/off/;s/1/on/')"
if pmset -g ps | grep -i 'ups' >/dev/null; then
  echo "    UPS: attached"
else
  echo "    UPS: none — a small USB UPS rides through the short power blips that most likely"
  echo "         caused four of the five outages"
fi
if [ "$NO_FILEVAULT" = no ]; then
  echo
  echo "FileVault is still on, so a power cut still needs someone at the machine to type"
  echo "the password. Install macOS updates when someone can get to the mini within the"
  echo "hour: System Settings > General > Software Update."
fi
