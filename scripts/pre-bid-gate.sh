#!/usr/bin/env bash
# THE PRE-BID GATE — must pass before anything ships to a customer.
#
# Verifies that every code citation in bid-facing documents
# (_platform-knowledge.md, _response-library/, bids/*/response*) still resolves
# against the platform's origin/main. Exists because this failure happened
# twice: capability claims survived in bid docs for months after the code was
# deleted, and once a "fix" made citations resolve while the claims stayed
# false. The gate can't judge prose truth — that's the triage discipline — but
# it makes evidence-free claims impossible to ship silently.
#
# Usage: ./scripts/pre-bid-gate.sh        (from the command-center repo root)
# Exit 0 = cleared to submit. Exit 1 = STOP — fix the listed citations first.
# A response that deliberately sketches PROPOSED architecture may opt out by
# placing <!-- claims: proposed --> near the top of that file.
set -uo pipefail
cd "$(dirname "$0")/.."

echo "── PRE-BID GATE ──────────────────────────────────────────"
if node --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/verify-claims.ts --gate; then
  echo "── GATE: PASS — bid-facing claims all cite live evidence ──"
  exit 0
else
  echo "── GATE: FAIL — a bid-facing document cites evidence that no longer exists ──"
  echo "Do NOT submit. Triage each dead citation: is it a renamed path (re-cite)"
  echo "or a removed capability (the CLAIM must be reworded — see tasks/lessons.md,"
  echo "2026-08-24: a citation fix must re-verify the claim, not just the path)."
  exit 1
fi
