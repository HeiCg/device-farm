---
id: T01
parent: S02
milestone: M004
provides: []
requires: []
affects: []
key_files: ["server/api/test-case-routes.ts", "server/api/plugin.ts"]
key_decisions: ["Local cursor encode/decode instead of importing from pagination.ts (which is tied to jobs table)", "List endpoint enriches with labels and step counts in batch (2 extra queries, not N+1)", "Soft-delete via status=deprecated instead of hard delete", "Steps replaced atomically (delete all + insert new) instead of individual upserts"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "npx tsc --noEmit clean. npm test — 311/311 pass."
completed_at: 2026-03-26T19:58:30.987Z
blocker_discovered: false
---

# T01: Test Cases API — 6 routes with cursor pagination, multi-filter, batch enrichment, step/label management

> Test Cases API — 6 routes with cursor pagination, multi-filter, batch enrichment, step/label management

## What Happened
---
id: T01
parent: S02
milestone: M004
key_files:
  - server/api/test-case-routes.ts
  - server/api/plugin.ts
key_decisions:
  - Local cursor encode/decode instead of importing from pagination.ts (which is tied to jobs table)
  - List endpoint enriches with labels and step counts in batch (2 extra queries, not N+1)
  - Soft-delete via status=deprecated instead of hard delete
  - Steps replaced atomically (delete all + insert new) instead of individual upserts
duration: ""
verification_result: passed
completed_at: 2026-03-26T19:58:30.987Z
blocker_discovered: false
---

# T01: Test Cases API — 6 routes with cursor pagination, multi-filter, batch enrichment, step/label management

**Test Cases API — 6 routes with cursor pagination, multi-filter, batch enrichment, step/label management**

## What Happened

Created test-case-routes.ts with 6 endpoints: GET list (cursor pagination + 5 filters + batch label/step enrichment), POST create (inline steps + labels), GET detail, PUT update (partial fields + step replace + label replace), DELETE soft-delete, PUT steps bulk replace. All follow RFC 7807 error pattern with Zod validation. Registered in api/plugin.ts.

## Verification

npx tsc --noEmit clean. npm test — 311/311 pass.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npx tsc --noEmit` | 0 | ✅ pass | 3700ms |
| 2 | `npm test` | 0 | ✅ pass — 311/311 tests | 8900ms |


## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `server/api/test-case-routes.ts`
- `server/api/plugin.ts`


## Deviations
None.

## Known Issues
None.
