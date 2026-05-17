---
id: T03
parent: S03
milestone: M004
provides: []
requires: []
affects: []
key_files: ["web/src/routes/test-suites/+page.svelte", "web/src/routes/test-suites/[id]/+page.svelte"]
key_decisions: ["Reorder via arrow up/down buttons that call PUT with new caseIds order (no drag-and-drop library needed)", "Add cases panel loads active cases not already in suite, inline add with immediate save", "Inline create form on list page instead of separate /new route (suites are simpler than test cases)"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "svelte-check 0 errors. Web build clean. 311/311 tests pass."
completed_at: 2026-03-26T20:19:50.567Z
blocker_discovered: false
---

# T03: Test Suites UI — list page with inline create + detail page with reorder/add/remove cases

> Test Suites UI — list page with inline create + detail page with reorder/add/remove cases

## What Happened
---
id: T03
parent: S03
milestone: M004
key_files:
  - web/src/routes/test-suites/+page.svelte
  - web/src/routes/test-suites/[id]/+page.svelte
key_decisions:
  - Reorder via arrow up/down buttons that call PUT with new caseIds order (no drag-and-drop library needed)
  - Add cases panel loads active cases not already in suite, inline add with immediate save
  - Inline create form on list page instead of separate /new route (suites are simpler than test cases)
duration: ""
verification_result: passed
completed_at: 2026-03-26T20:19:50.567Z
blocker_discovered: false
---

# T03: Test Suites UI — list page with inline create + detail page with reorder/add/remove cases

**Test Suites UI — list page with inline create + detail page with reorder/add/remove cases**

## What Happened

Created list page (suite cards with name/desc/case count, inline create form) and detail page (ordered case list with move up/down, add cases panel that filters out already-in-suite cases, remove case, delete suite with two-click confirm). Each reorder/add/remove immediately saves via PUT and refreshes.

## Verification

svelte-check 0 errors. Web build clean. 311/311 tests pass.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npx svelte-check --threshold error` | 0 | ✅ pass | 4000ms |
| 2 | `npm run web:build` | 0 | ✅ pass | 3800ms |
| 3 | `npm test` | 0 | ✅ pass — 311/311 | 8400ms |


## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `web/src/routes/test-suites/+page.svelte`
- `web/src/routes/test-suites/[id]/+page.svelte`


## Deviations
None.

## Known Issues
None.
