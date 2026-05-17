---
phase: 12-device-management
plan: 01
subsystem: pool
tags: [device-stream, tango-adb, ios-simulator, device-driver, android-emulator]

# Dependency graph
requires:
  - phase: none
    provides: existing DeviceDriver interface and pool infrastructure
provides:
  - DeviceStreamAndroidDriver (hybrid: emulator spawning + TangoADB health)
  - DeviceStreamIosDriver (pure IOSSimulatorManager wrapper)
  - @device-stream packages installed and configured
affects: [12-device-management plan 02 (driver registration in plugin.ts)]

# Tech tracking
tech-stack:
  added: ["@device-stream/core@1.1.0", "@device-stream/android@1.1.0", "@device-stream/ios-simulator@1.1.0"]
  patterns: [hybrid-driver (retained process mgmt + device-stream health), pure-wrapper-driver (full delegation to device-stream)]

key-files:
  created:
    - .npmrc
    - server/pool/android/device-stream-driver.ts
    - server/pool/android/__tests__/device-stream-driver.test.ts
    - server/pool/ios/device-stream-driver.ts
    - server/pool/ios/__tests__/device-stream-driver.test.ts
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "Android driver is hybrid: retains emulator spawning/AVD/zombie logic, replaces only isHealthy with TangoADB listDevices"
  - "iOS driver is pure wrapper: all lifecycle delegated to IOSSimulatorManager"
  - "Installed @device-stream from local monorepo paths (not yet published to GitHub Packages)"
  - "iOS cleanup uses xcrun simctl erase (fast) instead of IOSSimulatorManager.deleteDevice (slow re-creation)"

patterns-established:
  - "Hybrid driver pattern: retain process management, delegate health/communication to device-stream"
  - "Pure wrapper pattern: full lifecycle delegation to device-stream manager"

requirements-completed: [DEV-01, DEV-02]

# Metrics
duration: 10min
completed: 2026-04-15
---

# Phase 12 Plan 01: Device-Stream Drivers Summary

**Hybrid Android driver with TangoADB health checks and pure iOS driver wrapping IOSSimulatorManager, both implementing DeviceDriver interface with 22 passing unit tests**

## Performance

- **Duration:** 10 min
- **Started:** 2026-04-16T01:30:14Z
- **Completed:** 2026-04-16T01:40:30Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- DeviceStreamAndroidDriver: hybrid approach retaining emulator spawning, port allocation, zombie detection, AVD management while replacing adb CLI health checks with AndroidDeviceService.listDevices() via TangoADB
- DeviceStreamIosDriver: pure wrapper delegating create/boot/shutdown/health to IOSSimulatorManager, with fast cleanup via xcrun simctl erase
- 22 unit tests (11 per driver) covering all DeviceDriver interface methods plus edge cases
- All 58 existing pool tests still pass (zero regressions)

## Task Commits

Each task was committed atomically:

1. **Task 1: Install device-stream packages + create DeviceStreamAndroidDriver with tests** - `b33a783` (feat)
2. **Task 2: Create DeviceStreamIosDriver with tests** - `fbf3f60` (feat)

## Files Created/Modified
- `.npmrc` - GitHub Packages registry for @device-stream scope
- `package.json` - Added @device-stream/core, @device-stream/android, @device-stream/ios-simulator
- `server/pool/android/device-stream-driver.ts` - Hybrid Android driver (emulator spawning + TangoADB health)
- `server/pool/android/__tests__/device-stream-driver.test.ts` - 11 Android driver unit tests
- `server/pool/ios/device-stream-driver.ts` - Pure iOS driver wrapping IOSSimulatorManager
- `server/pool/ios/__tests__/device-stream-driver.test.ts` - 11 iOS driver unit tests

## Decisions Made
- Android driver is hybrid because AndroidDeviceService has no emulator lifecycle management -- only ADB communication
- iOS driver is pure wrapper because IOSSimulatorManager provides complete lifecycle (create, boot, stop, delete)
- Installed packages from local monorepo paths since @device-stream not yet published to GitHub Packages
- iOS cleanup uses xcrun simctl erase for fast between-job reset instead of deleteDevice which destroys and re-creates

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] GitHub Packages auth -- installed from local monorepo**
- **Found during:** Task 1 (package installation)
- **Issue:** npm install @device-stream/* failed with 404 from GitHub Packages (packages not published)
- **Fix:** Installed from local paths (/Users/heicg/Desktop/projects/device-stream/packages/*)
- **Files modified:** package.json, package-lock.json
- **Verification:** Packages installed successfully, imports resolve
- **Committed in:** b33a783 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Package source changed from GitHub Packages to local -- functionally identical. No scope creep.

## Issues Encountered
- Vitest v4 dropped the `-x` flag; replaced with `--bail 1` for fail-fast behavior
- Shutdown tests hit 5s default timeout due to real setTimeout delays in zombie detection; added per-test timeout overrides
- Mock for net.connect needed to auto-trigger close callback to prevent snapshotRestore promise from hanging

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Both drivers ready to be wired into plugin.ts (Plan 02)
- Existing drivers (emulator.ts, simulator.ts) remain untouched -- swap happens in Plan 02
- PoolManager and HealthChecker unchanged, will work with new drivers via DeviceDriver interface

---
*Phase: 12-device-management*
*Completed: 2026-04-15*
