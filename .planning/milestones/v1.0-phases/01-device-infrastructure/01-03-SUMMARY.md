---
phase: 01-device-infrastructure
plan: 03
subsystem: infra
tags: [pool-manager, process-tracker, fifo-allocation, mutex, async-mutex, orphan-reaper, pino, fastify-plugin]

# Dependency graph
requires:
  - phase: 01-device-infrastructure
    provides: "Device class with state machine, DeviceDriver interface, DeviceState enum, VALID_TRANSITIONS"
provides:
  - "PoolManager class with FIFO device allocation, mutex-protected concurrency, release flow"
  - "ProcessTracker with PID registry, process group kill, orphan reaper"
  - "Fastify pool plugin decorating server with pool manager"
affects: [01-04-PLAN, 02-01-PLAN]

# Tech tracking
tech-stack:
  added: [pino]
  patterns: [Dependency injection for testability (execFile), Pool-level mutex for allocation, Process group kill via negative PID]

key-files:
  created:
    - server/pool/pool-manager.ts
    - server/pool/process-tracker.ts
    - server/pool/plugin.ts
    - server/pool/__tests__/allocation.test.ts
    - server/pool/__tests__/process-tracker.test.ts
  modified: []

key-decisions:
  - "Pool-level mutex for allocation instead of per-device: prevents FIFO ordering violations from concurrent requests"
  - "Injectable execFile in ProcessTracker for clean testability without module-level mocking"
  - "Process group kill (negative PID) for clean emulator shutdown including child processes"

patterns-established:
  - "Pool-level mutex: all allocation requests serialize through a single async-mutex to guarantee FIFO and prevent double-allocation"
  - "Process group kill: kill(-pid, SIGTERM) then escalate to SIGKILL after 5s timeout"
  - "Constructor injection for system dependencies: ProcessTracker accepts optional execFile function for testability"

requirements-completed: [INFRA-06, INFRA-08]

# Metrics
duration: 5min
completed: 2026-03-10
---

# Phase 1 Plan 3: Pool Manager + Process Tracker Summary

**FIFO device allocation with mutex-protected concurrency, process group tracker with orphan reaper, and Fastify pool plugin**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-10T03:14:09Z
- **Completed:** 2026-03-10T03:19:55Z
- **Tasks:** 2
- **Files modified:** 5 created

## Accomplishments
- PoolManager with FIFO allocation by platform, mutex-protected to prevent concurrent double-allocation
- ProcessTracker that registers device PIDs, kills by process group (negative PID), handles ESRCH gracefully
- Orphan reaper that periodically scans for leaked emulator/qemu processes and kills them
- Fastify plugin wiring pool manager into server lifecycle with clean shutdown
- 21 passing unit tests across both test suites

## Task Commits

Each task was committed atomically:

1. **Task 1: Pool Manager with FIFO allocation** - `7779620` (feat)
2. **Task 2: Process tracker + Orphan reaper** - `261ee79` (feat)

_Note: TDD tasks -- tests written first (RED), then implementation (GREEN), committed together._

## Files Created/Modified
- `server/pool/pool-manager.ts` - PoolManager class: device registry, FIFO allocation, release flow, initPool, shutdown
- `server/pool/process-tracker.ts` - ProcessTracker class: PID registry, process group kill, orphan scanner/reaper
- `server/pool/plugin.ts` - Fastify plugin decorating server with pool manager, onClose shutdown hook
- `server/pool/__tests__/allocation.test.ts` - 9 tests: FIFO order, concurrency, platform filtering, release flow
- `server/pool/__tests__/process-tracker.test.ts` - 12 tests: register/unregister, kill signals, ESRCH, orphan scan, reaper

## Decisions Made
- **Pool-level mutex for allocation:** Used a single async-mutex at the PoolManager level (not per-device) to serialize all allocation requests. This ensures FIFO ordering is preserved even under concurrent load -- per-device mutex would only prevent double-allocation of one device but not enforce ordering across devices.
- **Injectable execFile for ProcessTracker:** Instead of module-level mocking (which conflicts with promisify at import time), the ProcessTracker accepts an optional execFile function in its constructor. Default uses Node's promisified execFile; tests inject a mock. Clean and avoids brittle module mocks.
- **Process group kill pattern:** Using `process.kill(-pid, 'SIGTERM')` to kill the entire process group, not just the emulator process. This ensures child processes (ADB server forks, GPU processes) are also terminated. SIGKILL escalation after 5s for stubborn processes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed ProcessTracker testability with dependency injection**
- **Found during:** Task 2 (Process tracker tests)
- **Issue:** Module-level `promisify(execFile)` captured the real function at import time, making vi.mock ineffective. scanOrphans tests timed out because the mock never intercepted.
- **Fix:** Changed ProcessTracker to accept an optional `execFile` function via constructor injection. Tests pass a mock directly instead of relying on module mocking.
- **Files modified:** server/pool/process-tracker.ts, server/pool/__tests__/process-tracker.test.ts
- **Verification:** All 12 process tracker tests pass, including scanOrphans mock test
- **Committed in:** 261ee79

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Auto-fix improved testability without changing public API. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviation above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Pool manager ready to receive health check integration (Plan 04)
- Process tracker ready for device boot PID registration
- Plugin ready to be registered in server/index.ts
- All interfaces stable for Plan 04 health check + recovery system

---
*Phase: 01-device-infrastructure*
*Completed: 2026-03-10*
