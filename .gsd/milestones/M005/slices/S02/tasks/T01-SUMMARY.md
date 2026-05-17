---
id: T01
parent: S02
milestone: M005
provides: []
requires: []
affects: []
key_files: ["server/maestro/hierarchy-service.ts", "server/maestro/plugin.ts"]
key_decisions: ["AppiumService injected into HierarchyService constructor (optional)", "Android: reuses existing parseUiautomatorXml for Appium page source", "iOS: new parseXcuiTestXml parser for XCUITest XML format", "/api/appium/status endpoint for UI to check availability"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "tsc clean. 325/325 tests pass."
completed_at: 2026-03-26T21:58:34.526Z
blocker_discovered: false
---

# T01: Wired Appium into HierarchyService with Android XML reuse + new iOS XCUITest parser + /api/appium/status

> Wired Appium into HierarchyService with Android XML reuse + new iOS XCUITest parser + /api/appium/status

## What Happened
---
id: T01
parent: S02
milestone: M005
key_files:
  - server/maestro/hierarchy-service.ts
  - server/maestro/plugin.ts
key_decisions:
  - AppiumService injected into HierarchyService constructor (optional)
  - Android: reuses existing parseUiautomatorXml for Appium page source
  - iOS: new parseXcuiTestXml parser for XCUITest XML format
  - /api/appium/status endpoint for UI to check availability
duration: ""
verification_result: passed
completed_at: 2026-03-26T21:58:34.527Z
blocker_discovered: false
---

# T01: Wired Appium into HierarchyService with Android XML reuse + new iOS XCUITest parser + /api/appium/status

**Wired Appium into HierarchyService with Android XML reuse + new iOS XCUITest parser + /api/appium/status**

## What Happened

Added 'appium' case to HierarchyService.fetchBySource(). For Android, reuses existing parseUiautomatorXml since Appium returns the same XML format. For iOS, added new parseXcuiTestXml parser that handles XCUITest XML attributes (type, name, label, value, x/y/width/height → bounds). AppiumService injected via constructor. Added /api/appium/status endpoint returning availability and session count.

## Verification

tsc clean. 325/325 tests pass.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npx tsc --noEmit` | 0 | ✅ pass | 4600ms |
| 2 | `npm test` | 0 | ✅ pass — 325/325 | 8500ms |


## Deviations

Had to reorder variable declarations in plugin to avoid TDZ error.

## Known Issues

None.

## Files Created/Modified

- `server/maestro/hierarchy-service.ts`
- `server/maestro/plugin.ts`


## Deviations
Had to reorder variable declarations in plugin to avoid TDZ error.

## Known Issues
None.
