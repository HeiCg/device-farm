---
id: T03
parent: S02
milestone: M004
provides: []
requires: []
affects: []
key_files: ["web/src/routes/test-cases/+page.svelte"]
key_decisions: ["D016-compliant static Record lookups for all badge styles (priority, status, automation)", "Debounced search (300ms)", "Card layout with inline badges, label pills, step count, and date"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "svelte-check: 0 errors. npm run web:build clean."
completed_at: 2026-03-26T20:00:29.406Z
blocker_discovered: false
---

# T03: Test Cases list page — search, 4 filter dropdowns, card grid with badges/labels/pagination

> Test Cases list page — search, 4 filter dropdowns, card grid with badges/labels/pagination

## What Happened
---
id: T03
parent: S02
milestone: M004
key_files:
  - web/src/routes/test-cases/+page.svelte
key_decisions:
  - D016-compliant static Record lookups for all badge styles (priority, status, automation)
  - Debounced search (300ms)
  - Card layout with inline badges, label pills, step count, and date
duration: ""
verification_result: passed
completed_at: 2026-03-26T20:00:29.406Z
blocker_discovered: false
---

# T03: Test Cases list page — search, 4 filter dropdowns, card grid with badges/labels/pagination

**Test Cases list page — search, 4 filter dropdowns, card grid with badges/labels/pagination**

## What Happened

Created the test cases list page with search (debounced), 4 filter dropdowns (status, priority, automation, label), responsive card grid, cursor pagination, and loading/empty states. Each card shows title, priority/status/automation badges, label pills, step count, and creation date. All using D016-compliant static Tailwind class lookups.

## Verification

svelte-check: 0 errors. npm run web:build clean.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npx svelte-check --threshold error` | 0 | ✅ pass | 3700ms |
| 2 | `npm run web:build` | 0 | ✅ pass | 3900ms |


## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `web/src/routes/test-cases/+page.svelte`


## Deviations
None.

## Known Issues
None.
