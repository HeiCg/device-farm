# S01 — Hierarchy Viewer Canvas — Research

**Date:** 2026-03-19
**Depth:** Targeted

## Summary

S01 delivers the inspector page at `/devices/[id]/inspector` with a live screenshot, colored SVG element-bounds overlays, and a source selector dropdown switching between Maestro CLI / device-server APK / native adb hierarchy sources. This targets R033 (three-source selector) and R034 (screenshot with bounds overlay).

The server-side `HierarchyService` and Maestro plugin already exist with full hierarchy fetching, screenshot capture, and element query. However, **two backend gaps** must be filled first: (1) the `GET /api/devices/:id/hierarchy` endpoint has no `?source=` query parameter — it always auto-detects; (2) the native `adb shell uiautomator dump` / `idb` strategy is missing from `HierarchyService`. These are small augmentations to existing code, not new endpoints.

On the client side, everything is net-new: the inspector route, `HierarchyNode` type, Maestro API client, coordinate-mapping utility, and `ScreenshotOverlay` SVG component. The coordinate mapping (device pixels → CSS pixels) is the core risk — it must account for the screenshot's native resolution vs the rendered `<img>` dimensions.

## Recommendation

Build server-side source selection first (unblocks all UI work), then client types + API client, then the overlay component, then the inspector page. Use SVG over `<img>` per D019 — SVG gives free hover/click events needed by S02. Coordinate mapping should use `naturalWidth/naturalHeight` of the loaded screenshot image vs `clientWidth/clientHeight` of the rendered element — this avoids needing to know density separately.

## Implementation Landscape

### Key Files

**Server (augment existing):**
- `server/maestro/hierarchy-service.ts` — `HierarchyService` class. Has `getHierarchy(platform, deviceId, port)` with device-server + maestro-cli strategies. Needs: (a) new `source` parameter to force a specific strategy, (b) new `fetchNativeHierarchy()` method for `adb shell uiautomator dump` / `idb ui describegui`.
- `server/maestro/plugin.ts` — Maestro plugin with hierarchy/screenshot/query/info/state routes. Needs: `?source=` query param on `/api/devices/:id/hierarchy` route, passed through to `getHierarchy()`.
- `server/pool/device-info-collector.ts` — `DeviceInfoCollector` with `DeviceMetadata` including `screenWidth`, `screenHeight`, `screenDensity`. Read-only reference for understanding coordinate space.
- `server/types/index.ts` — `DeviceInfo` with `metadata: DeviceMetadata | null`. Read-only reference.

