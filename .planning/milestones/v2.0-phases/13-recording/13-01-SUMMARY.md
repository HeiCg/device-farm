---
phase: 13-recording
plan: 01
subsystem: recording
tags: [device-stream, ffmpeg, h264, mjpeg, recording-session, frame-source]

requires:
  - phase: 12-device-management
    provides: device-stream driver integration (ScrcpyService, CaptureService available)
provides:
  - RecordingService wrapping device-stream RecordingSession
  - Platform-specific FrameSource selection (H264 for Android, MJPEG for iOS)
  - PlatformServices interface for dependency injection
affects: [13-02-integration, jobs, artifacts]

tech-stack:
  added: ["@device-stream/core RecordingSession", "@device-stream/android H264FrameSource", "@device-stream/ios-simulator MJPEGFrameSource"]
  patterns: [platform-codec-dispatch, frame-source-abstraction, recording-session-lifecycle]

key-files:
  created: []
  modified:
    - server/artifacts/recording-service.ts
    - server/artifacts/__tests__/recording-service.test.ts
    - server/jobs/job-service.ts

key-decisions:
  - "ProcessTracker kept in constructor for backward compat but unused (RecordingSession manages ffmpeg lifecycle)"
  - "Job-service call site updated with TODO for plan 02 integration (services not yet wired)"

patterns-established:
  - "Platform dispatch: codec and FrameSource selected by platform string ('android' | 'ios')"
  - "PlatformServices interface: optional scrcpyService/captureService for constructor injection"

requirements-completed: [REC-01, REC-02]

duration: 6min
completed: 2026-04-16
---

# Phase 13 Plan 01: Recording Service Rewrite Summary

**RecordingService rewritten to use device-stream RecordingSession with H264 passthrough for Android and MJPEG re-encode for iOS**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-16T02:41:54Z
- **Completed:** 2026-04-16T02:48:02Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Replaced raw ffmpeg spawn with device-stream RecordingSession abstraction
- Android recordings use H264FrameSource (zero CPU cost, scrcpy passthrough)
- iOS recordings use MJPEGFrameSource (ScreenCaptureKit JPEG to H.264 re-encode)
- 8 unit tests covering both platforms, error cases, stop/kill/isRecording
- Full test suite passes (344 tests, 0 regressions)

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite RecordingService to use RecordingSession + FrameSource** - `1f8feaa` (feat)
2. **Task 2: Rewrite recording-service unit tests for new API** - `748208e` (test)

## Files Created/Modified
- `server/artifacts/recording-service.ts` - Rewritten to use RecordingSession + platform FrameSource dispatch
- `server/artifacts/__tests__/recording-service.test.ts` - 8 new tests with vi.mock for device-stream packages
- `server/jobs/job-service.ts` - Call site updated for new async API (TODO for 13-02 service wiring)

## Decisions Made
- ProcessTracker parameter kept in constructor for backward compatibility but not used (RecordingSession handles ffmpeg lifecycle with 5s timeout + SIGKILL escalation)
- Job-service call site updated minimally with TODO marker for plan 02 integration

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated job-service.ts call site for new API**
- **Found during:** Task 1 (RecordingService rewrite)
- **Issue:** job-service.ts called old startRecording(jobId, path) which no longer exists
- **Fix:** Updated to new async signature with platform/serial/services params and TODO for plan 02
- **Files modified:** server/jobs/job-service.ts
- **Verification:** Full test suite passes (344 tests)
- **Committed in:** 1f8feaa (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary to prevent type/runtime errors. No scope creep.

## Issues Encountered
- vi.mock hoisting required vi.hoisted() for mock constructor variables (standard Vitest pattern)
- Mock constructors needed `function(this)` pattern to work with `new` operator

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- RecordingService ready for integration in plan 02
- Plan 02 will wire ScrcpyService and CaptureService through artifact-plugin and job-service
- PlatformServices interface provides clean injection point

---
*Phase: 13-recording*
*Completed: 2026-04-16*
