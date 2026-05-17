---
phase: 03-real-time-and-storage
plan: 01
subsystem: streaming, database
tags: [websocket, fastify-websocket, node-cron, drizzle, artifacts, streaming-types]

requires:
  - phase: 01-device-infrastructure
    provides: DB schema with jobs, jobSteps, recordings tables
  - phase: 02-job-execution-and-api
    provides: Job types and config schema
provides:
  - WebSocket message types (JobMessage, WsMessageType, DevicePreviewMessage)
  - Artifact data types (ArtifactType, LogData, StepData, MetricsData, StatusData, LogcatData)
  - Unified artifacts DB table replacing recordings table
  - Config schema with storage.artifacts path
  - @fastify/websocket and node-cron dependencies
affects: [03-02, 03-03, 03-04, 03-05, 03-06]

tech-stack:
  added: ["@fastify/websocket", "node-cron", "@types/ws", "@types/node-cron"]
  patterns: ["Unified artifact type enum for all job outputs", "WS message type contracts"]

key-files:
  created:
    - server/streaming/types.ts
  modified:
    - server/db/schema.ts
    - server/config/schema.ts
    - server/config/__tests__/loader.test.ts
    - server/pool/__tests__/health-checker.test.ts
    - server/pool/__tests__/cleanup.test.ts
    - server/pool/__tests__/allocation.test.ts
    - server/jobs/__tests__/job-service.test.ts

key-decisions:
  - "Unified artifacts table with artifactTypeEnum replaces recordings table for all job output types"
  - "Storage paths consolidated under ./storage/ prefix (artifacts, logs)"
  - "onDelete cascade on artifacts.jobId for automatic cleanup when jobs are deleted"

patterns-established:
  - "WsMessageType union for all streaming event kinds"
  - "ArtifactType union matching DB enum for type safety across layers"

requirements-completed: [STOR-01]

duration: 2min
completed: 2026-03-10
---

# Phase 3 Plan 01: Foundation Types and Schema Summary

**WebSocket streaming types, unified artifacts DB table, and @fastify/websocket + node-cron dependencies installed**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-10T22:34:09Z
- **Completed:** 2026-03-10T22:36:32Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Defined all WebSocket message type contracts for real-time streaming (log, step, metrics, status, logcat)
- Replaced recordings table with unified artifacts table supporting 5 artifact types with indexes
- Updated config schema to use storage.artifacts path structure
- Installed @fastify/websocket and node-cron with type definitions

## Task Commits

Each task was committed atomically:

1. **Task 1: Install dependencies and create streaming/artifact types** - `30020a2` (feat)
2. **Task 2: Replace recordings table with unified artifacts table and update config** - `a5e68a0` (feat)

## Files Created/Modified
- `server/streaming/types.ts` - WebSocket message types and artifact type definitions
- `server/db/schema.ts` - Unified artifacts table with artifactTypeEnum and indexes
- `server/config/schema.ts` - Renamed recordings to artifacts, updated storage paths
- `server/config/__tests__/loader.test.ts` - Updated assertions for new config shape
- `server/pool/__tests__/health-checker.test.ts` - Updated config fixtures
- `server/pool/__tests__/cleanup.test.ts` - Updated config fixtures
- `server/pool/__tests__/allocation.test.ts` - Updated config fixtures
- `server/jobs/__tests__/job-service.test.ts` - Updated config fixtures
- `package.json` - Added @fastify/websocket, node-cron, @types/ws, @types/node-cron
- `package-lock.json` - Dependency lockfile updated

## Decisions Made
- Unified artifacts table with artifactTypeEnum replaces recordings table for all job output types
- Storage paths consolidated under ./storage/ prefix (./storage/artifacts, ./storage/logs)
- Added onDelete cascade on artifacts.jobId for automatic cleanup when jobs are deleted
- Kept fileName and mimeType as required columns for proper artifact serving

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated test fixtures for new config shape**
- **Found during:** Task 2 (Schema update)
- **Issue:** 5 test files had hardcoded config objects with `storage.recordings` that would fail TypeScript compilation
- **Fix:** Updated all test fixture config objects to use `storage.artifacts` with new default paths
- **Files modified:** server/config/__tests__/loader.test.ts, server/pool/__tests__/health-checker.test.ts, server/pool/__tests__/cleanup.test.ts, server/pool/__tests__/allocation.test.ts, server/jobs/__tests__/job-service.test.ts
- **Verification:** Config loader tests pass (7/7), TypeScript compilation clean for changed files
- **Committed in:** a5e68a0 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Necessary to maintain test suite correctness after schema rename. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All streaming type contracts defined for Plans 02-06
- Artifacts table ready for artifact storage service (Plan 05)
- @fastify/websocket installed for WebSocket streaming (Plan 02)
- node-cron installed for lifecycle management (Plan 06)

---
*Phase: 03-real-time-and-storage*
*Completed: 2026-03-10*
