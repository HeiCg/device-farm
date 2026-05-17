---
id: S01
parent: M003
milestone: M003
provides:
  - Inspector page at /devices/[id]/inspector with screenshot + SVG hierarchy overlay + source selector
  - Server ?source= query parameter on /api/devices/:id/hierarchy with Fastify schema validation
  - Native adb uiautomator dump hierarchy strategy (3rd source alongside maestro-cli and device-server)
  - HierarchyNode, HierarchyResult, HierarchySource, QueryResult client-side types
  - Maestro API client (fetchHierarchy, getScreenshotUrl, fetchDeviceState, queryElements) — reused by S02 and S05
  - ScreenshotOverlay component with SVG viewBox-based coordinate mapping
  - SourceSelector dropdown component for hierarchy source switching
  - flattenTree() and mapBoundsToSVG() coordinate mapping utilities
  - DeviceCard "Inspect" link for navigable device states
requires: []
affects:
  - S02
  - S05
key_files:
  - server/maestro/hierarchy-service.ts
  - server/maestro/plugin.ts
  - server/maestro/__tests__/hierarchy-service.test.ts
  - web/src/lib/api/types.ts
  - web/src/lib/api/maestro.ts
  - web/src/lib/utils/coordinate-mapping.ts
  - web/src/lib/components/inspector/ScreenshotOverlay.svelte
  - web/src/lib/components/inspector/SourceSelector.svelte
  - web/src/routes/devices/[id]/inspector/+page.svelte
  - web/src/lib/components/devices/DeviceCard.svelte
key_decisions:
  - SVG viewBox="0 0 {naturalWidth} {naturalHeight}" eliminates manual coordinate scaling — SVG handles device-pixel to CSS-pixel mapping natively (D019)
  - Maestro CLI as default hierarchy source with device-server and native as switchable alternatives (D018)
  - Static color arrays for rect stroke/fill (D016-compliant — no Tailwind template interpolation)
  - getScreenshotUrl returns raw URL string (not apiFetch) since screenshots are binary PNG loaded as <img src>
patterns_established:
  - SVG viewBox matching device native resolution for coordinate-free overlay rendering
  - Loading/error/success tri-state pattern for async data-dependent components
  - Inspector page follows jobs/[id]/+page.svelte pattern ($derived params, $state data, onMount fetch)
  - Cache-busting via $state refreshTimestamp consumed by $derived screenshotUrl
  - vi.hoisted() for mock state needed by vi.mock factories (Vitest hoisting)
  - Regex-based XML parsing for uiautomator dump (avoids adding XML parser dependency)
  - Device state gating for action buttons (Inspect link rendered only for idle/allocated/running/cleanup)
observability_surfaces:
  - GET /api/devices/:id/hierarchy?source=maestro-cli|device-server|native — returns JSON with "source" field
  - GET /api/devices/:id/hierarchy?source=invalid — returns 400 (Fastify schema validation)
  - GET /api/devices/:id/hierarchy (no source) — auto-detection unchanged, response includes "source" field
  - DOM: document.querySelectorAll('svg rect').length — rendered overlay element count
  - DOM: document.querySelector('select#hierarchy-source')?.value — active source selection
  - DOM: img[alt="Device screenshot"]?.complete — screenshot load status
  - UI: Error state renders "Failed to load hierarchy. Device may not be ready." with Retry button
drill_down_paths:
  - .gsd/milestones/M003/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M003/slices/S01/tasks/T02-SUMMARY.md
  - .gsd/milestones/M003/slices/S01/tasks/T03-SUMMARY.md
  - .gsd/milestones/M003/slices/S01/tasks/T04-SUMMARY.md
duration: 53m
verification_result: passed
completed_at: 2026-03-19
---

# S01: Hierarchy Viewer Canvas

**Device inspector page at `/devices/:id/inspector` with live screenshot, SVG element-bounds overlay from 3 switchable hierarchy sources, and coordinate mapping via SVG viewBox**

## What Happened

Built the hierarchy viewer canvas end-to-end across 4 tasks — server-side source routing, client-side types and API client, Svelte 5 inspector components, and final page assembly with navigation.

