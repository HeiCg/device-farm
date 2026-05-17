---
phase: 02-job-execution-and-api
plan: 01
subsystem: jobs
tags: [maestro, parser, queue, fastify-plugin, strip-ansi, tdd]

# Dependency graph
requires:
  - phase: 01-device-infrastructure
    provides: Platform type, DB schema (jobs/jobSteps tables), Fastify plugin pattern
provides:
  - JobData domain types (QueuedJob, JobStep, JobSummary, ParserCallbacks)
  - MaestroParser line-by-line stdout parser with ANSI stripping
  - JobQueue in-memory FIFO per platform
  - DB Fastify plugin for shared database access
affects: [02-02-PLAN, 02-03-PLAN, 02-04-PLAN]

# Tech tracking
tech-stack:
  added: ["@fastify/multipart", "strip-ansi"]
  patterns: ["Line-by-line parser with callback interface", "In-memory FIFO queue with remove-by-id"]

key-files:
  created:
    - server/jobs/types.ts
    - server/jobs/maestro-parser.ts
    - server/jobs/job-queue.ts
    - server/db/plugin.ts
    - server/jobs/__tests__/maestro-parser.test.ts
    - server/jobs/__tests__/job-queue.test.ts
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "MaestroParser uses callback interface (ParserCallbacks) for decoupled event handling"
  - "Parser priority order: SUITE_SUMMARY > FLOW_RESULT > COMMAND_STATUS > FLOW_START to avoid false matches"
  - "Canceled flows counted as skipped in JobSummary aggregation"
  - "DB plugin accepts db via options (not creating its own) since buildApp already calls createDb"

patterns-established:
  - "Callback-based parser: MaestroParser emits events via ParserCallbacks rather than returning parsed data"
  - "DB plugin decoration: fastify.db available to all downstream plugins"

requirements-completed: [JOBS-02, JOBS-04, JOBS-07]

# Metrics
duration: 3min
completed: 2026-03-10
---

# Phase 2 Plan 1: Job Types, MaestroParser, and JobQueue Summary

**Line-by-line Maestro stdout parser with ANSI/shard handling, in-memory FIFO job queue, and DB Fastify plugin -- 35 tests all green**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-10T14:13:59Z
- **Completed:** 2026-03-10T14:16:56Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Defined all job domain types (QueuedJob, JobStep, JobSummary, ParserCallbacks) used by downstream plans
- MaestroParser handles all Maestro stdout patterns: flow start, command status (COMPLETED/FAILED/SKIPPED/RUNNING), flow result with duration, suite summary -- with ANSI stripping and shard prefix support
- JobQueue provides correct FIFO semantics with enqueue/dequeue/peek/remove-by-id/size/isEmpty/isFull
- DB Fastify plugin decorates `fastify.db` for shared database access across plugins
- Installed @fastify/multipart and strip-ansi dependencies for Phase 2

## Task Commits

Each task was committed atomically:

1. **Task 1: Install deps, define job types, implement MaestroParser with tests** - `dc48294` (feat)
2. **Task 2: Implement JobQueue with tests and DB plugin** - `6d52298` (feat)

## Files Created/Modified
- `server/jobs/types.ts` - Job domain types: QueuedJob, JobStep, JobSummary, ParserCallbacks
- `server/jobs/maestro-parser.ts` - Line-by-line Maestro stdout parser with regex pattern matching
- `server/jobs/job-queue.ts` - In-memory FIFO queue with remove-by-id for cancellation
- `server/db/plugin.ts` - Fastify plugin decorating db instance on fastify
- `server/jobs/__tests__/maestro-parser.test.ts` - 23 parser tests (flow start, command status, flow result, suite summary, ANSI, raw output, aggregation)
- `server/jobs/__tests__/job-queue.test.ts` - 12 queue tests (FIFO, empty, size, peek, remove, isFull)
- `package.json` - Added @fastify/multipart and strip-ansi dependencies
- `package-lock.json` - Updated lockfile

## Decisions Made
- MaestroParser uses callback interface (ParserCallbacks) for decoupled event handling -- executor wires callbacks to DB writes
- Parser pattern priority: SUITE_SUMMARY > FLOW_RESULT > COMMAND_STATUS > FLOW_START to prevent COMMAND_STATUS regex from matching flow result lines
- Canceled flows counted as skipped in JobSummary (not failed) since they were not executed to completion
- DB plugin accepts db via options rather than creating its own connection -- buildApp() already calls createDb()

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Types, parser, and queue are dependency-free building blocks ready for Plan 02 (JobExecutor/JobService)
- DB plugin ready to register in buildApp() before job plugin
- All 35 tests green, providing regression safety for downstream integration

---
*Phase: 02-job-execution-and-api*
*Completed: 2026-03-10*

## Self-Check: PASSED
- All 6 source/test files exist
- Both task commits verified (dc48294, 6d52298)
- Min line counts met: parser 112>=60, queue 35>=30, parser tests 231>=80, queue tests 123>=40
- 35/35 tests pass