**Client (net-new):**
- `web/src/lib/api/types.ts` — Has `Device`, `Job`, etc. Needs: `HierarchyNode`, `HierarchyResult`, `QueryResult` interfaces mirroring server types.
- `web/src/lib/api/maestro.ts` — **New file.** API client functions: `fetchHierarchy(deviceId, source?)`, `fetchScreenshot(deviceId)`, `fetchDeviceState(deviceId)`, `queryElements(deviceId, query)`.
- `web/src/lib/components/inspector/ScreenshotOverlay.svelte` — **New file.** Core component: `<img>` with absolute-positioned `<svg>` overlay. Props: `screenshotSrc`, `hierarchyNodes`, `selectedNodeId?`, `onNodeClick?`. Handles coordinate mapping internally.
- `web/src/lib/components/inspector/SourceSelector.svelte` — **New file.** Dropdown selecting between `'maestro-cli' | 'device-server' | 'native'`. Fires `onchange` event.
- `web/src/routes/devices/[id]/inspector/+page.svelte` — **New file.** Inspector page. Fetches hierarchy + screenshot, wires source selector, renders `ScreenshotOverlay`.
- `web/src/lib/components/layout/Nav.svelte` — Existing nav. No change needed — inspector is accessed from device card link, not top-level nav (it's device-scoped). Confirm with `isActive` logic that `/devices` prefix matches.

**Existing patterns to follow:**
- `web/src/routes/jobs/[id]/+page.svelte` — Route param via `page.params.id`, `$derived`, `$state`, `onMount` fetch pattern. Inspector page follows this exact pattern.
- `web/src/lib/components/devices/DevicePreview.svelte` — Shows `<img>` of device screen. Inspector's screenshot display is similar but uses REST fetch (not WebSocket) and adds SVG overlay.
- `web/src/lib/api/client.ts` — `apiFetch<T>()` wrapper. All new API calls use this.
- `web/src/lib/ws/device-preview.svelte.ts` — Svelte 5 reactive pattern with `$state` in a factory function. API client can follow similar pattern or be plain async functions (simpler, preferred for REST).

### Build Order

1. **Server: source parameter + native strategy** — Augment `HierarchyService.getHierarchy()` to accept an optional `source: 'maestro-cli' | 'device-server' | 'native'` parameter. When provided, skip auto-detection and use the requested strategy directly. Add `fetchNativeHierarchy(serial)` for `adb shell uiautomator dump` XML parsing. Update the plugin route to read `?source=` from query. **This unblocks all UI work.**

2. **Client types** — Add `HierarchyNode`, `HierarchyResult`, and `HierarchySource` type to `web/src/lib/api/types.ts`. These mirror `server/maestro/hierarchy-service.ts` interfaces.

3. **API client** — Create `web/src/lib/api/maestro.ts` with `fetchHierarchy()`, `fetchScreenshotUrl()`, `fetchDeviceState()`. Uses `apiFetch` from `client.ts`. Screenshot returns a URL string (not fetched as JSON — it's a binary endpoint, so the `<img src>` points directly at `/api/devices/:id/screenshot`).

4. **Coordinate mapping utility** — Small pure function in the overlay component or a shared util: `mapBoundsToCSS(bounds: [l,t,r,b], naturalW, naturalH, displayW, displayH) → {left, top, width, height}`. Uses ratios `displayW/naturalW` and `displayH/naturalH`.

5. **ScreenshotOverlay component** — SVG absolutely positioned over an `<img>`. Uses `bind:naturalWidth`, `bind:naturalHeight` and `bind:clientWidth`, `bind:clientHeight` on the image element to drive coordinate mapping. Flattens hierarchy tree to get all nodes with bounds, renders `<rect>` elements with semi-transparent colored stroke.

6. **SourceSelector component** — Simple dropdown following Kinetic Console styling. Three options with labels: "Maestro CLI (default)", "APK (device-server)", "Native (adb/idb)".

7. **Inspector page** — Route at `web/src/routes/devices/[id]/inspector/+page.svelte`. Fetches hierarchy and renders ScreenshotOverlay. Source selector triggers re-fetch. Loading/error states following existing page patterns. Link from DeviceCard to inspector.

### Verification Approach

- **Contract:** `npm run web:build` passes with zero errors after all files added
- **TypeScript:** `npx tsc --noEmit` in web/ (caught by web:build but can run standalone)
- **Visual:** Navigate to `/devices/<id>/inspector` in browser with a running emulator — screenshot loads, colored rects overlay elements, source dropdown switches hierarchy source and overlay updates
- **Coordinate accuracy:** Overlay rects should visually align with elements on the screenshot — buttons, text fields, etc. should be enclosed by their rect
- **Source switching:** Each source returns different `source` field in response — verify in network tab that `?source=maestro-cli` / `?source=device-server` / `?source=native` hits correctly

## Constraints

- **D016:** All Tailwind classes must be full static strings in Record lookups — no template interpolation (e.g. rect colors per hierarchy depth)
- **D019:** SVG over screenshot, not Canvas — gives free hover/click events for S02
- **D020:** Inspector is read-only — no tap/swipe/type interaction from browser
- **Svelte 5 runes only:** `$state`, `$derived`, `$effect`, `$props()` — no legacy stores or reactive declarations
- **SPA mode:** `ssr: false`, static adapter — no server-side load functions, all data fetched client-side in `onMount`
- **Screenshot is binary:** `/api/devices/:id/screenshot` returns `image/png` — use as `<img src="/api/devices/:id/screenshot">` directly, don't route through `apiFetch` JSON wrapper

## Common Pitfalls

- **Stale image dimensions after resize** — `bind:clientWidth` on the `<img>` must be reactive to window resize; use `ResizeObserver` or Svelte's built-in bind if dimensions are used in `$derived` coordinate calculations
- **SVG viewBox vs absolute positioning** — Two approaches: (a) absolute-position SVG same size as img with `viewBox="0 0 naturalW naturalH"` (SVG handles scaling internally), or (b) manually scale each rect. Approach (a) is simpler and more reliable — set SVG `viewBox` to device resolution and let SVG scaling handle everything
- **Screenshot cache-busting** — The screenshot endpoint returns `Cache-Control: no-store` but the `<img src>` may still cache. Append `?t=<timestamp>` on refresh
- **Empty hierarchy on first load** — If device is still booting or Maestro is not installed, hierarchy returns 502. Handle gracefully with "Device not ready" message
- **Bounds array format** — Server returns `[left, top, right, bottom]` not `[x, y, width, height]`. SVG `<rect>` needs `x, y, width, height`. Convert: `x=left, y=top, width=right-left, height=bottom-top`

## Open Risks

- **Server `?source=` param is not yet implemented** — The hierarchy endpoint currently auto-detects strategy. Adding the source param is a small backend change but is a hard prerequisite for the source selector UI. If ruled out of scope for this UI milestone, the source selector degrades to showing only the auto-detected source (still useful but doesn't fully satisfy R033).
- **Native adb/idb strategy missing from HierarchyService** — R033 note says "Native adb/idb strategy needs adding." Without it, the native option in the source selector has no backend support. The `adb shell uiautomator dump` XML format is well-known and straightforward to parse, but it's new code in the server.
- **Maestro CLI may not be installed on dev machines** — If maestro is not in PATH, the maestro-cli source will fail. The device-server source should work as long as the emulator APK is running.
