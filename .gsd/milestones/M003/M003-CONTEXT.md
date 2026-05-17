# M003: Maestro Integration UI — Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

## Project Description

Build the web UI layer that turns Device Farm from a "submit tests and see results" tool into a complete Maestro inspection and configuration environment. Three main surfaces: an interactive hierarchy viewer with 3-source selector, a hooks management tool in Settings, and enriched device/job displays.

## Why This Milestone

The server-side Maestro integration is built (hierarchy service, hooks executor, device info collector, screenshot endpoints) but none of it is visible to users. Without a UI, the hierarchy service, hooks system, and device metadata are API-only — usable from CLI but invisible from the dashboard.

## User-Visible Outcome

### When this milestone is complete, the user can:

- Open a device inspector page, see a live screenshot with colored element bounds overlaid, switch between Maestro/APK/native hierarchy sources, click elements to see properties, search elements, and copy suggested Maestro commands
- Open Settings, create lifecycle hooks (adb for Android, idb for iOS) that fire on device boot/shutdown and test start/end, and test-run them against live devices
- See OS version, screen resolution, RAM, and model on each device card
- See Maestro execution options (tags, format, debug, shards) in job detail and browse per-step debug screenshots

### Entry point / environment

- Entry point: SvelteKit web UI at `http://localhost:3000`
- Environment: local dev (browser) against running server with emulators
- Live dependencies: Maestro CLI, device-stream android-server (:9008), WDA (:8100), adb, idb

## Completion Class

- Contract complete means: `npm run web:build` passes, all 300+ existing tests green, new API client functions typed
- Integration complete means: hierarchy viewer renders real data from a running emulator, hooks CRUD round-trips through the API
- Operational complete means: none (dev environment only)

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- Hierarchy viewer renders element bounds on a real device screenshot with correct coordinate mapping
- Source selector switches between Maestro/APK/native hierarchies and the tree updates
- A hook can be created, edited, tested, and deleted entirely from the Settings page
- Device cards show real OS/screen/RAM metadata from a running emulator
- Job detail displays Maestro-specific options and debug artifacts

## Risks and Unknowns

- **Coordinate mapping** between hierarchy bounds (device pixels) and displayed screenshot (CSS pixels) — different densities, scaling factors, aspect ratios
- **Maestro CLI hierarchy output format** is text-based and not formally documented — parsing is fragile, may vary between Maestro versions
- **Native adb uiautomator dump** format differs from device-server hierarchy — normalization needed
- **Debug output directory structure** from `maestro --debug-output` may vary — need to discover actual file layout

## Existing Codebase / Prior Art

- `server/maestro/hierarchy-service.ts` — HierarchyService with 3 strategies (device-server, WDA, maestro CLI), tree normalization, element query
- `server/maestro/plugin.ts` — Maestro plugin with hierarchy/query/screenshot/info/state routes
- `server/hooks/hook-executor.ts` — HookExecutor with 4 lifecycle events, template interpolation, timeout handling
- `server/hooks/plugin.ts` — Hooks plugin with full CRUD API routes and test-run endpoint
- `server/pool/device-info-collector.ts` — DeviceInfoCollector collecting OS, screen, RAM, ABI via adb/xcrun
- `web/src/lib/components/devices/DeviceCard.svelte` — existing card component (needs metadata expansion)
- `web/src/lib/components/devices/DevicePreview.svelte` — existing WebSocket-based live preview (hierarchy viewer complements this)
- `web/src/routes/settings/+page.svelte` — existing Settings page (hooks section added here)
- `web/src/routes/jobs/[id]/+page.svelte` — existing Job Detail (Maestro options + debug artifacts added here)

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions.

## Relevant Requirements

- R033-R037 — Hierarchy viewer capabilities
- R038-R040 — Hooks management UI
- R041 — Enriched device cards
- R042-R043 — Maestro options and debug artifacts

## Scope

### In Scope

- Device inspector page with screenshot + hierarchy overlay
- 3 hierarchy sources: Maestro CLI (default), device-server APK, native adb/idb
- Element selection, properties panel, search/query
- Maestro command suggestions (tapOn, assertVisible, etc.)
- Hooks CRUD in Settings (create/edit/delete/toggle/test-run)
- Enriched device cards with metadata
- Maestro options display in job detail
- Debug output viewer (per-step screenshots)
- New route: `/devices/[id]/inspector` for the hierarchy viewer
- API client extensions for all new endpoints

### Out of Scope / Non-Goals

- Device interaction from browser (tap/swipe/type) — R044
- Maestro Cloud integration — R045
- Flow editor / Studio replication — R046
- New server-side endpoints (already built)

## Technical Constraints

- Must follow Kinetic Console design system (dark theme, glass cards, tonal layering, ghost borders)
- D016: Full static Tailwind class strings in Record lookups — no template interpolation
- D017: `$derived` for reactive lookups in Svelte 5
- Canvas/SVG overlay must handle responsive sizing without layout shifts
- All hierarchy sources must normalize to the same `HierarchyNode` interface

## Integration Points

- `GET /api/devices/:id/hierarchy` — hierarchy tree with source param
- `GET /api/devices/:id/screenshot` — on-demand screenshot
- `GET /api/devices/:id/state` — combined endpoint (Android device-server single round-trip)
- `GET /api/devices/:id/query?text=&id=` — element search
- `GET /api/devices/:id/info` + `POST .../refresh` — device metadata
- `GET/POST/PUT/DELETE /api/hooks` — hooks CRUD
- `POST /api/hooks/:name/test` — hook dry-run
- Maestro CLI: `maestro hierarchy --device <serial>` for default hierarchy source

## Open Questions

- **Canvas vs SVG for overlay** — Canvas is faster for many elements but SVG gives free hover/click events. Leaning SVG since hierarchy trees rarely exceed ~500 elements visible at once.
- **Hierarchy refresh rate** — on-demand (button) vs periodic poll. Leaning on-demand with explicit refresh button to avoid hammering the device.
