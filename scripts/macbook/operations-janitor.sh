#!/bin/bash
# Auto-commit + sync for ~/repos/operations on the MacBook.
#
# The mini has the same job on a 120s timer. This is its counterpart, and without
# it the sync is one-way: the mini pulls MacBook commits, but nothing on the
# MacBook ever pushed them. Since the MacBook is where meetings are recorded and
# most editing happens, that asymmetry meant work sat here indefinitely — the same
# silent divergence the rsync mirror used to cause, pointing the other way.
#
# Runs on a 5-minute timer rather than the mini's 2: writes here are often a human
# mid-edit, and a slightly longer window means fewer half-finished commits. The
# mini's writes come from crm.ts and agents, which are atomic, so it can afford to
# be quicker.
cd "$HOME/repos/operations" || exit 0
[ -d .git ] || exit 0

git add -A
if ! git diff --cached --quiet; then
  n=$(git diff --cached --name-only | wc -l | tr -d ' ')
  files=$(git diff --cached --name-only | head -3 | tr '\n' ' ')
  git commit -q -m "auto(macbook): $files($n file$([ "$n" = 1 ] || echo s))"
fi
git pull -q --rebase --autostash origin main
git push -q origin main
