# S02: Test Cases CRUD — UAT

**Milestone:** M004
**Written:** 2026-03-26T20:04:23.267Z

## UAT: S02 — Test Cases CRUD\n\n### Test 1: Create Test Case\n1. Navigate to /test-cases\n2. Click NEW_TEST_CASE\n3. Fill title, description, preconditions\n4. Set priority P1, status Active, automation Can Automate\n5. Add 3 steps with action + expected result\n6. Select 2 labels\n7. Click CREATE_TEST_CASE\n8. Redirected to detail page showing all entered data\n\n### Test 2: List and Filter\n1. Navigate to /test-cases\n2. Verify card shows title, priority badge, status badge, automation badge, label pills, step count\n3. Filter by status → only matching cases shown\n4. Filter by label → only cases with that label shown\n5. Search by text → matches title\n6. Clear filters → all cases shown\n\n### Test 3: Edit Test Case\n1. From detail page, click EDIT\n2. Change title, add a step, remove a label\n3. Click SAVE_CHANGES\n4. Verify changes reflected on detail page\n\n### Test 4: Delete Test Case\n1. From detail page, click DELETE\n2. Confirm delete\n3. Redirected to list page\n4. Verify case status is deprecated
