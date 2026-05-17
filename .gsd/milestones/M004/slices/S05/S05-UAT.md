# S05: Auto-link Jobs to Test Cases — UAT

**Milestone:** M004
**Written:** 2026-03-26T21:40:39.372Z

## UAT: S05 — Auto-link Jobs to Test Cases\n\n### Test 1: Auto-link on Job Completion\n1. Create a test case with flow_filename = 'login-flow.yaml'\n2. Submit a Maestro job with a file named 'login-flow.yaml'\n3. Job completes (passed)\n4. Check /test-executions — an automated execution exists\n5. Execution has 1 result with status=passed\n\n### Test 2: No Match\n1. Submit a job with flow 'unrelated.yaml'\n2. Job completes\n3. No execution created (check logs for debug message)\n\n### Test 3: Job Detail Link\n1. Open the job detail page for a job that auto-linked\n2. Green banner appears: 'Linked to test execution'\n3. Click banner → navigates to execution detail\n\n### Test 4: Failed Job\n1. Test case with matching flow_filename exists\n2. Job fails\n3. Auto-created execution result has status=failed
