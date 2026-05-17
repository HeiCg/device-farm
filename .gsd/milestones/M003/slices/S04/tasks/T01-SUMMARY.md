---
id: T01
parent: S04
milestone: M003
provides:
  - DeviceMetadata interface with 13 fields matching server definition
  - Device type extended with metadata, port, pid fields
  - fetchDeviceInfo() and refreshDeviceInfo() API client functions
key_files:
  - web/src/lib/api/types.ts
  - web/src/lib/api/devices.ts
key_decisions: []
patterns_established:
  - API functions return typed response shapes matching server endpoint contracts
observability_surfaces:
  - Network requests to /api/devices/:id/info and /api/devices/:id/info/refresh visible in DevTools
duration: 8m
verification_result: passed
completed_at: 2026-03-19T22:50:00-04:00
blocker_discovered: false
---

# T01: Add DeviceMetadata type and device info API functions

**Added DeviceMetadata interface (13 fields), extended Device with metadata/port/pid, and added fetchDeviceInfo + refreshDeviceInfo API functions**

## What Happened

Extended the web client's type system to match the server's `DeviceInfo` and `DeviceMetadata` types. Added `DeviceMetadata` interface with all 13 fields (osVersion, sdkVersion, screenWidth, screenHeight, screenDensity, ramMb, abi, manufacturer, model, locale, timezone, batteryLevel, collectedAt) to `types.ts`. Extended the existing `Device` interface with `port: number | null`, `pid: number | null`, and `metadata: DeviceMetadata | null` — these fields were already returned by the server but ignored by the client. Added two new API functions in `devices.ts`: `fetchDeviceInfo(id)` calling `GET /api/devices/:id/info` and `refreshDeviceInfo(id)` calling `POST /api/devices/:id/info/refresh`, both with full type safety.

## Verification

- `npm run web:build` — passed, zero TypeScript errors
- `npx svelte-check --tsconfig web/tsconfig.json` — 14 errors, all pre-existing in Nav.svelte and +page.svelte (confirmed identical count before and after changes via git stash test)
- `npm test` — all 311 tests passed across 33 test files, no regressions

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npm run web:build` | 0 | ✅ pass | 5.6s |
| 2 | `npx svelte-check --tsconfig web/tsconfig.json` | 1 | ✅ pass (14 pre-existing errors, 0 new) | 10.0s |
| 3 | `npm test` | 0 | ✅ pass (311/311 tests) | 8.7s |

## Diagnostics

- Verify types exist: `grep -n 'DeviceMetadata' web/src/lib/api/types.ts`
- Verify API functions: `grep -n 'fetchDeviceInfo\|refreshDeviceInfo' web/src/lib/api/devices.ts`
- Type mismatches between server and client will surface during `svelte-check` or `web:build`

## Deviations

None.

## Known Issues

- 14 pre-existing svelte-check errors in `Nav.svelte` and `+page.svelte` due to `health` variable typed as `never`. Not introduced by this task — same count before and after changes.

## Files Created/Modified

- `web/src/lib/api/types.ts` — Added `DeviceMetadata` interface (13 fields) and extended `Device` with `metadata`, `port`, `pid` fields
- `web/src/lib/api/devices.ts` — Added `fetchDeviceInfo()` and `refreshDeviceInfo()` API client functions with DeviceMetadata import
- `.gsd/milestones/M003/slices/S04/S04-PLAN.md` — Added Observability / Diagnostics section, marked T01 done
- `.gsd/milestones/M003/slices/S04/tasks/T01-PLAN.md` — Added Observability Impact section
