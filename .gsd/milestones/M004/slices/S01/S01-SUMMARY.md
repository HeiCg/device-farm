---
id: S01
parent: M004
milestone: M004
provides:
  - Drizzle schema with all 9 TCM tables for S02-S06
  - Labels CRUD API for S02 (label assignment to test cases)
  - Label and TestCase TypeScript types for S02-S06
  - CRUD route pattern template for test-case-routes, test-suite-routes, test-execution-routes
requires:
  []
affects:
  - S02
  - S03
  - S04
key_files:
  - server/db/schema.ts
  - server/api/label-routes.ts
  - web/src/lib/api/labels.ts
  - web/src/lib/api/types.ts
  - web/src/lib/components/labels/LabelManager.svelte
  - web/src/lib/components/labels/LabelForm.svelte
key_decisions:
  - Labels stored in DB with unique name constraint, not in-memory like hooks
  - Composite primary keys for junction tables (test_case_labels, test_suite_cases)
  - Labels grouped by category in UI with preset categories (feature, type, priority, platform, custom)
  - LabelManager is self-contained with onMount loading, same pattern as hooks
patterns_established:
  - Drizzle composite primary key pattern for junction tables
  - Self-contained Settings section component pattern (LabelManager mirrors HookList/HookForm)
  - TCM enum types shared between server schema and web types
observability_surfaces:
  - Labels API returns RFC 7807 errors with proper status codes (400, 404, 409)
drill_down_paths:
  - .gsd/milestones/M004/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M004/slices/S01/tasks/T02-SUMMARY.md
  - .gsd/milestones/M004/slices/S01/tasks/T03-SUMMARY.md
  - .gsd/milestones/M004/slices/S01/tasks/T04-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-03-26T19:52:40.205Z
blocker_discovered: false
---

# S01: Schema + Labels CRUD

**Full TCM schema (9 tables, 7 enums) + labels CRUD API + labels management UI in Settings**

## What Happened

Established the full TCM data model with 7 new enums and 9 new tables in the Drizzle schema, all with proper FK constraints (ON DELETE CASCADE where appropriate) and indexes on every FK column plus search fields. Built the labels CRUD API as the first user-facing feature — 4 Fastify routes with Zod validation, duplicate detection, and RFC 7807 error responses. Created typed API client and added all TCM types to the web app. Built LabelManager and LabelForm components following the established Kinetic Console patterns — colored pills grouped by category, hover-reveal edit/delete, D021 two-click delete confirmation, native color picker with live preview.

## Verification

npx tsc --noEmit clean. npm test: 33 files, 311 tests pass. svelte-check: 0 errors. npm run web:build clean.

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

- `server/db/schema.ts` — Added 2 imports (uniqueIndex, primaryKey), 7 new enums, 9 new tables with indexes and FK constraints
- `server/api/label-routes.ts` — New file: 4 Fastify routes for labels CRUD with Zod validation and RFC 7807 errors
- `server/api/plugin.ts` — Registered labelRoutes in protected scope
- `web/src/lib/api/labels.ts` — New file: typed fetch functions for labels API
- `web/src/lib/api/types.ts` — Added Label, TestCase, TestCaseStep, and all TCM enum types
- `web/src/lib/components/labels/LabelManager.svelte` — New file: self-contained label CRUD UI with grouped pills, color picker, two-click delete
- `web/src/lib/components/labels/LabelForm.svelte` — New file: create/edit form with name, color picker, category dropdown
- `web/src/routes/settings/+page.svelte` — Added LabelManager import and section below hooks
