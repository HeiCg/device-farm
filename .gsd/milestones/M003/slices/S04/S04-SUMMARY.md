---
id: S04
parent: M003
milestone: M003
provides:
  - DeviceMetadata interface (13 fields) mirroring server definition in web client types
  - Device type extended with metadata, port, pid fields
  - fetchDeviceInfo() and refreshDeviceInfo() API client functions
  - DeviceCard metadata display section (OS version, resolution, RAM, model, ABI)
  - Refresh button on device cards triggering metadata re-collection
  - Page-level handleRefresh wiring following existing handleRestart pattern
requires:
  - slice: none
    provides: independent slice
affects:
  - none
key_files:
  - web/src/lib/api/types.ts
  - web/src/lib/api/devices.ts
  - web/src/lib/components/devices/DeviceCard.svelte
  - web/src/routes/devices/+page.svelte
key_decisions:
  - Metadata section placed before state-specific content, shared across all states via {#if hasMetadata}
  - Refresh button shown on Idle and Running/Allocated/Cleanup states (booted devices only)
  - Local refreshing state with try/finally for double-click prevention; parent owns API call
patterns_established:
  - $derived for computed display values from nullable metadata fields with '—' fallback
  - async handler with local disabled state delegating to parent callback (handleRefreshClick → onrefresh)
  - API functions return typed response shapes matching server endpoint contracts
observability_surfaces:
  - Network requests to /api/devices/:id/info and /api/devices/:id/info/refresh visible in DevTools
  - Refresh button shows spinning icon during in-flight request
  - ApiError from refresh failure propagates to page-level error display
drill_down_paths:
  - .gsd/milestones/M003/slices/S04/tasks/T01-SUMMARY.md
  - .gsd/milestones/M003/slices/S04/tasks/T02-SUMMARY.md
duration: 20m
verification_result: passed
completed_at: 2026-03-19T22:50:00-04:00
---

# S04: Enriched Device Cards

**Device cards on the Devices page now display OS version, screen resolution, RAM, model, and ABI from running emulators with an on-demand refresh button**

## What Happened

T01 extended the web client type system to match the server's device info endpoints. Added `DeviceMetadata` interface with all 13 fields (osVersion, sdkVersion, screenWidth, screenHeight, screenDensity, ramMb, abi, manufacturer, model, locale, timezone, batteryLevel, collectedAt) to `types.ts`. Extended the existing `Device` interface with `port`, `pid`, and `metadata` fields — these were already returned by the server but previously ignored by the client. Added `fetchDeviceInfo(id)` and `refreshDeviceInfo(id)` API functions calling `GET /api/devices/:id/info` and `POST /api/devices/:id/info/refresh` respectively.

T02 enhanced DeviceCard.svelte with a metadata display section using a 2-column grid showing 5 key fields (OS version, screen resolution, RAM, model, ABI) and a refresh button. The metadata section uses `$derived` computations for all display values with `'—'` fallback for null fields. It renders only when `device.metadata` is non-null, so offline/error/booting cards remain clean. The refresh button uses a local `refreshing` state to disable itself during the API call and show a spinning icon. The devices page wires `handleRefresh` following the existing `handleRestart` pattern — calls `refreshDeviceInfo(id)` then re-fetches the device list.

## Verification

- `npm run web:build` — zero errors, production build succeeded
- `npm test` — all 311 tests passed (33 test files, zero failures)
- `npx svelte-check` — all errors are pre-existing (Nav.svelte, root +page.svelte health type); zero errors in modified files
- D016 compliance verified: no interpolated Tailwind classes in DeviceCard
- D017 compliance verified: 8 `$derived` usages for computed display values

## Requirements Advanced

- R041 — Device cards now show OS version, screen resolution, RAM, model, and ABI from DeviceInfoCollector. Refresh button triggers re-collection. All planned fields are displayed.

## Requirements Validated

- R041 — Build passes, types match server contract, refresh wiring complete. Awaiting live device UAT for full validation.

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

None — both tasks followed their plans exactly.

## Known Limitations

- Metadata display requires the server to have collected device info (device must have been booted). Cards for offline/error/booting devices show no metadata section, which is by design.
- 14 pre-existing svelte-check errors in Nav.svelte and root +page.svelte (health variable typed as `never`) — not introduced by this slice.
- No client-side error toast for refresh failures — errors propagate to the page-level error banner but there's no per-card inline error display.

## Follow-ups

- none

## Files Created/Modified

- `web/src/lib/api/types.ts` — Added `DeviceMetadata` interface (13 fields), extended `Device` with metadata/port/pid
- `web/src/lib/api/devices.ts` — Added `fetchDeviceInfo()` and `refreshDeviceInfo()` API functions
- `web/src/lib/components/devices/DeviceCard.svelte` — Added onrefresh prop, metadata display grid (5 fields), refresh button with local refreshing state
- `web/src/routes/devices/+page.svelte` — Added refreshDeviceInfo import, handleRefresh function, onrefresh prop on both DeviceCard instances

## Forward Intelligence

### What the next slice should know
- The `Device` type in `web/src/lib/api/types.ts` now includes `metadata: DeviceMetadata | null`, `port: number | null`, and `pid: number | null`. Any component receiving a `Device` object gets these fields automatically from the server response.
- The API client pattern for device info endpoints is straightforward — `fetchDeviceInfo` returns `{ device, metadata }` and `refreshDeviceInfo` returns `{ deviceId, metadata }`. Follow this pattern for new device endpoints.

### What's fragile
- The `DeviceMetadata` type mirrors the server's `DeviceMetadata` in `server/types/index.ts` by convention, not by shared code. If the server adds or renames fields, the web client type must be updated manually.

### Authoritative diagnostics
- `grep -n 'DeviceMetadata' web/src/lib/api/types.ts` — confirms type definition exists with expected fields
- Browser DevTools Network tab filtering on `/api/devices/` — shows info and refresh endpoint calls with full response payloads

### What assumptions changed
- No assumptions changed — the server endpoints and response shapes matched the plan exactly.
