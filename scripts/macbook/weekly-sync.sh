#!/bin/bash
# Weekly derived-truth pass (Mondays 09:00) — the two jobs that need the
# platform clone, which lives on this MacBook:
#   1. generate-registry — products/_registry.md from the platform's own
#      module manifests (canonical names, routes, measured readiness)
#   2. drift-check       — facts vs evidence across authored docs
# Registry first: a fresh registry makes name-drift visible to the checker's
# successors and keeps Monday's intel alert grounded in today's platform.
cd "$HOME/repos/command-center" || exit 0
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
node --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/generate-registry.ts
node --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/drift-check.ts
