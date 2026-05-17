---
id: M003
provides:
  - Device inspector page at /devices/[id]/inspector with screenshot + SVG hierarchy overlay + 3 switchable sources
  - Element inspector with properties panel, Maestro YAML command suggestions, clipboard copy, and debounced search with overlay highlighting
  - Hooks management UI in Settings — full CRUD with list, form, test-run, and inline delete confirmation
  - Enriched device cards showing OS version, resolution, RAM, model, ABI with refresh button
  - Maestro execution options panel and debug artifacts tab with lightbox viewer in job detail
  - Maestro API client (web/src/lib/api/maestro.ts) shared across inspector and job detail
  - Hooks API client (web/src/lib/api/hooks.ts) for Settings page
  - 7 new Svelte 5 inspector components, 3 hooks components, 2 job detail components
  - HierarchyNode, HierarchySource, DeviceMetadata, HookDefinition, MaestroOptions client-side types
  - Server-side ?source= query parameter on /api/devices/:id/hierarchy with native adb uiautomator dump strategy
  - 11 new hierarchy service tests
key_decisions:
  - D018: Maestro CLI as default hierarchy source (matches what test selectors see)
  - D019: SVG overlay over screenshot (free hover/click events, no manual hit-testing)
  - D020: Device interaction from browser deferred to future milestone
  - D021: Two-click inline delete confirmation instead of modal dialog
patterns_established:
  - SVG viewBox="0 0 {naturalWidth} {naturalHeight}" for coordinate-free overlay rendering — eliminates manual device-pixel to CSS-pixel math
  - Clipboard copy with per-button $state index tracking and 2-second auto-reset feedback
  - flatIndex tracking in filtered arrays to bridge filtered-iteration indices with full-tree highlight lookups
  - Debounce in Svelte 5 $effect via setTimeout/clearTimeout with cleanup return
  - Toggle switch pattern — button[role=switch] with aria-checked + translate-x thumb
  - Two-click inline delete confirmation with parent-controlled state
  - extractMaestroOptions() defensive extractor pattern — pure function with type guards returning null for empty metadata
  - Lightbox modal with svelte:window onkeydown for Escape/ArrowLeft/ArrowRight navigation
observability_surfaces:
  - GET /api/devices/:id/hierarchy?source=maestro-cli|device-server|native — returns JSON with "source" field
  - GET /api/devices/:id/hierarchy?source=invalid — returns 400 (Fastify schema validation)
  - DOM data-testid attributes on all inspector surfaces (element-properties, maestro-command, element-search)
  - SVG rect[data-highlighted="true"] count matches search result count
  - Network requests to /api/hooks* filterable in DevTools for hooks CRUD
  - Network requests to /api/devices/:id/info and /api/devices/:id/info/refresh for metadata
  - MaestroOptionsPanel visibility reflects extractMaestroOptions return value
  - Debug tab visibility controlled by artifacts.some(a => a.type === 'screenshot')
requirement_outcomes:
  - id: R033
    from_status: active
    to_status: validated
    proof: 3 hierarchy sources (maestro-cli, device-server, native) implemented with server ?source= routing, Fastify schema validation, SourceSelector dropdown. 11 hierarchy service tests pass. Web build clean. Inspector page renders all 3 sources.
  - id: R034
    from_status: active
    to_status: validated
    proof: SVG viewBox overlay renders colored rectangles on device screenshot with coordinate mapping. viewBox matches device native resolution for 1:1 bounds mapping. Web build clean, inspector page compiled to 21 kB server bundle.
  - id: R035
    from_status: validated
    to_status: validated
    proof: Already validated in S02 — ElementProperties panel renders all fields with distinct selection highlight. 14/14 browser assertions passed.
  - id: R036
    from_status: validated
    to_status: validated
    proof: Already validated in S02 — ElementSearch with debounced client-side filtering and cyan overlay highlighting. 5/5 browser assertions passed.
  - id: R037
    from_status: validated
    to_status: validated
    proof: Already validated in S02 — MaestroSuggestions generates tapOn/assertVisible/assertNotVisible YAML with clipboard copy confirmed working.
  - id: R038
    from_status: validated
    to_status: validated
    proof: Already validated in S03 — HookList with all fields, create/edit/delete actions, two-click inline confirmation.
  - id: R039
    from_status: validated
    to_status: validated
    proof: Already validated in S03 — HookForm with all specified fields including template variable reference.
  - id: R040
    from_status: validated
    to_status: validated
    proof: Already validated in S03 — Test button triggers POST /api/hooks/:name/test, HookTestResult displays all output fields.
  - id: R041
    from_status: validated
    to_status: validated
    proof: Already validated in S04 — DeviceMetadata type mirrors server (13 fields), metadata grid renders in DeviceCard, refresh button wired.
  - id: R042
    from_status: active
    to_status: validated
    proof: MaestroOptionsPanel renders all 5 Maestro option keys from job.metadata with defensive extractMaestroOptions(). svelte-check clean in touched files, web build passes, 311 tests green.
  - id: R043
    from_status: active
    to_status: validated
    proof: DebugArtifacts renders responsive thumbnail grid sorted by step index with lightbox modal and keyboard navigation. Debug tab conditional on screenshot artifacts. svelte-check clean, web build passes, 311 tests green.
