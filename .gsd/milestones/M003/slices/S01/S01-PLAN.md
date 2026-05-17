# S01: Hierarchy Viewer Canvas

**Goal:** Users can navigate to `/devices/:id/inspector`, see a live device screenshot with colored SVG element-bounds overlays, and switch between three hierarchy sources (Maestro CLI, device-server APK, native adb/idb) via a dropdown selector.

**Demo:** Open `/devices/<deviceId>/inspector` in the browser with a running emulator. A screenshot loads with colored rectangles drawn over each UI element. A dropdown lets the user switch between Maestro CLI (default), APK (device-server), and Native (adb/idb) sources — each re-fetches the hierarchy and redraws the overlay.

## Must-Haves

- Three-source hierarchy selector dropdown (Maestro CLI default, device-server APK, native adb/idb) — R033
- Screenshot displayed with colored SVG rectangles over element bounds from the hierarchy tree — R034
- Coordinate mapping between device native resolution and displayed screenshot size via SVG viewBox — R034
- Server `?source=` query parameter on `/api/devices/:id/hierarchy` endpoint — R033 backend prerequisite
- Native `adb shell uiautomator dump` hierarchy strategy in HierarchyService — R033 third source
- Inspector route accessible via link from DeviceCard on Devices page

## Proof Level

- This slice proves: integration (UI renders real data from server hierarchy/screenshot endpoints)
- Real runtime required: yes (emulator needed for visual verification of coordinate accuracy)
- Human/UAT required: yes (visual inspection that overlay rects align with screenshot elements)

## Verification

- `npx vitest run server/maestro/__tests__/hierarchy-service.test.ts` — source parameter routing and native strategy parsing
- `npm run web:build` — zero TypeScript errors, all new files compile cleanly
- Visual: navigate to `/devices/<id>/inspector` with running emulator — screenshot loads, colored rects overlay elements, source dropdown switches hierarchy and overlay updates
- Coordinate accuracy: overlay rects visually enclose the correct UI elements on the screenshot

## Observability / Diagnostics

- Runtime signals: server logs hierarchy fetch strategy used (`maestro-cli`, `device-server`, `native`) and timing
- Inspection surfaces: `GET /api/devices/:id/hierarchy?source=native` returns hierarchy JSON with `source` field indicating which strategy ran; browser Network tab shows request/response
- Failure visibility: hierarchy endpoint returns 502 with descriptive error when device not ready or strategy fails; UI shows "Device not ready" message on fetch failure
- Redaction constraints: none

## Integration Closure

- Upstream surfaces consumed: `server/maestro/hierarchy-service.ts` (existing HierarchyService), `server/maestro/plugin.ts` (existing Maestro routes), `web/src/lib/api/client.ts` (existing apiFetch wrapper), `web/src/lib/components/devices/DeviceCard.svelte` (existing — add Inspect link)
- New wiring introduced in this slice: `/devices/[id]/inspector/+page.svelte` route, `web/src/lib/api/maestro.ts` API client (reused by S02 and S05), `web/src/lib/components/inspector/` component directory
- What remains before the milestone is truly usable end-to-end: S02 adds element click/selection + properties panel + Maestro command suggestions; S05 reuses the API client for debug artifacts

## Tasks

- [x] **T01: Add source selection and native hierarchy strategy to server** `est:45m`
  - Why: R033 requires 3 hierarchy sources but the server currently auto-detects with no `?source=` param, and has no native adb/idb strategy. This unblocks all UI work.
  - Files: `server/maestro/hierarchy-service.ts`, `server/maestro/plugin.ts`, `server/maestro/__tests__/hierarchy-service.test.ts`
  - Do: Add optional `source: 'maestro-cli' | 'device-server' | 'native'` parameter to `getHierarchy()`. When provided, skip auto-detection and use the requested strategy directly. Add `fetchNativeHierarchy(serial)` method that runs `adb shell uiautomator dump` and parses the XML output into the existing `HierarchyNode` format. Update the Maestro plugin route to read `?source=` from the request query string and pass it through. Add unit tests covering source routing and XML parsing.
  - Verify: `npx vitest run server/maestro/__tests__/hierarchy-service.test.ts`
  - Done when: `?source=maestro-cli|device-server|native` param routes to correct strategy; native strategy parses uiautomator XML; tests pass; `npm run build` clean

