---
id: T01
parent: S01
milestone: M005
provides: []
requires: []
affects: []
key_files: ["server/maestro/appium-service.ts", "server/config/schema.ts", "server/utils/dependency-checker.ts", "server/maestro/plugin.ts", "server/maestro/hierarchy-service.ts"]
key_decisions: ["Sessions cached per deviceId with TTL eviction on access", "Session validation via GET /session/:id before reuse", "60s timeout on session creation (UIA2 server install can be slow)", "Dependency checker has optional deps (appium) that warn but don't throw", "HierarchySource union type extended to 4 values", "onClose hook auto-closes all sessions on server shutdown"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "tsc clean. 311/311 tests pass."
completed_at: 2026-03-26T21:54:03.003Z
blocker_discovered: false
---

# T01: AppiumService with session lifecycle + config + dependency checker + plugin registration

> AppiumService with session lifecycle + config + dependency checker + plugin registration

## What Happened
---
id: T01
parent: S01
milestone: M005
key_files:
  - server/maestro/appium-service.ts
  - server/config/schema.ts
  - server/utils/dependency-checker.ts
  - server/maestro/plugin.ts
  - server/maestro/hierarchy-service.ts
key_decisions:
  - Sessions cached per deviceId with TTL eviction on access
  - Session validation via GET /session/:id before reuse
  - 60s timeout on session creation (UIA2 server install can be slow)
  - Dependency checker has optional deps (appium) that warn but don't throw
  - HierarchySource union type extended to 4 values
  - onClose hook auto-closes all sessions on server shutdown
duration: ""
verification_result: passed
completed_at: 2026-03-26T21:54:03.003Z
blocker_discovered: false
---

# T01: AppiumService with session lifecycle + config + dependency checker + plugin registration

**AppiumService with session lifecycle + config + dependency checker + plugin registration**

## What Happened

Created AppiumService with full session lifecycle: create with W3C capabilities (UiAutomator2 for Android, XCUITest for iOS), cache per device, TTL eviction (5min default), session validation on reuse, getPageSource, closeSession, releaseDevice, closeAllSessions. Extended config schema with appium section (server_url, session_timeout_ms). Added optional dependency checking for appium binary. Registered in maestro/plugin.ts with onClose cleanup hook. Extended HierarchySource type to include 'appium'. Updated hierarchy route schema validation to accept 4 sources.

## Verification

tsc clean. 311/311 tests pass.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npx tsc --noEmit` | 0 | ✅ pass | 3800ms |
| 2 | `npm test` | 0 | ✅ pass — 311/311 | 8400ms |


## Deviations

Had to add appium config key to 2 test mock configs.

## Known Issues

None.

## Files Created/Modified

- `server/maestro/appium-service.ts`
- `server/config/schema.ts`
- `server/utils/dependency-checker.ts`
- `server/maestro/plugin.ts`
- `server/maestro/hierarchy-service.ts`


## Deviations
Had to add appium config key to 2 test mock configs.

## Known Issues
None.