**T01 (server):** Added optional `?source=` query parameter to the `/api/devices/:id/hierarchy` endpoint with Fastify JSON Schema enum validation. When provided, it routes directly to the requested strategy (maestro-cli, device-server, or native) via a new `fetchBySource()` dispatcher, skipping auto-detection. Implemented `fetchNativeHierarchy()` which runs `adb shell uiautomator dump /dev/tty` and parses the XML output using a stack-based regex parser into the existing `HierarchyNode` format. Exported `HierarchySource` type for downstream use. 11 new tests covering source routing and XML parsing.

**T02 (types + API client):** Added `HierarchyNode`, `HierarchyResult`, `HierarchySource`, and `QueryResult` types to the web types module mirroring server interfaces. Created `web/src/lib/api/maestro.ts` with `fetchHierarchy()`, `getScreenshotUrl()`, `fetchDeviceState()`, and `queryElements()` — this is the shared Maestro API client reused by S02 and S05. Created coordinate mapping utilities (`flattenTree`, `mapBoundsToSVG`) as pure functions in a separate module.

**T03 (components):** Built `ScreenshotOverlay` — renders `<img>` with absolutely-positioned `<svg>` overlay where `viewBox` matches the device's native resolution, so hierarchy node bounds map 1:1 as `<rect>` elements with zero manual pixel math. Rect colors cycle through a static 8-color array (D016-compliant). Each rect has onclick ready for S02's click-to-inspect. Built `SourceSelector` — styled `<select>` dropdown with three options matching the server's `HierarchySource` type. Both use Svelte 5 runes exclusively.

**T04 (assembly):** Created the inspector page at `/devices/[id]/inspector/+page.svelte` following the established `jobs/[id]/+page.svelte` pattern. Two-column layout: left for ScreenshotOverlay, right for hierarchy info panel (element count, fetch time, source, timestamp) and selected-node detail panel (type, id, text, bounds, state flags). Added state-gated "Inspect" links to DeviceCard (shown only for idle/allocated/running/cleanup states).

## Verification

- **Hierarchy service tests:** 11/11 pass — source routing (4), XML parsing (4), XML extraction (2), iOS native error (1)
- **Web build:** `npm run web:build` — zero errors, inspector page compiled to 14.38 kB server bundle
- **Server build:** `npm run build` — zero TypeScript errors
- **Full test suite:** 311/311 tests pass across 33 files, zero regressions
- **Browser visual verification:** Inspector page renders with mocked hierarchy data, error state shows on 502, DeviceCard Inspect links navigate correctly, Inspect link absent on Error/Offline cards
- **Contract checks:** Source selector emits correct `HierarchySource` values, hierarchy endpoint rejects invalid source with 400, auto-detection preserved when no source param

## Requirements Advanced

- R033 — Three hierarchy sources (maestro-cli, device-server, native) with switchable UI dropdown and server `?source=` routing. Backend and frontend both complete. Full validation deferred to UAT with running emulator.
- R034 — Screenshot displayed with colored SVG rectangle overlays from hierarchy data. Coordinate mapping implemented via SVG viewBox (no manual pixel math). Full validation of coordinate accuracy deferred to UAT with running emulator.

## Requirements Validated

- none — R033 and R034 require live emulator visual verification for full validation

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

- Built screenshot URL inline (`/api/devices/${deviceId}/screenshot?t=${refreshTimestamp}`) instead of using `getScreenshotUrl()` — the utility adds its own `?t=Date.now()` which would create redundant params and not react to `refreshTimestamp` state changes
- Added hierarchy info panel and selected-node detail panel beyond the minimum plan requirements — these provide immediate inspector utility and prepare for S02's property panel extension
- T02/T03 artifacts were not present in the worktree and had to be copied from the main repo before T04 could build (documented in KNOWLEDGE.md as git worktree gotcha)

## Known Limitations