- [x] **T02: Create client-side HierarchyNode types and Maestro API client** `est:20m`
  - Why: Inspector components need typed interfaces and API functions to fetch hierarchy and screenshot data from the server.
  - Files: `web/src/lib/api/types.ts`, `web/src/lib/api/maestro.ts`
  - Do: Add `HierarchyNode`, `HierarchyResult`, `HierarchySource` types to `types.ts` mirroring server types. Create new `maestro.ts` with `fetchHierarchy(deviceId, source?)`, `getScreenshotUrl(deviceId)`, `fetchDeviceState(deviceId)`, `queryElements(deviceId, query)` using `apiFetch` from `client.ts`. Screenshot is binary — return a URL string pointing at `/api/devices/:id/screenshot`, not a JSON fetch.
  - Verify: `npm run web:build`
  - Done when: Types compile, API client exports all functions, `npm run web:build` passes with zero errors

- [x] **T03: Build ScreenshotOverlay and SourceSelector components** `est:1h`
  - Why: Core UI for the inspector — the screenshot with SVG bounds overlay delivers R034, and the source selector dropdown delivers R033's switching UI.
  - Files: `web/src/lib/components/inspector/ScreenshotOverlay.svelte`, `web/src/lib/components/inspector/SourceSelector.svelte`
  - Do: **ScreenshotOverlay:** Render `<img>` with absolute-positioned `<svg>` overlay. Set SVG `viewBox="0 0 {naturalWidth} {naturalHeight}"` and size it to match the img's rendered dimensions — SVG handles coordinate scaling internally (no manual per-rect math). Flatten hierarchy tree recursively to extract all leaf nodes with bounds. Render `<rect>` per node with semi-transparent colored stroke (depth-based colors via static Tailwind-compatible Record lookup per D016). Use `bind:naturalWidth`, `bind:naturalHeight`, `bind:clientWidth`, `bind:clientHeight` on img. Convert bounds `[left, top, right, bottom]` to SVG rect `x, y, width, height`. Svelte 5 runes only. **SourceSelector:** Dropdown with 3 options — "Maestro CLI", "Device Server (APK)", "Native (adb/idb)". Fires `onchange` event with selected `HierarchySource` value. Follow existing component styling patterns.
  - Verify: `npm run web:build`
  - Done when: Both components compile, ScreenshotOverlay renders SVG rects from hierarchy data, SourceSelector emits source changes, `npm run web:build` passes

- [x] **T04: Assemble inspector page and add DeviceCard inspect link** `est:30m`
  - Why: Wires all components into the inspector route and makes it navigable — completes R033 and R034 end-to-end.
  - Files: `web/src/routes/devices/[id]/inspector/+page.svelte`, `web/src/lib/components/devices/DeviceCard.svelte`
  - Do: Create inspector page following `jobs/[id]/+page.svelte` pattern — `page.params.id`, `$state`, `$derived`, `onMount` fetch. Fetch hierarchy via `fetchHierarchy(deviceId, source)` and display screenshot via `getScreenshotUrl(deviceId)`. Wire SourceSelector `onchange` to re-fetch hierarchy. Render ScreenshotOverlay with fetched data. Add loading spinner and error states (handle 502 "device not ready" gracefully). Cache-bust screenshot with `?t={Date.now()}` on source change. Add "Inspect" link/button to DeviceCard pointing to `/devices/{device.id}/inspector`.
  - Verify: `npm run web:build` passes; visual verification with running emulator
  - Done when: `/devices/:id/inspector` route renders screenshot + overlay + source selector; DeviceCard links to inspector; loading and error states work; `npm run web:build` passes with zero errors

## Files Likely Touched

- `server/maestro/hierarchy-service.ts`
- `server/maestro/plugin.ts`
- `server/maestro/__tests__/hierarchy-service.test.ts`
- `web/src/lib/api/types.ts`
- `web/src/lib/api/maestro.ts`
- `web/src/lib/components/inspector/ScreenshotOverlay.svelte`
- `web/src/lib/components/inspector/SourceSelector.svelte`
- `web/src/routes/devices/[id]/inspector/+page.svelte`
- `web/src/lib/components/devices/DeviceCard.svelte`