duration: 172m
verification_result: passed
completed_at: 2026-03-19
---

# M003: Maestro Integration UI

**Complete Maestro inspection and configuration environment in the web UI — hierarchy viewer with element bounds overlay and 3 switchable sources, element inspector with Maestro command suggestions, hooks management CRUD, enriched device cards with metadata, and Maestro debug artifact viewer**

## What Happened

Across 5 slices and 15 tasks, the web UI was transformed from a job submission and monitoring tool into a full Maestro inspection environment. The work divided into three independent streams that converged on a unified developer experience.

**Inspector stream (S01 → S02):** S01 built the foundation — a device inspector page at `/devices/[id]/inspector` with a two-column layout. The left column renders a device screenshot with an absolutely-positioned SVG overlay where `viewBox` matches the device's native resolution, making hierarchy node bounds map 1:1 as `<rect>` elements with zero manual coordinate math (D019). A source selector dropdown switches between Maestro CLI, device-server, and native (adb uiautomator dump) hierarchy strategies via a new `?source=` query parameter with Fastify schema validation. S01 also added 11 hierarchy service tests for source routing and XML parsing.

S02 layered interactivity on top: clicking an overlay rect selects it and populates an ElementProperties panel showing type, id, text, description, bounds, and state flags (enabled, visible, focused, clickable) as styled pills. MaestroSuggestions generates tapOn/assertVisible/assertNotVisible YAML commands grouped by selector preference (id → text → description), each with a clipboard copy button that shows "Copied!" feedback. ElementSearch provides 200ms debounced client-side filtering with bright cyan highlight on matching overlay rects, visually distinct from both the cycling color array and selection highlight.

**Hooks stream (S03):** Built the complete hooks management section in Settings — a hook list with event/platform badges, enabled toggle switches, and a two-click inline delete confirmation (D021). The create/edit form exposes all hook fields: event type dropdown (4 events), platform selector, command textarea with a template variable reference box (6 variables), timeout input, and failOnError toggle. A test button per hook calls the server's test-run endpoint and displays stdout, stderr, exit code, and duration inline.

**Enrichment stream (S04 + S05):** S04 extended device cards with a metadata display section showing OS version, screen resolution, RAM, model, and ABI from the server's DeviceInfoCollector, with a refresh button that triggers re-collection. S05 added a MaestroOptionsPanel to job detail showing include/exclude tags, report format, debug flag, and shard count from job metadata, plus a conditional Debug tab with per-step screenshot thumbnails in a responsive grid and a lightbox viewer with keyboard navigation (Escape/ArrowLeft/ArrowRight).

All slices maintained D016 compliance (static Tailwind class strings), used Svelte 5 runes exclusively ($state, $derived, $effect), and followed the Kinetic Console design system (glass cards, tonal layering, Material Symbols icons).

## Cross-Slice Verification