- **Coordinate accuracy not verified with real emulator** — SVG viewBox mapping is mathematically correct but visual alignment against a real emulator screenshot has not been confirmed. This is the key risk identified in the milestone roadmap's Proof Strategy.
- **SVG rect a11y warning** — ScreenshotOverlay emits Svelte `a11y_click_events_have_key_events` for SVG `<rect>` onclick handlers. Non-blocking; SVG shapes as interactive elements is a known Svelte a11y limitation.
- **iOS native hierarchy stubbed** — `fetchNativeHierarchy()` throws a clear error for iOS. Only Android `uiautomator dump` is implemented.

## Follow-ups

- S02 should extend the selected-node detail panel (already wired with `onNodeClick` callback and `selectedNodeId` state) to add Maestro command suggestions and search
- S05 should import from `web/src/lib/api/maestro.ts` for debug artifact endpoints rather than creating a separate client

## Files Created/Modified

- `server/maestro/hierarchy-service.ts` — added HierarchySource type, source param on getHierarchy(), fetchBySource() dispatcher, fetchNativeHierarchy() with XML parser
- `server/maestro/plugin.ts` — added Fastify querystring schema with source enum, wired source param through
- `server/maestro/__tests__/hierarchy-service.test.ts` — new: 11 tests for source routing and native XML parsing
- `web/src/lib/api/types.ts` — appended HierarchySource, HierarchyNode, HierarchyResult, QueryResult types
- `web/src/lib/api/maestro.ts` — new: Maestro API client with 4 endpoint functions
- `web/src/lib/utils/coordinate-mapping.ts` — new: flattenTree and mapBoundsToSVG pure utilities
- `web/src/lib/components/inspector/ScreenshotOverlay.svelte` — new: screenshot + SVG viewBox overlay with D016 color cycling
- `web/src/lib/components/inspector/SourceSelector.svelte` — new: hierarchy source dropdown
- `web/src/routes/devices/[id]/inspector/+page.svelte` — new: inspector page with two-column layout
- `web/src/lib/components/devices/DeviceCard.svelte` — added state-gated Inspect link

## Forward Intelligence

### What the next slice should know
- The inspector page already has a selected-node detail panel with `onNodeClick` callback wired through ScreenshotOverlay → inspector page. S02 should extend this panel rather than building a new one.
- `web/src/lib/api/maestro.ts` exports `queryElements(deviceId, query)` which S02 needs for search. It builds URLSearchParams from text/id fields.
- The `flattenTree()` utility in `coordinate-mapping.ts` does depth-first traversal and returns `{ node, depth }[]`. S02 can use the depth value for tree visualization.
- ScreenshotOverlay accepts `selectedNodeId` prop and `onNodeClick` callback — S02 just needs to wire up the handler to populate the properties panel.

### What's fragile
- **SVG viewBox coordinate mapping** — untested against real emulator screenshots. If device density or screenshot scaling introduces an offset, the viewBox approach may need a scale correction factor. Test with a real device before assuming it's correct.
- **Native hierarchy XML parser** — uses regex-based parsing of uiautomator dump output. The output format is not formally documented and may vary across Android versions. Parser handles both self-closing and nested `<node>` elements but hasn't been tested against edge cases like CJK text in attributes.

### Authoritative diagnostics
- `GET /api/devices/:id/hierarchy?source=native` — confirms native strategy works end-to-end; response includes `"source": "native"` and parsed tree
- `npm run web:build` — compiled inspector page bundle at `entries/pages/devices/_id_/inspector/_page.svelte.js` (14.38 kB) confirms the entire component tree compiles
- `npx vitest run server/maestro/__tests__/hierarchy-service.test.ts` — 11 tests cover source routing, XML parsing, and error cases

### What assumptions changed
- **Coordinate mapping complexity** — originally expected to need manual device-pixel-to-CSS-pixel math. SVG viewBox handles this natively — set `viewBox="0 0 {deviceWidth} {deviceHeight}"` and SVG scales all children automatically. No per-rect calculation needed.
- **Git worktree file sharing** — assumed prior task files would be available in the worktree. They weren't. Files had to be copied from the main repo. Documented in KNOWLEDGE.md.
