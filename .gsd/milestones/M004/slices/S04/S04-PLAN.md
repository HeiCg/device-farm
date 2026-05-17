# S04: Test Executions — Manual

**Goal:** Manual test execution — create execution from suite or ad-hoc case list, record pass/fail per test case and per step, view execution summary with pass rate.
**Demo:** After this: Create a manual execution from a suite. Record pass/fail per test case and per step. View execution summary with pass rate.

## Tasks
- [x] **T01: Test Executions API — 5 routes with auto-populated results, step-level recording, batch enrichment** — Create server/api/test-execution-routes.ts with:
- GET /api/test-executions (list with filters: suite_id, status, trigger, cursor pagination, enriched with pass/fail/skip counts)
- POST /api/test-executions (create from suite_id or ad-hoc caseIds[], auto-populate execution_results with not_run status and step_results with skipped)
- GET /api/test-executions/:id (detail with all results + step results + case info)
- PUT /api/test-executions/:id (update status, finish)
- PUT /api/test-executions/:execId/results/:caseId (update result status, notes, step results)

Register in api/plugin.ts.
  - Estimate: 30min
  - Files: server/api/test-execution-routes.ts, server/api/plugin.ts
  - Verify: npx tsc --noEmit && npm test
- [x] **T02: Test Executions API client + full execution/result/step types** — Create web/src/lib/api/test-executions.ts with typed functions: listTestExecutions, getTestExecution, createTestExecution, updateTestExecution, updateExecutionResult. Add TestExecution, TestExecutionDetail, TestExecutionResult, TestStepResult types to types.ts.
  - Estimate: 10min
  - Files: web/src/lib/api/test-executions.ts, web/src/lib/api/types.ts
  - Verify: npm run web:build
- [x] **T03: Execution UI — list with counts + detail with inline case/step status toggles + run from suite** — Create /test-executions list page (cards with name, suite name, trigger badge, status badge, pass/fail/skip counts, date) and /test-executions/[id] detail page (case result grid with status toggle per case, expandable step results with per-step pass/fail toggle, notes field, complete/abort execution button). Create execution dialog from suite detail page (name, environment, trigger fields).
  - Estimate: 35min
  - Files: web/src/routes/test-executions/+page.svelte, web/src/routes/test-executions/[id]/+page.svelte, web/src/routes/test-suites/[id]/+page.svelte
  - Verify: npx svelte-check --threshold error && npm run web:build
