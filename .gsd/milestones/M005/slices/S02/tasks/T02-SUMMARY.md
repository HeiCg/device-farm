---
id: T02
parent: S02
milestone: M005
provides: []
requires: []
affects: []
key_files: ["web/src/lib/components/inspector/SourceSelector.svelte", "web/src/lib/api/types.ts"]
key_decisions: ["Appium option shows '(not running)' suffix when unavailable and is disabled in dropdown", "Install hint shown as inline code below dropdown when Appium not available", "onMount checks /api/appium/status to determine availability"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "svelte-check 0 errors. Web build clean. 325/325 tests."
completed_at: 2026-03-26T21:59:27.166Z
blocker_discovered: false
---

# T02: SourceSelector shows 4 sources with Appium disabled state + install hint when unavailable

> SourceSelector shows 4 sources with Appium disabled state + install hint when unavailable

## What Happened
---
id: T02
parent: S02
milestone: M005
key_files:
  - web/src/lib/components/inspector/SourceSelector.svelte
  - web/src/lib/api/types.ts
key_decisions:
  - Appium option shows '(not running)' suffix when unavailable and is disabled in dropdown
  - Install hint shown as inline code below dropdown when Appium not available
  - onMount checks /api/appium/status to determine availability
duration: ""
verification_result: passed
completed_at: 2026-03-26T21:59:27.167Z
blocker_discovered: false
---

# T02: SourceSelector shows 4 sources with Appium disabled state + install hint when unavailable

**SourceSelector shows 4 sources with Appium disabled state + install hint when unavailable**

## What Happened

Updated SourceSelector to show 4 options. Appium option checks /api/appium/status on mount — shows '(not running)' and disables the option when Appium server is unreachable, with an install hint below the dropdown. HierarchySource type extended to 4 values in web types.

## Verification

svelte-check 0 errors. Web build clean. 325/325 tests.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npx svelte-check --threshold error` | 0 | ✅ pass | 4000ms |
| 2 | `npm run web:build` | 0 | ✅ pass | 4000ms |
| 3 | `npm test` | 0 | ✅ pass — 325/325 | 8400ms |


## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `web/src/lib/components/inspector/SourceSelector.svelte`
- `web/src/lib/api/types.ts`


## Deviations
None.

## Known Issues
None.
