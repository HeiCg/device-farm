# S04: Test Executions — Manual — UAT

**Milestone:** M004
**Written:** 2026-03-26T21:32:31.553Z

## UAT: S04 — Test Executions (Manual)\n\n### Test 1: Create Execution from Suite\n1. Navigate to /test-suites/:id\n2. Click RUN button\n3. Fill name, environment, executed by\n4. Click START_EXECUTION\n5. Redirected to execution detail page\n6. All cases shown with not_run status\n\n### Test 2: Record Results\n1. In execution detail, click ✓ on first case → status becomes passed\n2. Click ✗ on second case → status becomes failed\n3. Summary bar updates with counts and pass rate\n\n### Test 3: Step-Level Results\n1. Click a case row to expand steps\n2. Click ✓ on step 1, ✗ on step 2\n3. Step status icons update immediately\n\n### Test 4: Complete Execution\n1. Click COMPLETE button\n2. Status changes to completed\n3. Toggle buttons become disabled\n4. Execution appears in /test-executions list with final counts
