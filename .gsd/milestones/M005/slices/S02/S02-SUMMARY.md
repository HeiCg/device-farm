---
id: S02
parent: M005
milestone: M005
provides:
  - (none)
requires:
  - slice: S01
    provides: AppiumService with session lifecycle
affects:
  []
key_files:
  - server/maestro/hierarchy-service.ts
  - server/maestro/plugin.ts
  - web/src/lib/components/inspector/SourceSelector.svelte
key_decisions:
  - Android reuses existing UiAutomator XML parser for Appium source
  - iOS gets new XCUITest XML parser
  - SourceSelector checks /api/appium/status on mount for disabled state
patterns_established:
  - XCUITest XML parser for iOS Appium page source
observability_surfaces:
  - Hierarchy result includes source='appium' and fetchTimeMs
  - /api/appium/status endpoint
drill_down_paths:
  - .gsd/milestones/M005/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M005/slices/S02/tasks/T02-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-03-26T21:59:50.242Z
blocker_discovered: false
---

# S02: Hierarchy Source + UI Integration

**Appium wired as 4th hierarchy source with iOS XCUITest parser + SourceSelector disabled state**

## What Happened

Wired Appium into the hierarchy pipeline. HierarchyService now handles 'appium' source: creates/reuses Appium session, fetches page source XML, parses with existing UiAutomator parser (Android) or new XCUITest parser (iOS). SourceSelector shows 4 options with disabled state and install hint when Appium is unavailable. /api/appium/status endpoint provides availability check for the UI.

## Verification

svelte-check 0 errors. Web build clean. 325/325 tests.

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

None.

## Known Limitations

None.

## Follow-ups

None.

## Files Created/Modified

- `server/maestro/hierarchy-service.ts` — Added 'appium' case in fetchBySource, fetchAppiumHierarchy, parseXcuiTestXml for iOS, AppiumService injection
- `server/maestro/plugin.ts` — Reordered init, added /api/appium/status endpoint
- `web/src/lib/components/inspector/SourceSelector.svelte` — 4 sources with Appium disabled state and install hint
- `web/src/lib/api/types.ts` — Extended HierarchySource to include 'appium'
