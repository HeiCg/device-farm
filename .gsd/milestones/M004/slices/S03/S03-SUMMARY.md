---
id: S03
parent: M004
milestone: M004
provides:
  - Suite CRUD API for S04 (create execution from suite)
  - Suite detail page for S06 (nav link)
requires:
  - slice: S01
    provides: test_suites + test_suite_cases tables
  - slice: S02
    provides: Test case CRUD API + types
affects:
  - S04
  - S06
key_files:
  - server/api/test-suite-routes.ts
  - web/src/lib/api/test-suites.ts
  - web/src/routes/test-suites/+page.svelte
  - web/src/routes/test-suites/[id]/+page.svelte
key_decisions:
  - Arrow up/down for reorder instead of drag-and-drop (simpler, no library dependency)
  - Inline create form on list page (suites are simpler than test cases)
  - Add cases panel filters out cases already in suite
patterns_established:
  - Inline create form pattern for simpler entities (vs separate /new route)
  - Arrow button reorder pattern (immediate save on each move)
observability_surfaces:
  - Suite list includes case count
  - All errors use RFC 7807
drill_down_paths:
  - .gsd/milestones/M004/slices/S03/tasks/T01-SUMMARY.md
  - .gsd/milestones/M004/slices/S03/tasks/T02-SUMMARY.md
  - .gsd/milestones/M004/slices/S03/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-03-26T20:20:16.681Z
blocker_discovered: false
---

# S03: Test Suites

**Test Suites CRUD — 5 API routes + list page with inline create + detail with reorder/add/remove**

## What Happened

Built complete test suite CRUD. Server: 5 API routes with batch case count enrichment and ordered case list with labels. Web: list page (suite cards with name/description/case count, inline create form) and detail page (ordered case list with move up/down reordering, add cases panel, remove case button, delete suite). Every reorder/add/remove saves immediately via PUT.

## Verification

svelte-check 0 errors. Web build clean. 311/311 tests pass.

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

None.

## Known Limitations

None.

## Follow-ups

None.

## Files Created/Modified

- `server/api/test-suite-routes.ts` — 5 Fastify routes: list (batch case counts), create, detail (ordered cases with labels), update (replace case list), delete
- `server/api/plugin.ts` — Registered testSuiteRoutes
- `web/src/lib/api/test-suites.ts` — 5 typed functions for suite CRUD
- `web/src/lib/api/types.ts` — Added TestSuite, TestSuiteListItem, TestSuiteDetail types
- `web/src/routes/test-suites/+page.svelte` — List page with suite cards and inline create form
- `web/src/routes/test-suites/[id]/+page.svelte` — Detail page with ordered cases, reorder, add/remove, delete
