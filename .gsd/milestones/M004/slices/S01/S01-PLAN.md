# S01: Schema + Labels CRUD

**Goal:** Establish the full TCM data model (9 tables, 7 enums) and deliver the first user-facing feature (labels CRUD with API routes and Settings UI)
**Demo:** After this: Labels can be created/edited/deleted in Settings page, all 9 DB tables exist with proper indexes

## Tasks
- [x] **T01: Added 7 TCM enums and 9 tables (labels, test_cases, test_case_steps, test_case_labels, test_suites, test_suite_cases, test_executions, test_execution_results, test_step_results) to Drizzle schema** — Add 7 new pgEnum declarations and 9 new table definitions to server/db/schema.ts. Tables: labels, test_cases, test_case_steps, test_case_labels, test_suites, test_suite_cases, test_executions, test_execution_results, test_step_results. All FKs with ON DELETE CASCADE where appropriate. Indexes on all FK columns and search fields (test_cases.title, test_cases.status, labels.name).
  - Estimate: 20min
  - Files: server/db/schema.ts
  - Verify: npx tsc --noEmit && npm test
- [x] **T02: Labels CRUD API — 4 Fastify routes with Zod validation, duplicate detection, and RFC 7807 errors** — Create server/api/label-routes.ts with Fastify route plugin. Routes: GET /api/labels (filter by ?category=), POST /api/labels (create), PUT /api/labels/:id (update), DELETE /api/labels/:id (delete). Zod validation schemas in the same file. RFC 7807 error responses. Register in server/api/plugin.ts.
  - Estimate: 20min
  - Files: server/api/label-routes.ts, server/api/plugin.ts
  - Verify: npx tsc --noEmit && npm test
- [x] **T03: Labels API client + full TCM type definitions (Label, TestCase, TestCaseStep, priority/status/automation enums)** — Create web/src/lib/api/labels.ts with typed fetch functions: listLabels, createLabel, updateLabel, deleteLabel. Add Label type to web/src/lib/api/types.ts.
  - Estimate: 10min
  - Files: web/src/lib/api/labels.ts, web/src/lib/api/types.ts
  - Verify: npm run web:build
- [x] **T04: LabelManager + LabelForm components integrated into Settings page — colored pill display, grouped by category, full CRUD with color picker** — Create LabelManager.svelte component with: list of labels as colored pills, create button, inline edit (name + color + category), delete with two-click confirmation (D021 pattern). Add color picker using native input[type=color]. Category dropdown with preset options (feature, type, priority, platform, custom). Integrate into Settings page below the hooks section.
  - Estimate: 30min
  - Files: web/src/lib/components/labels/LabelManager.svelte, web/src/lib/components/labels/LabelForm.svelte, web/src/routes/settings/+page.svelte
  - Verify: npx svelte-check --threshold error && npm run web:build
