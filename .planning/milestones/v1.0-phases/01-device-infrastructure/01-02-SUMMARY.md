---
phase: 01-device-infrastructure
plan: 02
subsystem: infra
tags: [state-machine, async-mutex, android-emulator, ios-simulator, avd, simctl, child-process, event-emitter]

# Dependency graph
requires:
  - phase: 01-device-infrastructure
    provides: "DeviceState enum, VALID_TRANSITIONS, DeviceInfo type from server/types/index.ts"
provides:
  - "Device class with state machine, transition guards, mutex-protected allocation, event emitter"
  - "DeviceDriver interface contract for platform-specific drivers"
  - "AndroidEmulatorDriver: AVD creation, headless boot, shutdown via process group kill, health check, snapshot cleanup"
  - "IosSimulatorDriver: simctl create/boot/shutdown, health via simctl list, cleanup via erase"
  - "Typed DeviceConfig (AndroidDeviceConfig, IosDeviceConfig) and BootOptions"
affects: [01-03-PLAN, 01-04-PLAN, 02-01-PLAN]

# Tech tracking
tech-stack:
  added: [async-mutex, net (telnet for emulator console)]
  patterns: [DeviceDriver interface pattern, process group kill (-pid), execFile for all binary calls, ADB output trimming]

key-files:
  created:
    - server/pool/types.ts
    - server/pool/device.ts
    - server/pool/android/avd.ts
    - server/pool/android/emulator.ts
    - server/pool/ios/simulator.ts
    - server/pool/__tests__/device-state.test.ts
    - server/pool/android/__tests__/emulator.test.ts
    - server/pool/ios/__tests__/simulator.test.ts
  modified: []

key-decisions:
  - "Device constructor uses positional args (name, platform) for simplicity over options object"
  - "Port allocation is sequential (5554, 5556, 5558...) with module-level counter to avoid collisions"
  - "Snapshot restore via telnet to emulator console with auth token; falls back to restart on failure"
  - "iOS cleanup uses shutdown+erase (no snapshot equivalent in simctl)"

patterns-established:
  - "DeviceDriver interface: create/boot/shutdown/isHealthy/cleanup -- all platform drivers implement this"
  - "Process group kill: spawn with detached:true, kill(-pid) for cleanup, ESRCH handling for already-dead"
  - "ADB output trimming: always .trim() on stdout to handle carriage returns from Android shell"
  - "Graceful error handling: already-booted simulators, already-dead processes, failed telnet connections"

requirements-completed: [INFRA-02, INFRA-03, INFRA-05]

# Metrics
duration: 5min
completed: 2026-03-10
---

# Phase 1 Plan 2: Device State Machine + Platform Drivers Summary

**Device state machine with mutex-protected allocation, Android emulator driver (AVD ARM64, headless boot, snapshot cleanup), and iOS simulator driver (simctl lifecycle with erase cleanup)**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-10T03:13:56Z
- **Completed:** 2026-03-10T03:19:02Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Device class with enforced state transitions, stateChange events, and mutex-protected allocate() preventing double-allocation
- AndroidEmulatorDriver handling full lifecycle: AVD creation (ARM64), headless boot with correct flags, boot detection via ADB polling with carriage return trimming, process group shutdown, snapshot restore via emulator console telnet
- IosSimulatorDriver handling full lifecycle: simctl create, boot with already-booted graceful handling, bootstatus wait, shutdown, health check via simctl list JSON parsing, erase for cleanup
- DeviceDriver interface as the single contract both platform drivers implement
- 28 unit tests covering state machine, mutex concurrency, and both drivers with mocked child_process

## Task Commits

Each task was committed atomically:

1. **Task 1: Device state machine + DeviceDriver interface** - `04fbca5` (feat)
2. **Task 2: Android emulator driver + iOS simulator driver** - `e3b29ef` (feat)

_Note: TDD tasks -- tests written alongside implementation, committed together._

## Files Created/Modified
- `server/pool/types.ts` - DeviceDriver interface, BootOptions, AndroidDeviceConfig, IosDeviceConfig types
- `server/pool/device.ts` - Device class with state machine, mutex allocation, event emitter, toInfo()
- `server/pool/android/avd.ts` - ensureAvdExists and listAvds utilities using execFile
- `server/pool/android/emulator.ts` - AndroidEmulatorDriver implementing DeviceDriver (boot, shutdown, health, cleanup)
- `server/pool/ios/simulator.ts` - IosSimulatorDriver implementing DeviceDriver (boot, shutdown, health, cleanup)
- `server/pool/__tests__/device-state.test.ts` - 9 tests for state machine transitions, events, mutex, toInfo
- `server/pool/android/__tests__/emulator.test.ts` - 9 tests for Android driver with mocked execFile/spawn
- `server/pool/ios/__tests__/simulator.test.ts` - 10 tests for iOS driver with mocked execFile

## Decisions Made
- **Device constructor signature:** Used positional args `(name, platform)` instead of options object for simplicity and natural usage in tests and pool manager code.
- **Port allocation strategy:** Module-level sequential counter starting at 5554 (incrementing by 2) avoids port collision between emulator instances.
- **Snapshot restore approach:** Telnet to emulator console port, send auth token + `avd snapshot load clean_snapshot`, fall back to full restart on any failure (per RESEARCH open question 1 recommendation).
- **iOS cleanup:** Shutdown then erase since simctl has no snapshot equivalent.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Device constructor to use positional args**
- **Found during:** Task 1 (Device state machine)
- **Issue:** Prior implementation used options object constructor, but plan specifies simpler positional (name, platform) pattern
- **Fix:** Changed constructor to `(name: string, platform: Platform, options?)`
- **Files modified:** server/pool/device.ts
- **Verification:** All 9 device state tests pass
- **Committed in:** 04fbca5

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Constructor signature change aligns with plan intent. No scope creep.

## Issues Encountered
- Pre-existing test failure in `server/pool/__tests__/process-tracker.test.ts` (scanOrphans test) -- out of scope for this plan, logged as deferred item.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Device class and DeviceDriver interface ready for Pool Manager to orchestrate (01-03)
- Both platform drivers ready for health check integration (01-03)
- Process tracking in emulator driver ready for process-tracker integration (01-04)
- All RESEARCH.md pitfalls (carriage returns, port collision, already-booted, ESRCH) are handled

## Self-Check: PASSED

All 9 created files verified on disk. Both task commits (04fbca5, e3b29ef) verified in git log.

---
*Phase: 01-device-infrastructure*
*Completed: 2026-03-10*
