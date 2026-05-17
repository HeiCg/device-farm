---
id: T02
parent: S02
milestone: M004
provides: []
requires: []
affects: []
key_files: ["web/src/lib/api/test-cases.ts"]
key_decisions: ["Separate interfaces for list item (TestCaseListItem with stepCount) vs detail (TestCaseDetail with full steps)"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "npm run web:build clean."
completed_at: 2026-03-26T19:59:07.868Z
blocker_discovered: false
---

# T02: Test Cases API client — 6 typed functions with list/detail/create/update/delete/steps interfaces

> Test Cases API client — 6 typed functions with list/detail/create/update/delete/steps interfaces

## What Happened
---
id: T02
parent: S02
milestone: M004
key_files:
  - web/src/lib/api/test-cases.ts
key_decisions:
  - Separate interfaces for list item (TestCaseListItem with stepCount) vs detail (TestCaseDetail with full steps)
duration: ""
verification_result: passed
completed_at: 2026-03-26T19:59:07.868Z
blocker_discovered: false
---

# T02: Test Cases API client — 6 typed functions with list/detail/create/update/delete/steps interfaces

**Test Cases API client — 6 typed functions with list/detail/create/update/delete/steps interfaces**

## What Happened

Created typed API client with 6 functions matching all server routes. Separate interfaces for list items (with stepCount) and detail (with full steps array). Filter params typed. Web build passes.

## Verification

npm run web:build clean.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npm run web:build` | 0 | ✅ pass | 3800ms |


## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `web/src/lib/api/test-cases.ts`


## Deviations
None.

## Known Issues
None.
