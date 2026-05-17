---
estimated_steps: 5
estimated_files: 3
---

# T04: Assemble inspector page and add DeviceCard inspect link

**Slice:** S01 — Hierarchy Viewer Canvas
**Milestone:** M003

## Description

The final assembly task that wires ScreenshotOverlay, SourceSelector, and the Maestro API client into a working inspector page at `/devices/[id]/inspector`. Also adds an "Inspect" link from DeviceCard to make the inspector discoverable.

This is the integration closure for S01 — after this task, R033 (source selector) and R034 (screenshot overlay) are both exercisable end-to-end through the UI.

## Steps

1. **Create `web/src/routes/devices/[id]/inspector/+page.svelte`**:
   - Follow the exact pattern from `web/src/routes/jobs/[id]/+page.svelte`:
     - Import `page` from `$app/state`
     - Get device ID from `page.params.id`
     - Use `$state` for: `hierarchy` (HierarchyResult | null), `source` (HierarchySource, default `'maestro-cli'`), `loading` (boolean), `error` (string | null)
     - Use `$derived` for: `deviceId` (from page params), `screenshotUrl` (from `getScreenshotUrl(deviceId)`)
     - `onMount`: call `loadHierarchy()` to fetch initial data
   - `loadHierarchy()` async function:
     - Set `loading = true`, `error = null`
     - Call `fetchHierarchy(deviceId, source)`
     - On success: set `hierarchy = result`, `loading = false`
     - On error: set `error = 'Failed to load hierarchy. Device may not be ready.'`, `loading = false`
   - Wire `SourceSelector`:
     - `value={source}` and `onchange={(s) => { source = s; loadHierarchy(); }}`
     - `loading={loading}` to disable during fetch
   - Wire `ScreenshotOverlay`:
     - `screenshotUrl={screenshotUrl}` (append `?t={Date.now()}` for cache-busting on source change)
     - `nodes={hierarchy?.hierarchy ?? []}`
   - Page layout:
     - Header area with device ID/name, back link to `/devices`, source selector dropdown
     - Main area with ScreenshotOverlay filling available space (max-height constrained, centered)
     - Error state: show error message with retry button
     - Loading state: skeleton/spinner in the overlay area
     - Empty state: message when hierarchy is empty but no error

2. **Handle the SPA routing**:
   - SvelteKit is configured with `ssr: false` and static adapter — no server-side load functions
   - All data fetching happens client-side in `onMount` (the existing pattern)
   - The route path `/devices/[id]/inspector` uses SvelteKit's file-based routing — create the directory structure: `web/src/routes/devices/[id]/inspector/+page.svelte`
   - Check if `web/src/routes/devices/[id]/` directory already exists (it should from the existing devices routes). If not, the directory needs to be created.

3. **Add "Inspect" link to `DeviceCard.svelte`**:
   - In `web/src/lib/components/devices/DeviceCard.svelte`, add an "Inspect" button/link
   - Use an `<a href="/devices/{device.id}/inspector">` link (SvelteKit client-side routing)
   - Position it alongside any existing action buttons on the card
   - Only show the Inspect link when the device is in a state where inspection makes sense (idle, allocated, running — not offline, error, or booting)
   - Style as a secondary action button following existing card button patterns

4. **Cache-bust screenshot URL on source change**:
   - When `source` changes, the screenshot itself doesn't change, but we want to ensure a fresh screenshot
   - Use `$derived` to compute: `screenshotUrlWithCacheBust = getScreenshotUrl(deviceId) + '?t=' + refreshTimestamp`
   - Update `refreshTimestamp` (a `$state` number) each time `loadHierarchy()` is called

5. **Build and verify**:
   - `npm run web:build` passes with zero errors
   - Navigate to `/devices/<id>/inspector` in browser with running emulator for visual verification (UAT)

## Must-Haves

- [ ] Inspector page at `/devices/[id]/inspector` renders with screenshot, overlay, and source selector
- [ ] Source selector switches trigger re-fetch of hierarchy and overlay update
- [ ] Loading, error, and empty states handled gracefully
- [ ] DeviceCard shows "Inspect" link pointing to inspector page (only for inspectable device states)
- [ ] Screenshot URL cache-busted on refresh
- [ ] Page follows existing SvelteKit patterns (page.params, $state, onMount fetch)
- [ ] Svelte 5 runes only

## Verification

- `npm run web:build` — zero errors
- Visual: navigate to `/devices/<id>/inspector` with running emulator — screenshot loads, colored rects overlay elements, source dropdown switches hierarchy
- Visual: DeviceCard shows Inspect link, clicking it navigates to inspector
- Error handling: stop the emulator and visit inspector — see "Device not ready" error message

## Inputs

- `web/src/lib/components/inspector/ScreenshotOverlay.svelte` (from T03)
- `web/src/lib/components/inspector/SourceSelector.svelte` (from T03)
- `web/src/lib/api/maestro.ts` — `fetchHierarchy()`, `getScreenshotUrl()` (from T02)
- `web/src/lib/api/types.ts` — `HierarchyResult`, `HierarchySource` (from T02)
- `web/src/lib/components/devices/DeviceCard.svelte` — existing component to augment
- `web/src/routes/jobs/[id]/+page.svelte` — reference pattern for route param + data fetching

## Expected Output

- `web/src/routes/devices/[id]/inspector/+page.svelte` — fully assembled inspector page
- `web/src/lib/components/devices/DeviceCard.svelte` — augmented with "Inspect" link

## Observability Impact

- **New route:** `/devices/[id]/inspector` — browser URL bar confirms navigation; SvelteKit client-side route, no SSR
- **Network tab signals:** `GET /api/devices/:id/hierarchy?source=<source>` fires on page load and each source switch — visible in browser DevTools Network tab with JSON response including `source`, `elementCount`, `fetchTimeMs`
- **Screenshot request:** `GET /api/devices/:id/screenshot?t=<timestamp>` — fresh timestamp per load/switch ensures cache-bust; browser DevTools shows 200 with image/png or error status
- **DOM inspection surface:** `document.querySelector('select#hierarchy-source')?.value` — current source selection; `document.querySelectorAll('svg rect').length` — count of rendered overlay elements
- **Error visibility:** Hierarchy fetch failure renders "Failed to load hierarchy. Device may not be ready." with a Retry button; visible in the DOM without DevTools
- **DeviceCard link:** Inspect button only renders for Idle/Allocated/Running/Cleanup states — presence/absence is directly observable in the device list UI
