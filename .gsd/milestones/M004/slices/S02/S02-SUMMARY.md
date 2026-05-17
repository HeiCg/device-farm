---
id: S02
parent: M004
milestone: M004
provides:
  - Test case CRUD API for S03 (suites reference cases), S04 (executions reference cases), S05 (auto-link matches cases)
  - StepEditor and LabelPicker components reusable in S04 (step result entry)
  - Test case detail page ready for S04 (execution history section placeholder)
requires:
  - slice: S01
    provides: labels table + CRUD API + Label type
affects:
  - S03
  - S04
  - S05
  - S06
key_files:
  - server/api/test-case-routes.ts
  - web/src/lib/api/test-cases.ts
  - web/src/routes/test-cases/+page.svelte
  - web/src/routes/test-cases/new/+page.svelte
  - web/src/routes/test-cases/[id]/+page.svelte
  - web/src/routes/test-cases/[id]/edit/+page.svelte
  - web/src/lib/components/test-cases/StepEditor.svelte
  - web/src/lib/components/test-cases/LabelPicker.svelte
key_decisions:
  - Local cursor encode/decode in test-case-routes (not coupled to jobs pagination)
  - List endpoint enriches with labels and step counts in batch (2 queries, not N+1)
  - Steps replaced atomically (delete all + insert) instead of individual upserts
  - Soft-delete via status=deprecated
  - StepEditor and LabelPicker are controlled components for reuse
patterns_established:
  - Controlled component pattern for StepEditor/LabelPicker (parent owns state, child emits via callback)
  - Batch enrichment in list endpoints (labels + counts in 2 queries, not N+1)
  - Local cursor pagination (not coupled to jobs module)
observability_surfaces:
  - List API returns enriched data with labels and step counts
  - All API errors use RFC 7807 format
drill_down_paths:
  - .gsd/milestones/M004/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M004/slices/S02/tasks/T02-SUMMARY.md
  - .gsd/milestones/M004/slices/S02/tasks/T03-SUMMARY.md
  - .gsd/milestones/M004/slices/S02/tasks/T04-SUMMARY.md
  - .gsd/milestones/M004/slices/S02/tasks/T05-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-03-26T20:04:23.266Z
blocker_discovered: false
---

# S02: Test Cases CRUD

**Full test case CRUD — 6 API routes + 4 UI pages + StepEditor + LabelPicker components**

## What Happened

Built the complete test case CRUD flow. Server: 6 API routes with cursor pagination, 5 filters (label, status, priority, automation, search), batch enrichment (labels + step counts), Zod validation, RFC 7807 errors. Web: 4 new pages — list (card grid with badges/labels/pagination), create form (title, desc, preconditions, 4 dropdowns, flow filename, StepEditor, LabelPicker), edit form (pre-filled), detail (steps table, metadata sidebar, labels, execution history placeholder). Two reusable components: StepEditor (add/remove/reorder) and LabelPicker (toggle multi-select).

## Verification

npx tsc --noEmit clean. svelte-check: 0 errors. npm run web:build clean. npm test: 311/311.

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

- `server/api/test-case-routes.ts` — 6 Fastify routes: list (cursor pagination + 5 filters), create, detail, update, delete, bulk steps
- `server/api/plugin.ts` — Registered testCaseRoutes
- `web/src/lib/api/test-cases.ts` — 6 typed functions with list/detail/create/update/delete/steps interfaces
- `web/src/routes/test-cases/+page.svelte` — List page with search, 4 filter dropdowns, card grid, cursor pagination
- `web/src/routes/test-cases/new/+page.svelte` — Create form with StepEditor, LabelPicker, all metadata fields
- `web/src/routes/test-cases/[id]/edit/+page.svelte` — Edit form (pre-filled from API)
- `web/src/routes/test-cases/[id]/+page.svelte` — Detail page with steps table, sidebar, labels, execution history placeholder
- `web/src/lib/components/test-cases/StepEditor.svelte` — Add/remove/reorder structured test steps
- `web/src/lib/components/test-cases/LabelPicker.svelte` — Toggle multi-select label pills
