---
id: T01
parent: S03
milestone: M004
provides: []
requires: []
affects: []
key_files: ["server/api/test-suite-routes.ts", "server/api/plugin.ts"]
key_decisions: ["Suite case list replaced atomically (delete all + insert with sortOrder from array index)", "Detail endpoint enriches cases with labels in batch"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "tsc clean. 311/311 tests pass."
completed_at: 2026-03-26T20:17:26.611Z
blocker_discovered: false
---

# T01: Test Suites API — 5 routes with ordered cases, batch enrichment, case count

> Test Suites API — 5 routes with ordered cases, batch enrichment, case count

## What Happened
---
id: T01
parent: S03
milestone: M004
key_files:
  - server/api/test-suite-routes.ts
  - server/api/plugin.ts
key_decisions:
  - Suite case list replaced atomically (delete all + insert with sortOrder from array index)
  - Detail endpoint enriches cases with labels in batch
duration: ""
verification_result: passed
completed_at: 2026-03-26T20:17:26.612Z
blocker_discovered: false
---

# T01: Test Suites API — 5 routes with ordered cases, batch enrichment, case count

**Test Suites API — 5 routes with ordered cases, batch enrichment, case count**

## What Happened

Created test-suite-routes.ts with 5 endpoints: list (with batch case counts), create (with ordered caseIds), detail (ordered cases with labels), update (replace case list), delete. Registered in plugin.ts.

## Verification

tsc clean. 311/311 tests pass.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npx tsc --noEmit` | 0 | ✅ pass | 3500ms |
| 2 | `npm test` | 0 | ✅ pass — 311/311 | 8400ms |


## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `server/api/test-suite-routes.ts`
- `server/api/plugin.ts`


## Deviations
None.

## Known Issues
None.