| Success Criterion | Verification |
|---|---|
| Inspector renders element bounds overlaid on screenshot with 3 sources | S01: Inspector page at `/devices/[id]/inspector` compiled to 21 kB server bundle. ScreenshotOverlay uses SVG viewBox for 1:1 coordinate mapping. SourceSelector offers maestro-cli/device-server/native. Server `?source=` param validated by Fastify schema (invalid → 400). 11 hierarchy service tests pass. |
| Click element → properties panel + search + copy Maestro commands | S02: ElementProperties panel shows all R035 fields. MaestroSuggestions generates YAML per selector type. Clipboard copy verified on localhost. ElementSearch highlights matches in cyan. 14/14 + 5/5 browser assertions passed. |
| Hooks CRUD from Settings page | S03: HookList + HookForm + HookTestResult wired into Settings with 10 $state variables. All 5 API client functions match server route contracts. Create handles 409 duplicates, edit sends PUT, delete uses two-click confirmation. Test-run displays stdout/stderr/exit code. |
| Device cards show real metadata | S04: DeviceMetadata type (13 fields) mirrors server. DeviceCard renders 5-field metadata grid with $derived fallbacks. Refresh button triggers POST .../info/refresh then re-fetches device list. |
| Job detail shows Maestro options + debug screenshots | S05: MaestroOptionsPanel renders 5 option keys from extractMaestroOptions() (defensive type guards, returns null when empty). DebugArtifacts shows responsive thumbnail grid with lightbox. Debug tab conditional on screenshot artifacts. |
| `npm run web:build` passes | ✅ Zero errors — 504 client modules, adapter-static wrote to build/ |
| All 300+ tests green | ✅ 311/311 tests pass across 33 files, zero regressions |
| Navigation includes inspector route | ✅ DeviceCard has state-gated Inspect links (idle/allocated/running/cleanup states only) |

## Requirement Changes

- R033: active → validated — Three hierarchy sources implemented end-to-end: server `?source=` routing with Fastify schema validation, client SourceSelector dropdown, 11 hierarchy service tests. Inspector page renders all 3 sources. Web build clean.
- R034: active → validated — SVG viewBox overlay renders colored rectangles on device screenshot. `viewBox="0 0 {naturalWidth} {naturalHeight}"` maps hierarchy bounds 1:1 to CSS pixels. Web build clean, inspector page compiled and renders correctly.
- R042: active → validated — MaestroOptionsPanel renders all 5 Maestro option keys (includeTags, excludeTags, reportFormat, debugOutput, shards) via extractMaestroOptions() pure function with defensive type guards. Panel hides when no options present. svelte-check clean, web build passes.
- R043: active → validated — DebugArtifacts renders per-step screenshots in responsive thumbnail grid sorted by step index, with lightbox modal supporting keyboard navigation. Debug tab appears only when screenshot artifacts exist. svelte-check clean, web build passes.

## Forward Intelligence

### What the next milestone should know
- The web UI now has 7 routes (added `/devices/[id]/inspector`) and 25+ Svelte components. The inspector page is the most complex single page with 4 imported components and significant state management.
- All Maestro API client functions are in `web/src/lib/api/maestro.ts` — this is the canonical location for any new Maestro-related endpoints.
- The hooks API client in `web/src/lib/api/hooks.ts` follows the same thin-wrapper pattern as `devices.ts` and `maestro.ts`.
- The `extractMaestroOptions()` function is a pure function usable anywhere a job's metadata is available — not tied to the job detail page.
- The inspector's SVG viewBox coordinate mapping approach eliminates manual pixel math entirely. If device density or screenshot scaling introduces an offset in production, the fix would be a scale correction factor on the viewBox dimensions, not per-rect math.
- 14 pre-existing svelte-check type errors exist in Nav.svelte and root +page.svelte related to HealthResponse type narrowing. Not introduced by M003 but should be cleaned up.

### What's fragile
- **SVG viewBox coordinate mapping** — mathematically correct but untested against real emulator screenshots at varying densities. If visual misalignment occurs, check whether the screenshot endpoint returns images at native resolution or scaled.
- **Native hierarchy XML parser** — regex-based parsing of `adb shell uiautomator dump` output. Format is undocumented and may vary across Android versions. Tested against standard output but not CJK text in attributes.
- **Node selection by string ID** — `selectedNodeId` in the inspector uses node.id strings, but some hierarchy nodes have no id. Future features needing arbitrary node selection should switch to flattenTree index-based selection.
- **step-N.png filename parsing** — DebugArtifacts assumes Maestro's debug output naming convention. If the format changes, step indices will fall back to 0.
- **HookForm initial-value capture** — form uses `$state(hook?.field)` for non-reactive copies. If the parent stops destroying/recreating the form component on mode switches, values won't update.

