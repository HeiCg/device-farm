---
phase: 03-real-time-and-storage
plan: 03
subsystem: artifacts
tags: [ffmpeg, adb, xcrun, recording, screenshot, child_process, spawn, execFile]

requires:
  - phase: 03-real-time-and-storage
    provides: ArtifactType union and streaming types (Plan 01)
  - phase: 01-device-infrastructure
    provides: ProcessTracker for PID registration and process group kill
provides:
  - RecordingService -- ffmpeg pipe recording with start/stop/kill lifecycle
  - ScreenshotService -- platform-native screenshot capture (Android adb, iOS xcrun)
affects: [03-05, 03-06]

tech-stack:
  added: []
  patterns: ["Injectable spawn/execFile for testability", "Process group kill via negative PID", "image2pipe ffmpeg recording"]

key-files:
  created:
    - server/artifacts/recording-service.ts
    - server/artifacts/screenshot-service.ts
    - server/artifacts/__tests__/recording-service.test.ts
    - server/artifacts/__tests__/screenshot-service.test.ts
  modified: []

key-decisions:
  - "RecordingService uses injectable spawnFn matching ProcessTracker's injectable execFile pattern"
  - "ffmpeg spawned with detached:true for process group kill on cancel/timeout"
  - "Android screenshots use binary stdout buffer (encoding:buffer) with 10MB maxBuffer"

patterns-established:
  - "Injectable child_process functions (spawn, execFile) for unit test isolation without module mocking"
  - "Process group kill with try/catch ESRCH for idempotent cleanup"

requirements-completed: [REAL-04, REAL-05]

duration: 2min
completed: 2026-03-10
---

# Phase 3 Plan 03: Recording and Screenshot Services Summary

**ffmpeg pipe recording service and platform-native screenshot capture (adb/xcrun) with injectable process spawning and process group lifecycle management**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-10T22:39:18Z
- **Completed:** 2026-03-10T22:41:30Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- RecordingService manages ffmpeg lifecycle: start (spawn with image2pipe), stop (close stdin + await exit), kill (SIGTERM process group)
- ScreenshotService captures PNG screenshots via adb screencap (Android) and xcrun simctl (iOS)
- Both services use injectable process functions for clean unit testing without module-level mocking
- All 16 tests passing (11 recording + 5 screenshot)

## Task Commits

Each task was committed atomically:

1. **Task 1: RecordingService (RED)** - `479374f` (test)
2. **Task 1: RecordingService (GREEN)** - `9d3f44d` (feat)
3. **Task 2: ScreenshotService (RED)** - `4e180e8` (test)
4. **Task 2: ScreenshotService (GREEN)** - `a07d0ee` (feat)

## Files Created/Modified
- `server/artifacts/recording-service.ts` - ffmpeg pipe recording with start/stop/kill lifecycle and ProcessTracker integration
- `server/artifacts/screenshot-service.ts` - Platform-native screenshot capture with adb (Android) and xcrun simctl (iOS)
- `server/artifacts/__tests__/recording-service.test.ts` - 11 tests covering spawn args, stdin lifecycle, PID tracking, process group kill
- `server/artifacts/__tests__/screenshot-service.test.ts` - 5 tests covering Android/iOS capture, directory creation, error propagation

## Decisions Made
- RecordingService uses injectable spawnFn (same pattern as ProcessTracker's injectable execFile) for clean testability
- ffmpeg spawned with `detached: true` to enable process group kill via negative PID on cancel/timeout
- Android screenshots capture binary stdout with 10MB maxBuffer to handle high-resolution device screens
- ScreenshotService creates output directory recursively before writing (defensive for first-run scenarios)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- RecordingService ready to be wired into JobExecutor (Plan 05)
- ScreenshotService ready for on-failure screenshot capture in job execution
- Both services follow established injectable dependency pattern for integration testing

---
*Phase: 03-real-time-and-storage*
*Completed: 2026-03-10*
