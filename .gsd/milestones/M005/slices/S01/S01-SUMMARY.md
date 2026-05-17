---
id: S01
parent: M005
milestone: M005
provides:
  - AppiumService for S02 (hierarchy source wiring)
  - isAvailable() for S02 (UI disabled state)
requires:
  []
affects:
  - S02
key_files:
  - server/maestro/appium-service.ts
  - server/maestro/__tests__/appium-service.test.ts
  - server/config/schema.ts
  - server/utils/dependency-checker.ts
  - server/maestro/plugin.ts
key_decisions:
  - Sessions cached per deviceId with 5min TTL
  - Injectable fetchFn for testability
  - Optional deps don't block startup
patterns_established:
  - Injectable fetch pattern for testable HTTP services
  - Optional dependency checking (warn, don't throw)
observability_surfaces:
  - Structured logs for session create/reuse/close/evict
  - getSessionCount() for diagnostics
  - isAvailable() for UI disabled state
drill_down_paths:
  - .gsd/milestones/M005/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M005/slices/S01/tasks/T02-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-03-26T21:55:26.399Z
blocker_discovered: false
---

# S01: Appium Session Manager

**AppiumService with session lifecycle, TTL, config, dependency checker, and 14 unit tests**

## What Happened

Built AppiumService with full session lifecycle management: create with W3C capabilities (UiAutomator2 for Android, XCUITest for iOS), cache per device, TTL eviction (5min default), session validation before reuse, getPageSource for hierarchy XML, releaseDevice for job conflicts, closeAllSessions on shutdown. Extended config schema, added optional dependency checking, registered in maestro plugin with onClose cleanup. 14 unit tests cover all paths.

## Verification

tsc clean. 34 files, 325 tests pass (14 new AppiumService tests).

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

Added appium config to 2 existing test mock configs.

## Known Limitations

None.

## Follow-ups

None.

## Files Created/Modified

- `server/maestro/appium-service.ts` — New: Appium session lifecycle manager with create/reuse/close/TTL/release/isAvailable
- `server/config/schema.ts` — Added appium config section (server_url, session_timeout_ms)
- `server/utils/dependency-checker.ts` — Added optional dependency checker (appium binary)
- `server/maestro/plugin.ts` — Registered AppiumService, added onClose hook, extended hierarchy source enum to 4 values
- `server/maestro/hierarchy-service.ts` — Extended HierarchySource type to include 'appium'
- `server/maestro/__tests__/appium-service.test.ts` — 14 unit tests for AppiumService
- `server/jobs/__tests__/job-service.test.ts` — Added appium config to mock
- `server/pool/__tests__/health-checker.test.ts` — Added appium config to mock
