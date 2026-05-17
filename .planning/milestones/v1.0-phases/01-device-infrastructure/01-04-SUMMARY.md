---
phase: 01-device-infrastructure
plan: 04
subsystem: infra
tags: [health-checker, exponential-backoff, graceful-shutdown, cleanup, device-recovery, pino, fastify]

# Dependency graph
requires:
  - phase: 01-device-infrastructure
    provides: "PoolManager with FIFO allocation, ProcessTracker with orphan reaper, Device state machine, platform drivers"
provides:
  - "HealthChecker with exponential backoff recovery (5s, 15s, 45s) and full wipe on 3rd attempt"
  - "Complete server entry point with all plugins wired and graceful shutdown"
  - "Cleanup integration: Android snapshot restore, iOS shutdown+erase during pool release"
  - "GET /api/health and GET /api/devices routes"
affects: [02-01-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns: [Exponential backoff with failure counter, Graceful shutdown with job drain timeout, Health check parallel via Promise.allSettled]

key-files:
  created:
    - server/pool/health-checker.ts
    - server/pool/__tests__/health-checker.test.ts
    - server/pool/__tests__/cleanup.test.ts
  modified:
    - server/index.ts
    - server/pool/plugin.ts
    - server/pool/pool-manager.ts
    - server/types/index.ts

key-decisions:
  - "Failure count resets only when isHealthy returns true, not on successful restart -- ensures persistent failures are tracked across recovery attempts"
  - "Added Idle -> Error state transition to support health checker marking idle devices as unhealthy"
  - "Pool plugin registers platform drivers and exposes processTracker/healthChecker on Fastify instance"

patterns-established:
  - "Exponential backoff: BACKOFF_DELAYS array indexed by failure count, 3rd attempt includes full wipe"
  - "Graceful shutdown sequence: stop accepting -> stop health checker -> stop reaper -> wait for jobs (5min) -> kill devices -> close DB -> exit 0"
  - "Health check parallel: Promise.allSettled across all non-offline devices for fault isolation"

requirements-completed: [INFRA-04, INFRA-07]

# Metrics
duration: 4min
completed: 2026-03-10
---

# Phase 1 Plan 4: Health Checker + Server Wiring Summary

**Periodic health checker with 3-attempt exponential backoff recovery (5s/15s/45s, 3rd with full wipe), cleanup integration for Android/iOS, and complete server wiring with graceful shutdown**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-10T03:22:49Z
- **Completed:** 2026-03-10T03:27:09Z
- **Tasks:** 2
- **Files modified:** 7 (3 created, 4 modified)

## Accomplishments
- HealthChecker that checks all non-offline devices in parallel, with exponential backoff recovery (5s, 15s, 45s delays) and full wipe on 3rd attempt
- Running devices that fail health check transition to Error immediately (no restart -- fails job with infrastructure error)
- After 3 failed recovery attempts, device goes Offline and pool continues with remaining devices
- Complete server entry point with startup sequence: config -> dependency check -> orphan reap -> pool init -> health checker start -> process reaper start
- Graceful shutdown: stop accepting connections, stop health checker, stop reaper, wait up to 5 minutes for running jobs, kill all emulators, close DB, exit 0
- 13 new tests (9 health checker + 4 cleanup), all 74 tests in suite passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Health checker with exponential backoff recovery** - `4875dae` (feat)
2. **Task 2: Server wiring + Graceful shutdown + Cleanup integration** - `ebc431b` (feat)

_Note: Task 1 followed TDD -- tests written first (RED), then implementation (GREEN)._

## Files Created/Modified
- `server/pool/health-checker.ts` - HealthChecker class: parallel checks, exponential backoff, full wipe on 3rd attempt, start/stop
- `server/pool/__tests__/health-checker.test.ts` - 9 tests: healthy/unhealthy devices, backoff delays, wipe, offline transition, running device error, parallel checks, start/stop
- `server/pool/__tests__/cleanup.test.ts` - 4 tests: Android snapshot cleanup, iOS shutdown+erase, cleanup failure fallback, release flow integration
- `server/index.ts` - Full server wiring: config -> deps -> pool plugin -> onReady startup sequence -> routes -> graceful shutdown
- `server/pool/plugin.ts` - Updated to register platform drivers, expose processTracker and healthChecker on Fastify instance
- `server/pool/pool-manager.ts` - Added getDeviceMap() and getDriver() accessors for health checker
- `server/types/index.ts` - Added Idle -> Error transition for health checker recovery

## Decisions Made
- **Failure count reset policy:** Failure count resets only when isHealthy() returns true on a subsequent check cycle, not when a restart boot succeeds. This ensures that a device which boots but immediately fails health again is tracked correctly through the escalation path.
- **Idle -> Error transition:** Added to VALID_TRANSITIONS to allow health checker to mark idle devices as unhealthy. Without this, the health checker couldn't transition non-running devices through the Error -> Booting recovery path.
- **Plugin-level driver registration:** Moved platform driver registration into the pool plugin (previously not wired). Plugin now creates drivers based on config and exposes all pool-related decorators (pool, processTracker, healthChecker) on the Fastify instance.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added Idle -> Error state transition**
- **Found during:** Task 1 (Health checker implementation)
- **Issue:** VALID_TRANSITIONS did not include Idle -> Error. Health checker needs to transition idle devices to Error when they fail health checks, before attempting the Error -> Booting recovery path.
- **Fix:** Added DeviceState.Error to the Idle transitions array in VALID_TRANSITIONS.
- **Files modified:** server/types/index.ts
- **Verification:** All 74 tests pass including health checker scenarios
- **Committed in:** 4875dae

**2. [Rule 3 - Blocking] Added PoolManager accessor methods for HealthChecker**
- **Found during:** Task 1 (Health checker implementation)
- **Issue:** PoolManager's devices and drivers Maps were private with no accessors. HealthChecker needs to iterate devices and get platform drivers.
- **Fix:** Added getDeviceMap() and getDriver(platform) public methods to PoolManager.
- **Files modified:** server/pool/pool-manager.ts
- **Verification:** Health checker tests use these methods successfully
- **Committed in:** 4875dae

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes were necessary to enable health checker functionality. Minimal API surface additions. No scope creep.

## Issues Encountered
- Pre-existing pino type compatibility errors in test files (Logger<never> vs Logger<string>) -- out of scope, does not affect runtime or test execution.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 1 (Device Infrastructure) is fully complete
- All device lifecycle operations are implemented: boot, health check, recovery, cleanup, shutdown
- Server is production-ready with graceful shutdown and health monitoring
- Ready for Phase 2 (Job Execution Engine) which will use pool allocation and device management

---
*Phase: 01-device-infrastructure*
*Completed: 2026-03-10*
