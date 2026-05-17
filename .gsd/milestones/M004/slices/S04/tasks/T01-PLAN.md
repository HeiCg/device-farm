---
estimated_steps: 7
estimated_files: 2
skills_used: []
---

# T01: Test Executions API routes

Create server/api/test-execution-routes.ts with:
- GET /api/test-executions (list with filters: suite_id, status, trigger, cursor pagination, enriched with pass/fail/skip counts)
- POST /api/test-executions (create from suite_id or ad-hoc caseIds[], auto-populate execution_results with not_run status and step_results with skipped)
- GET /api/test-executions/:id (detail with all results + step results + case info)
- PUT /api/test-executions/:id (update status, finish)
- PUT /api/test-executions/:execId/results/:caseId (update result status, notes, step results)

Register in api/plugin.ts.

## Inputs

- `server/api/test-case-routes.ts`
- `server/api/test-suite-routes.ts`

## Expected Output

- `server/api/test-execution-routes.ts`

## Verification

npx tsc --noEmit && npm test
