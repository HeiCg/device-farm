---
phase: 02-job-execution-and-api
plan: 02
subsystem: jobs
tags: [maestro, child-process, job-executor, job-service, fastify-plugin, mutex, abort-signal, tdd]

# Dependency graph
requires:
  - phase: 01-device-infrastructure
    provides: PoolManager (allocate/markRunning/release), Platform type, DeviceInfo, ProcessTracker
  - phase: 02-job-execution-and-api
    plan: 01
    provides: MaestroParser, JobQueue, job types (QueuedJob, JobStep, JobSummary), DB plugin
provides:
  - JobExecutor for Maestro child process lifecycle (spawn, timeout, cancel, temp dirs)
  - JobService orchestrating create/queue/dispatch/execute/cancel with event-driven dispatch
  - Fastify job plugin decorating fastify.jobService
  - buildApp wiring: dbPlugin + jobPlugin registered, health includes queue depth
affects: [02-03-PLAN, 02-04-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Event-driven dispatch with mutex-per-platform", "Process group kill with SIGTERM->SIGKILL escalation", "Fire-and-forget execution with .catch error handling"]

key-files:
  created:
    - server/jobs/job-executor.ts
    - server/jobs/job-service.ts
    - server/jobs/plugin.ts
    - server/jobs/__tests__/job-executor.test.ts
    - server/jobs/__tests__/job-service.test.ts
  modified:
    - server/index.ts

key-decisions:
  - "JobExecutor uses process.kill(-pid) for process group kill -- catches both Maestro and child processes"
  - "JobService dispatch is mutex-protected per platform to prevent double-allocation race"
  - "Background execution uses fire-and-forget with .catch for unhandled rejection safety"
  - "Job plugin depends on config, db, and pool-plugin in correct order"

patterns-established:
  - "Process group kill: spawn with detached:true, kill with negative PID for clean shutdown"
  - "Mutex-per-platform dispatch: separate Mutex instances prevent cross-platform blocking"
  - "Event-driven dispatch: tryDispatch called on both job submission and device release"

requirements-completed: [JOBS-01, JOBS-03, JOBS-05, JOBS-06, JOBS-08]

# Metrics
duration: 6min
completed: 2026-03-10
---

# Phase 2 Plan 2: Job Execution Engine Summary

**JobExecutor spawns Maestro with platform-specific config and process group lifecycle; JobService orchestrates create/validate/queue/dispatch/cancel with mutex-protected event-driven dispatch -- 20 new tests, 55 total green**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-10T14:19:47Z
- **Completed:** 2026-03-10T14:25:53Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- JobExecutor handles full Maestro process lifecycle: platform-specific spawn args/env, line-by-line stdout parsing, timeout with SIGTERM->SIGKILL escalation, cancel via AbortSignal, temp dir management
- JobService orchestrates job creation with metadata validation, FIFO queue per platform, mutex-protected dispatch, background execution with error handling, and cancel for both queued and running jobs
- Fastify job plugin wires everything together with correct dependency chain; buildApp registers db and job plugins, health endpoint includes queue depth
- Event-driven dispatch ensures zero latency between device availability and job start

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement JobExecutor with tests** - `5787f08` (feat)
2. **Task 2: Implement JobService, job plugin, and wire into buildApp** - `307c2a9` (feat)

## Files Created/Modified
- `server/jobs/job-executor.ts` - Maestro process spawning, timeout, cancel, result collection (201 lines)
- `server/jobs/job-service.ts` - Central job orchestrator: create, queue, dispatch, cancel (341 lines)
- `server/jobs/plugin.ts` - Fastify plugin wiring JobService to app (30 lines)
- `server/jobs/__tests__/job-executor.test.ts` - 8 tests: spawn args, parsing, timeout, cancel, file management
- `server/jobs/__tests__/job-service.test.ts` - 12 tests: create, dispatch, cancel, mutex, queue depth, shutdown
- `server/index.ts` - Registers dbPlugin and jobPlugin, health includes queue depth, shutdown includes jobService

## Decisions Made
- JobExecutor uses `process.kill(-pid, 'SIGTERM')` for process group kill, ensuring both Maestro and its child processes (adb, instruments) are terminated
- Dispatch mutex is per-platform (not global) so Android dispatch doesn't block iOS dispatch
- Background execution always has `.catch` handler to prevent unhandled rejections (per RESEARCH pitfall 7)
- Job plugin declares dependencies on config, db, and pool-plugin to ensure correct initialization order

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Mock JobExecutor in service tests needed class-based mock (not `vi.fn().mockImplementation()`) for ESM constructor compatibility
- Cancel test for running jobs required a hanging mock executor (returning a promise that resolves only on abort signal) to prevent the job from completing before cancel is called

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- JobExecutor and JobService are ready for the REST API routes (Plan 03) to call createJob, cancelJob, getQueueDepth
- Job plugin is registered and decorated on Fastify -- routes can access via `fastify.jobService`
- Event-driven dispatch is wired -- device release triggers next job dispatch automatically
- All 55 tests green, providing regression safety for API integration

---
*Phase: 02-job-execution-and-api*
*Completed: 2026-03-10*

## Self-Check: PASSED
- All 5 source/test files exist
- Both task commits verified (5787f08, 307c2a9)
- Min line counts met: executor 201>=80, service 341>=120, plugin 30>=30
- 55/55 tests pass
