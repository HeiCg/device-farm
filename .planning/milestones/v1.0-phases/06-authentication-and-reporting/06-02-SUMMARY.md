---
phase: 06-authentication-and-reporting
plan: 02
subsystem: reporting
tags: [webhook, junit-xml, flaky-detection, fastify-plugin]

# Dependency graph
requires:
  - phase: 02-job-execution-and-api
    provides: JobService, jobSteps table, job execution pipeline
  - phase: 03-real-time-and-storage
    provides: Phase3Services pattern, artifact plugin
provides:
  - WebhookService for fire-and-forget webhook delivery with retry
  - JUnit XML generator from job steps
  - FlakyDetector with sliding window analysis
  - Report API routes (GET /api/jobs/:id/report.xml, GET /api/flows/flaky)
  - Reporting Fastify plugin with service decorations
affects: [06-03-web-ui-auth, ci-integration]

# Tech tracking
tech-stack:
  added: []
  patterns: [fire-and-forget webhook delivery, HMAC signing, XML string building, sliding window flaky detection]

key-files:
  created:
    - server/reporting/webhook-service.ts
    - server/reporting/junit-generator.ts
    - server/reporting/flaky-detector.ts
    - server/reporting/report-routes.ts
    - server/reporting/reporting-plugin.ts
    - server/reporting/__tests__/webhook-service.test.ts
    - server/reporting/__tests__/junit-generator.test.ts
    - server/reporting/__tests__/flaky-detector.test.ts
  modified:
    - server/config/schema.ts
    - server/jobs/job-service.ts
    - server/jobs/plugin.ts
    - server/api/plugin.ts
    - server/index.ts

key-decisions:
  - "WebhookService uses native fetch with AbortSignal.timeout -- no external HTTP library needed"
  - "JUnit XML built via string concatenation -- no XML library for simple output format"
  - "FlakyDetector uses application-level grouping after DB query for simplicity"
  - "Added webhooks config schema early (Rule 3) since Plan 01 not yet executed"

patterns-established:
  - "Fire-and-forget webhook pattern: .deliver().catch() with exponential backoff + jitter"
  - "Reporting plugin decorates webhookService and flakyDetector on Fastify instance"

requirements-completed: [REPT-01, REPT-02, REPT-03]

# Metrics
duration: 4min
completed: 2026-03-11
---

# Phase 06 Plan 02: Reporting Summary

**Webhook delivery with retry and HMAC signing, JUnit XML report endpoint, and sliding-window flaky test detection**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-11T12:19:26Z
- **Completed:** 2026-03-11T12:23:26Z
- **Tasks:** 2
- **Files modified:** 13

## Accomplishments
- WebhookService delivers JSON payloads with exponential backoff retry on 5xx, optional HMAC-SHA256 signing
- JUnit XML generator produces valid XML from job steps with proper escaping of special characters
- FlakyDetector identifies flows with 20%-80% pass rate over configurable sliding window
- Report routes serve XML reports and flaky flow data via REST API
- Reporting plugin integrated into server boot chain, webhook fires on job completion

## Task Commits

Each task was committed atomically:

1. **Task 1: WebhookService, JUnit generator, and FlakyDetector with tests** - `915b970` (feat)
2. **Task 2: Reporting plugin, routes, and JobService webhook integration** - `ef5a514` (feat)

_Note: Task 1 used TDD (RED->GREEN in single commit since tests and implementation validated together)_

## Files Created/Modified
- `server/reporting/webhook-service.ts` - Fire-and-forget webhook delivery with retry and HMAC signing
- `server/reporting/junit-generator.ts` - JUnit XML string builder from job steps
- `server/reporting/flaky-detector.ts` - Sliding window flaky test detection
- `server/reporting/report-routes.ts` - GET /jobs/:id/report.xml and GET /flows/flaky endpoints
- `server/reporting/reporting-plugin.ts` - Fastify plugin registering services and routes
- `server/reporting/__tests__/webhook-service.test.ts` - 6 tests for webhook behavior
- `server/reporting/__tests__/junit-generator.test.ts` - 12 tests for XML generation
- `server/reporting/__tests__/flaky-detector.test.ts` - 7 tests for flaky detection
- `server/config/schema.ts` - Added webhooks config (url, secret, timeout_ms, max_retries)
- `server/jobs/job-service.ts` - Added webhookService param and webhook delivery on completion
- `server/jobs/plugin.ts` - Wired webhookService from Fastify instance to JobService
- `server/api/plugin.ts` - Added 'reporting' to dependencies
- `server/index.ts` - Registered reporting plugin in boot chain

## Decisions Made
- WebhookService uses native fetch with AbortSignal.timeout -- no external HTTP library needed for simple POST with retry
- JUnit XML built via string concatenation -- no XML library for ~50 lines of templating
- FlakyDetector queries all steps then groups in JS -- simpler than complex SQL window functions
- Added webhooks + auth config schemas early since Plan 01 not yet executed (deviation Rule 3)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added webhooks config schema to server/config/schema.ts**
- **Found during:** Task 1 (WebhookService implementation)
- **Issue:** Plan references config.webhooks but Plan 01 (which adds config schema extensions) has not been executed yet
- **Fix:** Added webhooksSchema and authSchema to configSchema with safe defaults
- **Files modified:** server/config/schema.ts
- **Verification:** All tests pass, config schema validated
- **Committed in:** 915b970 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Config schema addition necessary for WebhookService to reference config.webhooks. When Plan 01 executes, it will find the schema already present.

## Issues Encountered
- Pre-existing failing tests in server/auth/__tests__/auth-plugin.test.ts (8 tests) from Plan 01 TDD RED phase that was never completed. These are out of scope and unrelated to reporting changes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Reporting services ready for Plan 03 (Web UI auth gate and flaky badges)
- Webhook URL can be configured via config.yaml webhooks.url field
- JUnit XML endpoint ready for CI pipeline integration

---
*Phase: 06-authentication-and-reporting*
*Completed: 2026-03-11*