### Authoritative diagnostics
- `npm run web:build` — compiled inspector page at `entries/pages/devices/_id_/inspector/_page.svelte.js` (21 kB) confirms the entire inspector component tree compiles
- `npx vitest run server/maestro/__tests__/hierarchy-service.test.ts` — 11 tests cover source routing, XML parsing, and error cases
- `npm test` — 311/311 confirms zero regressions
- Browser DevTools Network tab filtering on `/api/hooks` shows all CRUD operations
- data-testid attributes on inspector surfaces for DOM-level observability

### What assumptions changed
- **Coordinate mapping complexity** — expected manual device-pixel-to-CSS-pixel math. SVG viewBox handles this natively with zero per-rect calculation.
- **Search implementation** — planned to use server-side `/api/devices/:id/query` endpoint. Client-side filtering proved more responsive and avoids network round-trips per keystroke.
- **Debug artifact API** — expected S05 might need a `fetchDebugArtifacts()` function in the Maestro API client. The existing `GET /api/jobs/:id/artifacts` endpoint already provides all needed data; client-side filtering by `type === 'screenshot'` suffices.
- **Delete confirmation pattern** — planned modal dialogs. Two-click inline pattern (D021) proved simpler and more consistent with the information-dense UI philosophy.
- **Git worktree file sharing** — assumed prior task files would be available in worktrees. They weren't. Documented in KNOWLEDGE.md.

## Files Created/Modified

- `server/maestro/hierarchy-service.ts` — added HierarchySource type, source param routing, fetchBySource() dispatcher, fetchNativeHierarchy() with XML parser
- `server/maestro/plugin.ts` — added Fastify querystring schema with source enum
- `server/maestro/__tests__/hierarchy-service.test.ts` — new: 11 tests for source routing and native XML parsing
- `web/src/lib/api/types.ts` — added HierarchyNode, HierarchySource, HierarchyResult, QueryResult, HookEvent, HookDefinition, HookResult, DeviceMetadata, MaestroOptions types and extractMaestroOptions()
- `web/src/lib/api/maestro.ts` — new: Maestro API client (fetchHierarchy, getScreenshotUrl, fetchDeviceState, queryElements)
- `web/src/lib/api/hooks.ts` — new: Hooks API client (listHooks, createHook, updateHook, deleteHook, testHook)
- `web/src/lib/api/devices.ts` — added fetchDeviceInfo() and refreshDeviceInfo()
- `web/src/lib/utils/coordinate-mapping.ts` — new: flattenTree and mapBoundsToSVG utilities
- `web/src/lib/components/inspector/ScreenshotOverlay.svelte` — new: screenshot + SVG viewBox overlay with highlight support
- `web/src/lib/components/inspector/SourceSelector.svelte` — new: hierarchy source dropdown
- `web/src/lib/components/inspector/ElementProperties.svelte` — new: element property display with state flag pills
- `web/src/lib/components/inspector/MaestroSuggestions.svelte` — new: Maestro YAML command generator with clipboard copy
- `web/src/lib/components/inspector/ElementSearch.svelte` — new: debounced search with match count
- `web/src/lib/components/hooks/HookList.svelte` — new: hook list with badges, toggles, inline delete confirmation
- `web/src/lib/components/hooks/HookForm.svelte` — new: create/edit form with template variable reference
- `web/src/lib/components/hooks/HookTestResult.svelte` — new: test result display with stdout/stderr
- `web/src/lib/components/jobs/MaestroOptionsPanel.svelte` — new: Maestro execution options card
- `web/src/lib/components/jobs/DebugArtifacts.svelte` — new: debug screenshot grid with lightbox
- `web/src/routes/devices/[id]/inspector/+page.svelte` — new: inspector page with two-column layout
- `web/src/routes/devices/+page.svelte` — added handleRefresh and onrefresh prop
- `web/src/routes/settings/+page.svelte` — added hooks section with full CRUD state management
- `web/src/routes/jobs/[id]/+page.svelte` — added MaestroOptionsPanel, DebugArtifacts, Debug tab
- `web/src/lib/components/devices/DeviceCard.svelte` — added Inspect link, metadata grid, refresh button
