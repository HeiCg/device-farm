---
phase: 03-real-time-and-storage
plan: 06
subsystem: lifecycle, storage
tags: [node-cron, ffmpeg, compression, retention, disk-pressure, lifecycle, artifacts]

requires:
  - phase: 03-real-time-and-storage
    provides: ArtifactService CRUD, unified artifacts DB table with compressed/compressedAt columns
  - phase: 01-device-infrastructure
    provides: Config schema with storage.artifacts settings (retention_days, compress_after_days, max_storage_gb)
provides:
  - Compression task (ffmpeg re-encode old videos at CRF 35, 720p, no audio)
  - Retention task (delete expired artifacts from filesystem and DB)
  - Disk pressure task (delete oldest artifacts when over max_storage_gb)
  - Lifecycle Fastify plugin with cron scheduling (daily at 3AM, hourly disk check)
  - Health endpoint lifecycle stats integration
affects: [04-cli, 05-web-dashboard]

tech-stack:
  added: []
  patterns: ["Injectable deps (spawnFn, statFn, rmFn) for lifecycle task testability", "Mutex-protected cron tasks to prevent overlapping runs", "LifecycleStats decoration on Fastify for health endpoint access"]

key-files:
  created:
    - server/lifecycle/compression-task.ts
    - server/lifecycle/retention-task.ts
    - server/lifecycle/disk-pressure-task.ts
    - server/lifecycle/lifecycle-plugin.ts
    - server/lifecycle/__tests__/compression-task.test.ts
    - server/lifecycle/__tests__/retention-task.test.ts
    - server/lifecycle/__tests__/disk-pressure-task.test.ts
  modified:
    - server/api/routes.ts
    - server/index.ts

key-decisions:
  - "Injectable deps pattern (spawnFn, statFn, rmFn) for all lifecycle tasks -- enables unit testing without filesystem or process mocking"
  - "Single mutex shared across all lifecycle cron tasks to prevent overlapping compression/retention/disk-pressure runs"
  - "Lifecycle stats tracked in-memory via Fastify decoration, exposed in health endpoint conditionally"
  - "Directory cleanup after retention uses force rm with error swallowing (directory may still have artifacts)"

patterns-established:
  - "Injectable dependency objects for system-level operations (spawn, stat, rm) matching ProcessTracker pattern"
  - "Conditional health endpoint extension: check for decoration existence before including in response"

requirements-completed: [STOR-02, STOR-03, STOR-04]

duration: 5min
completed: 2026-03-10
---

# Phase 3 Plan 06: Artifact Lifecycle Automation Summary

**Automated video compression (ffmpeg CRF 35), artifact retention deletion, and disk pressure monitoring with node-cron scheduling and health endpoint integration**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-10T22:56:56Z
- **Completed:** 2026-03-10T23:01:37Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Built three lifecycle tasks: compression (ffmpeg re-encode), retention (expired artifact cleanup), disk pressure (oldest-first deletion when over limit)
- All tasks use injectable dependencies for clean unit testing without filesystem or process mocking
- Lifecycle Fastify plugin schedules compression+retention daily at 3AM and disk pressure hourly via node-cron
- All cron tasks share a single async-mutex to prevent overlapping runs
- Health endpoint conditionally includes lifecycle stats (last run timestamps and results)
- All 244 tests pass across 27 test files

## Task Commits

Each task was committed atomically:

1. **Task 1: Compression, retention, disk pressure tasks (RED)** - `b5a3a4a` (test)
2. **Task 1: Compression, retention, disk pressure tasks (GREEN)** - `09092bb` (feat)
3. **Task 2: Lifecycle plugin with cron scheduling and health integration** - `b0880d2` (feat)

## Files Created/Modified
- `server/lifecycle/compression-task.ts` - Find and re-encode old video artifacts via ffmpeg (slow preset, CRF 35, 720p, no audio)
- `server/lifecycle/retention-task.ts` - Delete expired artifacts from filesystem and DB, clean empty job directories
- `server/lifecycle/disk-pressure-task.ts` - Monitor disk usage via DB aggregation, delete oldest artifacts when over limit
- `server/lifecycle/lifecycle-plugin.ts` - Fastify plugin with node-cron schedules, mutex protection, LifecycleStats decoration
- `server/lifecycle/__tests__/compression-task.test.ts` - 3 tests: success, ffmpeg failure, empty result
- `server/lifecycle/__tests__/retention-task.test.ts` - 3 tests: deletion, error resilience, empty result
- `server/lifecycle/__tests__/disk-pressure-task.test.ts` - 3 tests: over-limit cleanup, under-limit no-op, delete errors
- `server/api/routes.ts` - Health endpoint enhanced with conditional lifecycle stats
- `server/index.ts` - Lifecycle plugin registered after job plugin

## Decisions Made
- Injectable deps pattern (spawnFn, statFn, rmFn) for lifecycle tasks, matching the ProcessTracker injectable execFile pattern from Phase 1
- Single mutex shared across all lifecycle cron tasks prevents overlapping runs (per RESEARCH pitfall 7)
- Lifecycle stats stored in-memory and exposed via Fastify decoration -- no separate DB table needed
- Health endpoint checks for lifecycleStats existence before including, maintaining backwards compatibility

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 3 (Real-Time and Storage) is now fully complete
- All 12 requirements (REAL-01 through REAL-07, STOR-01 through STOR-05) implemented
- Ready for Phase 4 (CLI) and Phase 5 (Web Dashboard) which can run in parallel

## Self-Check: PASSED

All 7 created files verified present. All 3 commits (b5a3a4a, 09092bb, b0880d2) verified in git log.

---
*Phase: 03-real-time-and-storage*
*Completed: 2026-03-10*
