---
phase: 14-fix-device-preview-pipeline
plan: 01
subsystem: streaming
tags: [scrcpy, screencapturekit, websocket, h264, mjpeg, preview, adapter-pattern]

requires:
  - phase: 13-recording
    provides: ScrcpyService and CaptureService singletons as Fastify decorators
provides:
  - AndroidPreviewAdapter tapping into ScrcpyService recording callback with callback chaining
  - IosPreviewAdapter listening on CaptureService frameData events filtered by deviceId
  - createAdapterFactory function returning platform-specific adapters
  - DevicePreviewManager.setAdapterFactory for post-construction injection
  - Adapter factory wired in job-plugin at startup
affects: [device-preview, job-execution, websocket-streaming]

tech-stack:
  added: []
  patterns: [adapter-pattern, callback-chaining, event-emitter-filtering, post-construction-injection]

key-files:
  created:
    - server/streaming/adapters/android-preview-adapter.ts
    - server/streaming/adapters/ios-preview-adapter.ts
    - server/streaming/adapters/index.ts
    - server/streaming/__tests__/android-preview-adapter.test.ts
    - server/streaming/__tests__/ios-preview-adapter.test.ts
    - server/streaming/__tests__/adapter-factory.test.ts
  modified:
    - server/streaming/device-preview.ts
    - server/jobs/plugin.ts

key-decisions:
  - "Android adapter chains callbacks (preserves existing onPacket for recording) instead of overwriting"
  - "iOS adapter uses EventEmitter on('frameData') instead of setFrameCallback to support multiple listeners"
  - "setAdapterFactory uses (this as any) cast to bypass readonly for post-construction injection"

patterns-established:
  - "Callback chaining: save existing callback, invoke it first, then add new behavior"
  - "EventEmitter filtering: listen on shared event, filter by deviceId in handler"

requirements-completed: []

duration: 5min
completed: 2026-04-16
---

# Phase 14 Plan 01: Device Preview Pipeline Summary

**Platform-specific preview adapters (Android H.264 via ScrcpyService, iOS JPEG via CaptureService) wired into DevicePreviewManager via adapter factory pattern**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-16T03:48:04Z
- **Completed:** 2026-04-16T03:53:00Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- AndroidPreviewAdapter chains recording callbacks so preview and recording coexist without conflict
- IosPreviewAdapter decodes base64 JPEG frames to Buffer, filtering by deviceId via EventEmitter
- Adapter factory wired in job-plugin connects ScrcpyService and CaptureService to DevicePreviewManager at startup
- 16 new unit tests covering all adapter behaviors, all 360 tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Create preview adapters and adapter factory with tests** - `e1453c8` (feat)
2. **Task 2: Add setAdapterFactory to DevicePreviewManager and wire in job-plugin** - `57b3d24` (feat)

## Files Created/Modified
- `server/streaming/adapters/android-preview-adapter.ts` - AndroidPreviewAdapter with ScrcpyService callback chaining
- `server/streaming/adapters/ios-preview-adapter.ts` - IosPreviewAdapter with CaptureService frameData event filtering
- `server/streaming/adapters/index.ts` - createAdapterFactory returning correct adapter per platform
- `server/streaming/__tests__/android-preview-adapter.test.ts` - 7 tests for Android adapter
- `server/streaming/__tests__/ios-preview-adapter.test.ts` - 6 tests for iOS adapter
- `server/streaming/__tests__/adapter-factory.test.ts` - 3 tests for factory function
- `server/streaming/device-preview.ts` - Added setAdapterFactory method
- `server/jobs/plugin.ts` - Wired createAdapterFactory at plugin registration

## Decisions Made
- Android adapter chains callbacks (saves existing onPacket, calls it first, then preview handler) to preserve recording
- iOS adapter uses EventEmitter on('frameData') rather than setFrameCallback to avoid overwriting other consumers
- setAdapterFactory uses `(this as any)` cast to bypass readonly constraint for post-construction injection (websocket-plugin registers before artifact-plugin)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- INTG-01 (adapter factory missing) and FLOW-01 (preview delivers no frames) gaps are closed
- Preview pipeline fully connected: job-plugin -> adapter factory -> platform adapters -> ScrcpyService/CaptureService
- Ready for end-to-end preview testing with live device sessions

---
## Self-Check: PASSED

All 8 files verified present. Both task commits (e1453c8, 57b3d24) verified in git log.

---
*Phase: 14-fix-device-preview-pipeline*
*Completed: 2026-04-16*
