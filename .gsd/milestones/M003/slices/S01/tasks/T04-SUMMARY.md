---
id: T04
parent: S01
milestone: M003
provides:
  - Inspector page at /devices/[id]/inspector with screenshot overlay, hierarchy info panel, and source selector
  - DeviceCard "Inspect" link for navigable device states (idle, allocated, running, cleanup)
  - Selected-node detail panel showing element type, id, text, bounds, and state flags
key_files:
  - web/src/routes/devices/[id]/inspector/+page.svelte
  - web/src/lib/components/devices/DeviceCard.svelte
key_decisions:
  - Built screenshot URL inline rather than using getScreenshotUrl() to avoid double cache-buster params
  - Added right-column info panel with hierarchy stats and selected-node details beyond minimum plan requirements
patterns_established:
  - Inspector page follows jobs/[id]/+page.svelte pattern: $derived(page.params.id), $state for data, onMount fetch
  - Cache-busting via refreshTimestamp $state updated on each loadHierarchy() call, consumed by $derived screenshotUrl
  - Device state gating for action buttons: Inspect link rendered only for Idle/Allocated/Running/Cleanup states
observability_surfaces:
  - DOM: document.querySelector('select#hierarchy-source')?.value — current source selection
  - DOM: document.querySelectorAll('svg rect').length — count of rendered overlay elements
  - Network: GET /api/devices/:id/hierarchy?source=<source> — fires on page load and source switch
  - Network: GET /api/devices/:id/screenshot?t=<timestamp> — fresh on each load/switch
  - UI: Error state renders "Failed to load hierarchy. Device may not be ready." with Retry button
duration: 20m
verification_result: passed
completed_at: 2026-03-19
blocker_discovered: false
---

# T04: Assemble inspector page and add DeviceCard inspect link

**Created inspector page at /devices/[id]/inspector wiring ScreenshotOverlay, SourceSelector, and hierarchy API with info panel, and added state-gated Inspect links to DeviceCard**

## What Happened

Created the inspector page as the final assembly for slice S01. The page follows the existing `jobs/[id]/+page.svelte` pattern — `$derived(page.params.id)` for the device ID, `$state` for hierarchy data/source/loading/error, and `onMount` for the initial fetch. The `loadHierarchy()` function calls `fetchHierarchy(deviceId, source)` and updates state on success/error.

The page layout uses a two-column grid on large screens: left column for the ScreenshotOverlay component (screenshot + SVG element bounds), right column for a hierarchy info panel (element count, fetch time, source, capture timestamp) and a selected-node detail panel (type, id, text, description, bounds, state flags). The source selector is positioned in the header alongside the page title.

Cache-busting is handled via a `refreshTimestamp` `$state` number that updates on each `loadHierarchy()` call and feeds into a `$derived` screenshot URL. This avoids using `getScreenshotUrl()` which already includes its own `?t=Date.now()` — using both would create redundant query params.

DeviceCard was augmented with an "Inspect" link styled as a secondary action button, rendered only for inspectable device states (idle, allocated, running, cleanup). Error, offline, and booting states do not show the link.

T02/T03 artifacts (ScreenshotOverlay, SourceSelector, maestro.ts, types.ts, coordinate-mapping.ts) were not present in the worktree and were copied from the main repo before building.

## Verification

1. `npm run web:build` — zero errors, inspector page compiled to `entries/pages/devices/_id_/inspector/_page.svelte.js` (14.38 kB)
2. `npx vitest run server/maestro/__tests__/hierarchy-service.test.ts` — 11 tests passed
3. Browser visual verification with mocked endpoints:
   - Inspector page at `/devices/test-device-123/inspector` rendered with hierarchy data (3 elements, 142ms, maestro-cli source), info panel, and source selector
   - Error state at `/devices/bad-device-999/inspector` with 502 mock showed "Failed to load hierarchy. Device may not be ready." with Retry button
   - Devices page showed Inspect links on Idle and Running device cards, no Inspect on Error or Offline cards
   - Clicking Inspect link on DeviceCard navigated to correct inspector URL
4. All browser_assert checks passed (url_contains, selector_visible for select#hierarchy-source, text_visible for key strings)

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npm run web:build` | 0 | ✅ pass | 4.2s |
| 2 | `npx vitest run server/maestro/__tests__/hierarchy-service.test.ts` | 0 | ✅ pass | 8.6s |
| 3 | Browser: inspector page renders with mocked hierarchy data | - | ✅ pass | - |
| 4 | Browser: error state renders on 502 response | - | ✅ pass | - |
| 5 | Browser: DeviceCard Inspect link navigates to inspector | - | ✅ pass | - |
| 6 | Browser: Inspect link absent on Error/Offline device cards | - | ✅ pass | - |

## Diagnostics

- **Inspector page state:** Navigate to `/devices/<id>/inspector` — the page shows loading skeleton, then either screenshot+overlay+info panel (success) or error message with Retry (failure)
- **Source selector:** `document.querySelector('select#hierarchy-source')?.value` returns current source
- **Overlay element count:** `document.querySelectorAll('svg rect').length` shows rendered element bounds
- **Network requests:** Browser DevTools Network tab shows `GET /api/devices/:id/hierarchy?source=...` and `GET /api/devices/:id/screenshot?t=...` on each load/switch
- **Selected node:** Click any colored rect in the overlay to see element details in the right panel
- **Error visibility:** "Failed to load hierarchy. Device may not be ready." text + Retry button visible in DOM when hierarchy fetch fails

## Deviations

- Built screenshot URL inline (`/api/devices/${deviceId}/screenshot?t=${refreshTimestamp}`) instead of using `getScreenshotUrl()` from maestro.ts — the utility already appends `?t=Date.now()` which would create redundant query params and not react to `refreshTimestamp` changes
- Added a hierarchy info panel and selected-node detail panel beyond the minimum plan requirements — these provide useful inspector functionality and follow the pattern of the existing job detail page
- T02/T03 artifacts were not in the worktree and had to be copied from the main repo

## Known Issues

- The ScreenshotOverlay component emits a Svelte a11y warning (`a11y_click_events_have_key_events`) for SVG `<rect>` elements with onclick handlers — this is a known limitation when using SVG shapes as interactive elements and is non-blocking
- Visual verification of coordinate accuracy with a real emulator was not performed (no emulator available in this environment) — the mock data confirmed the rendering pipeline works end-to-end

## Files Created/Modified

- `web/src/routes/devices/[id]/inspector/+page.svelte` — new inspector page with screenshot overlay, source selector, hierarchy info panel, and selected-node details
- `web/src/lib/components/devices/DeviceCard.svelte` — added state-gated "Inspect" link for idle/allocated/running/cleanup device states
- `.gsd/milestones/M003/slices/S01/tasks/T04-PLAN.md` — added Observability Impact section (pre-flight fix)
