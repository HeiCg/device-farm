# M003: Maestro Integration UI

**Vision:** Transform Device Farm's web UI into a complete Maestro inspection and configuration environment — hierarchy viewer with element bounds overlay, hooks management, enriched device cards, and Maestro debug artifact display.

## Success Criteria

- User can open a device inspector, see screenshot with element bounds overlays, and switch between 3 hierarchy sources
- User can click an element and see its properties, search by text/id, and copy suggested Maestro commands
- User can create, edit, test-run, and delete lifecycle hooks from the Settings page
- Device cards show real OS version, screen resolution, RAM, and model from running devices
- Job detail shows Maestro-specific execution options and per-step debug screenshots

## Key Risks / Unknowns

- **Coordinate mapping** — bounds from hierarchy (device pixels) must map correctly to the displayed screenshot (CSS pixels) across different device densities and aspect ratios
- **Maestro CLI output format** — text-based hierarchy output is not formally documented and may change between versions
- **Debug output directory layout** — Maestro's `--debug-output` file structure needs discovery

## Proof Strategy

- Coordinate mapping → retire in S01 by rendering bounds on a real emulator screenshot and verifying visual alignment
- Maestro CLI parsing → retire in S01 by testing all 3 hierarchy sources against a running device
- Debug output layout → retire in S05 by running a test with `--debug-output` and rendering the artifacts

## Verification Classes

- Contract verification: `npm run web:build` passes, all 300+ existing tests green, TypeScript clean
- Integration verification: hierarchy viewer renders real data from running emulator, hooks round-trip through API
- Operational verification: none (dev environment)
- UAT / human verification: visual inspection of hierarchy overlays, hooks creation flow, device cards

## Milestone Definition of Done

This milestone is complete only when all are true:

- All 5 slice deliverables are complete and verified
- Hierarchy viewer renders element bounds overlaid on live device screenshot with all 3 sources
- Hooks can be created, edited, tested, and deleted from the Settings page
- Device cards display real metadata from running emulators
- Job detail displays Maestro execution options and debug artifacts
- `npm run web:build` passes with zero errors
- All existing 300+ tests still green
- Navigation updated to include device inspector route

## Requirement Coverage

- Covers: R033, R034, R035, R036, R037, R038, R039, R040, R041, R042, R043
- Partially covers: none
- Leaves for later: R044 (device interaction), R045 (Cloud), R046 (flow editor)
- Orphan risks: none

## Slices

- [x] **S01: Hierarchy Viewer Canvas** `risk:high` `depends:[]`
  > After this: Navigate to `/devices/:id/inspector`, see live screenshot with colored element bounds overlays, switch between Maestro/APK/Native hierarchy sources via selector dropdown.

- [x] **S02: Element Inspector & Maestro Suggestions** `risk:medium` `depends:[S01]`
  > After this: Click an element overlay → properties panel shows id/text/bounds/clickable. Search elements by text/id. Selected element shows copyable Maestro commands (tapOn, assertVisible).

- [x] **S03: Hooks Management UI** `risk:low` `depends:[]`
  > After this: Open Settings → Hooks section. Create a hook with event/platform/command/template variables. Toggle enabled. Test-run against a live device and see stdout/stderr/exit code.

- [x] **S04: Enriched Device Cards** `risk:low` `depends:[]`
  > After this: Each device card on the Devices page shows OS version, screen resolution, RAM, model, ABI. Refresh button re-collects metadata.

- [x] **S05: Maestro Options & Debug Artifacts** `risk:low` `depends:[]`
  > After this: Job detail shows tags/format/shards/debug flags in metadata section. New "Debug" tab with per-step screenshots from Maestro `--debug-output`.

## Boundary Map

### S01 → S02

Produces:
- `web/src/routes/devices/[id]/inspector/+page.svelte` — inspector page with screenshot canvas, hierarchy overlay (SVG), source selector
- `web/src/lib/api/maestro.ts` — API client for hierarchy/screenshot/state/query endpoints
- `web/src/lib/components/inspector/ScreenshotOverlay.svelte` — screenshot + SVG bounds overlay component
- `HierarchyNode` TypeScript type in `web/src/lib/api/types.ts`
- Coordinate mapping utility function (device pixels → CSS pixels)

Consumes:
- nothing (first slice)

### S01 → S05

Produces:
- `web/src/lib/api/maestro.ts` — shared API client (reused for debug artifacts)

Consumes:
- nothing

### S03 (independent)

Produces:
- `web/src/lib/api/hooks.ts` — API client for hooks CRUD
- Hooks section in Settings page
- `HookDefinition` type in `web/src/lib/api/types.ts`

Consumes:
- nothing (independent of S01/S02)

### S04 (independent)

Produces:
- Extended `Device` type with `metadata` field in `web/src/lib/api/types.ts`
- Enhanced `DeviceCard.svelte` with metadata display
- `fetchDeviceInfo()` / `refreshDeviceInfo()` in `web/src/lib/api/devices.ts`

Consumes:
- nothing (independent)

### S05 (independent, uses S01 API client)

Produces:
- Maestro options metadata section in job detail
- Debug artifacts tab/viewer in job detail
- `fetchDebugArtifacts()` in API client

Consumes from S01:
- `web/src/lib/api/maestro.ts` (if already created; otherwise creates its own)
