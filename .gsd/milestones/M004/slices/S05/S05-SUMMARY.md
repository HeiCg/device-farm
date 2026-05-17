---
id: S05
parent: M004
milestone: M004
provides:
  - Automated executions visible in S06 dashboard stats
requires:
  - slice: S01
    provides: test_executions + results tables
  - slice: S02
    provides: Test case flow_filename field
  - slice: S04
    provides: Execution creation API
affects:
  - S06
key_files:
  - server/jobs/auto-link-service.ts
  - server/jobs/job-service.ts
  - server/api/routes.ts
  - web/src/routes/jobs/[id]/+page.svelte
key_decisions:
  - Auto-link is fire-and-forget to avoid blocking job completion
  - Flow filename matching is exact (not fuzzy)
  - Job status mapped: passed→passed, failed→failed, timeout→blocked, cancelled→skipped
patterns_established:
  - Fire-and-forget service pattern for non-critical post-completion work
observability_surfaces:
  - Structured logs for match/no-match on auto-link
  - linkedExecutionId in job detail API response
drill_down_paths:
  - .gsd/milestones/M004/slices/S05/tasks/T01-SUMMARY.md
  - .gsd/milestones/M004/slices/S05/tasks/T02-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-03-26T21:40:39.372Z
blocker_discovered: false
---

# S05: Auto-link Jobs to Test Cases

**Auto-link Maestro jobs to test cases via flow_filename matching with execution creation**

## What Happened

Built the auto-link bridge between Maestro jobs and TCM. AutoLinkService runs after job completion, matches flow filenames to test cases, and creates an automated execution with results mapped from job status. Wired as fire-and-forget in JobService to avoid blocking. Job detail API now returns linkedExecutionId, and the UI shows a clickable green banner linking to the execution detail page.

## Verification

tsc clean. 311/311 tests (with updated mock). svelte-check 0 errors. Web build clean.

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

Had to update routes.test.ts mock for the new linked execution query.

## Known Limitations

None.

## Follow-ups

None.

## Files Created/Modified

- `server/jobs/auto-link-service.ts` — New: matches job flows to test_cases.flow_filename, creates automated execution
- `server/jobs/job-service.ts` — Added AutoLinkService import, instantiation, and fire-and-forget call after saveJobResult
- `server/api/routes.ts` — GET /jobs/:id now includes linkedExecutionId from test_executions table
- `server/api/__tests__/routes.test.ts` — Updated mock for 3rd select() call (linked execution lookup)
- `web/src/routes/jobs/[id]/+page.svelte` — Shows green linked execution banner when linkedExecutionId present
