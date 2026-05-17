---
estimated_steps: 1
estimated_files: 1
skills_used: []
---

# T01: Drizzle schema — enums + all 9 TCM tables

Add 7 new pgEnum declarations and 9 new table definitions to server/db/schema.ts. Tables: labels, test_cases, test_case_steps, test_case_labels, test_suites, test_suite_cases, test_executions, test_execution_results, test_step_results. All FKs with ON DELETE CASCADE where appropriate. Indexes on all FK columns and search fields (test_cases.title, test_cases.status, labels.name).

## Inputs

- `docs/superpowers/specs/2026-03-26-test-case-management-design.md`

## Expected Output

- `server/db/schema.ts with 9 new tables and 7 new enums`

## Verification

npx tsc --noEmit && npm test
