#!/usr/bin/env bash
# scripts/check-generated.sh
# Phase 17 Plan 17-08 — CI drift detection for the contracts pipeline.
#
# Regenerates every committed machine-emitted artifact and exits non-zero
# if any file drifted from the committed version. Names each drifted file
# in the failure output so CI readers know exactly what to regenerate.
#
# Wired into package.json as:
#   "contracts:check": "bash scripts/check-generated.sh"
#
# Requires:
#   - Node 22.12+ (tsx, openapi-typescript)
#   - Go 1.21+ with go-jsonschema on PATH (for `make -C cli types`)
#   - DATABASE_URL env var pointing at a reachable Postgres (build-openapi.ts
#     boots Fastify — pg-boss auto-migrates on a test schema; NODE_ENV=contracts
#     skips device/emulator side-effects)

set -euo pipefail

# Generated files the script enforces drift against.
# Adding a new generated artifact: add its path here AND ensure a generator
# command upstream emits it before the diff loop runs.
FILES=(
  "server/openapi.json"
  "contracts/ws-messages.json"
  "cli/internal/types/generated.go"
  "web/src/lib/api/generated-types.ts"
)

echo "→ Step 1/3: Regenerating OpenAPI + WS JSON Schema..."
npm run openapi:generate

echo ""
echo "→ Step 2/3: Regenerating Go types..."
make -C cli types

echo ""
echo "→ Step 3/3: Regenerating web TS types..."
npm run web:types

echo ""
echo "→ Checking for drift against committed files..."
DRIFT=()
for f in "${FILES[@]}"; do
  if [ ! -e "$f" ]; then
    echo "  ✗ MISSING: $f (generator did not emit it)"
    DRIFT+=("$f")
    continue
  fi
  if ! git diff --quiet -- "$f"; then
    DRIFT+=("$f")
  fi
done

if [ ${#DRIFT[@]} -ne 0 ]; then
  echo ""
  echo "✗ Generated files drifted from committed versions:"
  for f in "${DRIFT[@]}"; do
    echo "    - $f"
  done
  echo ""
  echo "  Fix: regenerate locally with"
  echo "    npm run openapi:generate && make -C cli types && npm run web:types"
  echo "  then commit the regenerated files."
  echo ""
  echo "  Diff preview:"
  git --no-pager diff --stat -- "${DRIFT[@]}" || true
  exit 1
fi

echo ""
echo "✓ All generated files are up to date."
