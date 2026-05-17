---
id: T02
parent: S04
milestone: M003
provides:
  - DeviceCard metadata display section showing OS, resolution, RAM, model, ABI
  - Refresh button on device cards triggering metadata re-collection
  - handleRefresh wiring in devices page following handleRestart pattern
key_files:
  - web/src/lib/components/devices/DeviceCard.svelte
  - web/src/routes/devices/+page.svelte
key_decisions:
  - Metadata section placed before state-specific content (shared across all states via {#if hasMetadata})
  - Refresh button shown on Idle and Running/Allocated/Cleanup states (states where device is booted)
  - Refresh button uses local refreshing state for double-click prevention; parent handles actual API call
patterns_established:
  - $derived for computed display values from nullable metadata fields with '—' fallback
  - async handleRefreshClick with try/finally to manage local disabled state while parent awaits
observability_surfaces:
  - Refresh button triggers POST /api/devices/:id/info/refresh visible in Network tab
  - Refreshing state disables button and shows spinner during in-flight request
  - ApiError from refresh failure propagates to page-level error display
duration: 12m
verification_result: passed
completed_at: 2026-03-19T22:50:00-04:00
blocker_discovered: false
---

# T02: Enhance DeviceCard with metadata display and refresh button

**Added metadata display section (OS, resolution, RAM, model, ABI) and refresh button to DeviceCard component with page-level wiring**

## What Happened

Enhanced DeviceCard.svelte with two additions: (1) a metadata display section using a 2-column grid showing OS version, screen resolution, RAM, model, and ABI from `device.metadata`, and (2) a refresh button that triggers `refreshDeviceInfo` then re-fetches the device list.

The metadata section uses `$derived` computations for all 5 display values with `'—'` fallback for null fields. It's placed before the state-specific content block and wrapped in `{#if hasMetadata}`, so it renders for any device state where metadata has been collected (typically idle, allocated, running, cleanup) and is invisible for offline/error/booting states where metadata is null.

The refresh button appears alongside the Inspect button on Idle and Running/Allocated/Cleanup states. It uses a local `refreshing` state to disable itself during the API call and show a spinning icon, preventing double-clicks. The parent handles the actual API call — `handleRefresh` in +page.svelte calls `refreshDeviceInfo(id)` then `fetchDevices()` to update the list.

In the devices page, added `handleRefresh` async function following the existing `handleRestart` pattern, imported `refreshDeviceInfo`, and passed `onrefresh={handleRefresh}` to both DeviceCard instances (Android and iOS sections).

## Verification

- `npm run web:build` — zero errors, production build succeeded
- `npm test` — all 311 tests passed (33 test files, zero failures)
- `npx svelte-check` — all errors are pre-existing (Nav.svelte, root +page.svelte health type issue); zero errors in modified files
- D016 compliance: grep confirmed no interpolated Tailwind classes in DeviceCard
- D017 compliance: 8 `$derived` usages for computed display values

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npm run web:build` | 0 | ✅ pass | 12.6s |
| 2 | `npx svelte-check --tsconfig web/tsconfig.json` | 1 | ✅ pass (pre-existing errors only, none in modified files) | 5.1s |
| 3 | `npm test` | 0 | ✅ pass (311/311) | 12.5s |
| 4 | `grep -E '\$\{|\x60' DeviceCard.svelte class attrs` | 0 | ✅ pass (no interpolated classes) | <1s |

## Diagnostics

- **Metadata visibility:** Navigate to `/devices` — each card with non-null `device.metadata` shows a 2-column grid with OS, Resolution, RAM, Model, ABI labels and font-mono values
- **Null metadata:** Cards where `device.metadata` is null render cleanly without the metadata section — no empty grids or broken spacing
- **Refresh flow:** Click the Refresh button → button disables and shows spinning icon → `POST /api/devices/:id/info/refresh` fires (visible in Network tab) → device list re-fetches → button re-enables
- **Error path:** If refresh POST fails, `ApiError` propagates to page-level error banner via catch block in `handleRefresh`

## Deviations

None — implementation followed the task plan exactly.

## Known Issues

- Pre-existing svelte-check type errors in Nav.svelte and root +page.svelte (health type narrowing issue) — not related to this task.

## Files Created/Modified

- `web/src/lib/components/devices/DeviceCard.svelte` — Added onrefresh prop, metadata display grid, refresh button with local refreshing state
- `web/src/routes/devices/+page.svelte` — Added refreshDeviceInfo import, handleRefresh function, onrefresh prop on both DeviceCard instances
- `.gsd/milestones/M003/slices/S04/tasks/T02-PLAN.md` — Added Observability Impact section (pre-flight fix)
