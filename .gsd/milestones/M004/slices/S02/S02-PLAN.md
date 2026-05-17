# S02: Test Cases CRUD

**Goal:** Full test case lifecycle — create, read, update, soft-delete with structured steps and label assignment. 4 new UI pages + API routes with cursor pagination and multi-filter.
**Demo:** After this: Create a test case with title, steps, labels, and priority. List page filters by label and status. Detail page shows steps and metadata.

## Tasks
- [x] **T01: Test Cases API — 6 routes with cursor pagination, multi-filter, batch enrichment, step/label management** — Create server/api/test-case-routes.ts with Fastify route plugin. Routes:
- GET /api/test-cases (list with cursor pagination, filters: label, status, automation_status, priority, search)
- POST /api/test-cases (create with inline steps[] and labelIds[])
- GET /api/test-cases/:id (detail with steps, labels, recent execution count)
- PUT /api/test-cases/:id (update fields, replace steps via bulk upsert, update labels)
- DELETE /api/test-cases/:id (soft-delete: status → deprecated)
- PUT /api/test-cases/:id/steps (bulk upsert steps)

Zod validation schemas. Register in api/plugin.ts.
  - Estimate: 30min
  - Files: server/api/test-case-routes.ts, server/api/plugin.ts
  - Verify: npx tsc --noEmit && npm test
- [x] **T02: Test Cases API client — 6 typed functions with list/detail/create/update/delete/steps interfaces** — Create web/src/lib/api/test-cases.ts with typed fetch functions: listTestCases, createTestCase, getTestCase, updateTestCase, deleteTestCase, updateTestCaseSteps. Uses existing types from types.ts.
  - Estimate: 10min
  - Files: web/src/lib/api/test-cases.ts
  - Verify: npm run web:build
- [x] **T03: Test Cases list page — search, 4 filter dropdowns, card grid with badges/labels/pagination** — Create web/src/routes/test-cases/+page.svelte — list page with:
- Search input (debounced)
- Multi-filter: status pills, priority dropdown, automation_status dropdown, label multi-select
- Test case cards showing title, priority pill, status pill, automation status pill, label pills, step count
- Cursor pagination (Load More button)
- Link to detail page
- Create button linking to /test-cases/new
  - Estimate: 25min
  - Files: web/src/routes/test-cases/+page.svelte
  - Verify: npx svelte-check --threshold error && npm run web:build
- [x] **T04: Create/edit forms with StepEditor (reorder/add/remove) and LabelPicker (toggle multi-select) components** — Create web/src/routes/test-cases/new/+page.svelte and web/src/routes/test-cases/[id]/edit/+page.svelte (shared StepEditor component).
- Title, description (textarea), preconditions (textarea)
- Priority dropdown, status dropdown, automation_status dropdown
- Flow filename input (for auto-linking)
- StepEditor: ordered list of steps with action, expected_result, test_data fields. Add/remove/reorder steps.
- LabelPicker: multi-select from existing labels with colored pills
- Save button → POST or PUT
  - Estimate: 30min
  - Files: web/src/routes/test-cases/new/+page.svelte, web/src/routes/test-cases/[id]/edit/+page.svelte, web/src/lib/components/test-cases/StepEditor.svelte, web/src/lib/components/test-cases/LabelPicker.svelte
  - Verify: npx svelte-check --threshold error && npm run web:build
- [x] **T05: Test Case detail page — steps table, metadata sidebar, labels, edit/delete actions, execution history placeholder** — Create web/src/routes/test-cases/[id]/+page.svelte — detail page with:
- Title, metadata sidebar (priority, status, automation status, flow filename, dates)
- Steps table (index, action, expected result, test data)
- Labels as colored pills
- Edit button, delete (soft-delete) button with confirmation
- Future: execution history section (placeholder for S04)
  - Estimate: 20min
  - Files: web/src/routes/test-cases/[id]/+page.svelte
  - Verify: npx svelte-check --threshold error && npm run web:build
