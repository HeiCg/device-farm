---
estimated_steps: 8
estimated_files: 3
skills_used: []
---

# T01: Auto-link service + job completion hook

Create server/jobs/auto-link-service.ts with:
- Method `linkJobToTestCases(jobId, db)` called after job completion
- Query job_files for flow filenames
- Match against test_cases.flow_filename (exact match)
- If matches found: create test_execution (trigger=automated, job_id=jobId), create test_execution_results with status mapped from job status (passed→passed, failed→failed, timeout→blocked, cancelled→skipped)
- Structured logging for matches/no-matches
- Wire into job-service.ts completion handler

Also update job detail API to include linked execution ID if one exists.

## Inputs

- `server/jobs/job-service.ts`
- `server/api/test-execution-routes.ts`

## Expected Output

- `server/jobs/auto-link-service.ts`

## Verification

npx tsc --noEmit && npm test
