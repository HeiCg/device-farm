# S03: Test Suites

**Goal:** Test suite CRUD — group test cases with ordering, add/remove cases, reorder via UI. API routes + 2 new pages.
**Demo:** After this: Create a suite, add test cases, drag to reorder. Suite detail shows ordered cases with labels.

## Tasks
- [x] **T01: Test Suites API — 5 routes with ordered cases, batch enrichment, case count** — Create server/api/test-suite-routes.ts with:
- GET /api/test-suites (list with case count)
- POST /api/test-suites (create with caseIds[])
- GET /api/test-suites/:id (detail with ordered cases + labels)
- PUT /api/test-suites/:id (update name/description, replace case list with ordering)
- DELETE /api/test-suites/:id

Zod validation. Register in api/plugin.ts.
  - Estimate: 20min
  - Files: server/api/test-suite-routes.ts, server/api/plugin.ts
  - Verify: npx tsc --noEmit && npm test
- [x] **T02: Test Suites API client + types (TestSuite, TestSuiteListItem, TestSuiteDetail)** — Create web/src/lib/api/test-suites.ts with typed functions: listTestSuites, getTestSuite, createTestSuite, updateTestSuite, deleteTestSuite. Add TestSuite and TestSuiteDetail types.
  - Estimate: 10min
  - Files: web/src/lib/api/test-suites.ts, web/src/lib/api/types.ts
  - Verify: npm run web:build
- [x] **T03: Test Suites UI — list page with inline create + detail page with reorder/add/remove cases** — Create /test-suites list page (suite cards with name, description, case count, created date) and /test-suites/[id] detail page (ordered case list with move up/down buttons, add cases modal/picker, remove case, name/description editing, delete suite). Create button on list page.
  - Estimate: 30min
  - Files: web/src/routes/test-suites/+page.svelte, web/src/routes/test-suites/[id]/+page.svelte
  - Verify: npx svelte-check --threshold error && npm run web:build
