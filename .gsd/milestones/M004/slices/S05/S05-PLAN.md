# S05: Auto-link Jobs to Test Cases

**Goal:** Auto-link Maestro job completions to test cases via flow_filename matching. When a job finishes, create an automated execution with results mapped from job steps.
**Demo:** After this: Run a Maestro job. After completion, an execution is auto-created with results linked to matching test cases.

## Tasks
- [x] **T01: AutoLinkService matches job flows to test cases, creates automated executions, wired into job completion** — Create server/jobs/auto-link-service.ts with:
- Method `linkJobToTestCases(jobId, db)` called after job completion
- Query job_files for flow filenames
- Match against test_cases.flow_filename (exact match)
- If matches found: create test_execution (trigger=automated, job_id=jobId), create test_execution_results with status mapped from job status (passed→passed, failed→failed, timeout→blocked, cancelled→skipped)
- Structured logging for matches/no-matches
- Wire into job-service.ts completion handler

Also update job detail API to include linked execution ID if one exists.
  - Estimate: 25min
  - Files: server/jobs/auto-link-service.ts, server/jobs/job-service.ts, server/api/routes.ts
  - Verify: npx tsc --noEmit && npm test
- [x] **T02: Job detail page shows linked execution banner when auto-link matched** — Update job detail page (/jobs/[id]) to show a link to the auto-created execution if one exists. Add executionId to job detail API response. Show as a banner or link in the job detail metadata.
  - Estimate: 15min
  - Files: web/src/routes/jobs/[id]/+page.svelte, web/src/lib/api/types.ts
  - Verify: npx svelte-check --threshold error && npm run web:build
