---
id: T05
parent: S02
milestone: M004
provides: []
requires: []
affects: []
key_files: ["web/src/routes/test-cases/[id]/+page.svelte"]
key_decisions: ["Detail page has 12-col grid with main content (8 cols) + sidebar (4 cols)", "Steps shown as table with # / action / expected / data columns", "Two-click delete: button becomes CONFIRM_DELETE + CANCEL", "Execution history section is a placeholder for S04"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "svelte-check: 0 errors. npm run web:build clean. npm test: 311/311."
completed_at: 2026-03-26T20:03:47.073Z
blocker_discovered: false
---

# T05: Test Case detail page — steps table, metadata sidebar, labels, edit/delete actions, execution history placeholder

> Test Case detail page — steps table, metadata sidebar, labels, edit/delete actions, execution history placeholder

## What Happened
---
id: T05
parent: S02
milestone: M004
key_files:
  - web/src/routes/test-cases/[id]/+page.svelte
key_decisions:
  - Detail page has 12-col grid with main content (8 cols) + sidebar (4 cols)
  - Steps shown as table with # / action / expected / data columns
  - Two-click delete: button becomes CONFIRM_DELETE + CANCEL
  - Execution history section is a placeholder for S04
duration: ""
verification_result: passed
completed_at: 2026-03-26T20:03:47.074Z
blocker_discovered: false
---

# T05: Test Case detail page — steps table, metadata sidebar, labels, edit/delete actions, execution history placeholder

**Test Case detail page — steps table, metadata sidebar, labels, edit/delete actions, execution history placeholder**

## What Happened

Created the test case detail page with title, priority/status/automation badges, edit/delete actions (two-click delete), description and preconditions sections, steps table, sidebar with metadata (flow file, dates) and labels, and execution history placeholder for S04. 12-col grid layout matching Kinetic Console patterns.

## Verification

svelte-check: 0 errors. npm run web:build clean. npm test: 311/311.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npx svelte-check --threshold error` | 0 | ✅ pass | 3700ms |
| 2 | `npm run web:build` | 0 | ✅ pass | 3800ms |
| 3 | `npm test` | 0 | ✅ pass — 311/311 tests | 8900ms |


## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `web/src/routes/test-cases/[id]/+page.svelte`


## Deviations
None.

## Known Issues
None.
