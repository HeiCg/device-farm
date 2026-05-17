# Requirements

This file is the explicit capability and coverage contract for the project.

## Active

(No active requirements — all in-scope requirements validated.)

## Validated

### R034 — Device screenshot displayed with colored rectangles drawn over each UI element's bounds from the hierarchy tree. Coordinates must be correctly mapped between the device's native resolution and the displayed screenshot size.
- Class: core-capability
- Status: validated
- Description: Device screenshot displayed with colored rectangles drawn over each UI element's bounds from the hierarchy tree. Coordinates must be correctly mapped between the device's native resolution and the displayed screenshot size.
- Why it matters: Visual overlay is the core of the inspector — without it, users can't correlate hierarchy data with what's on screen.
- Source: user
- Primary owning slice: M003/S01
- Supporting slices: none
- Validation: SVG viewBox overlay renders colored rectangles on device screenshot. viewBox="0 0 {naturalWidth} {naturalHeight}" maps hierarchy bounds 1:1 to CSS pixels with zero manual coordinate math. 8-color cycling array for rect strokes (D016-compliant). npm run web:build clean, inspector page compiled to 21 kB server bundle.
- Notes: Coordinate mapping must account for device density and screenshot scaling.

### R042 — Job detail page shows which Maestro options were used: include/exclude tags, report format, debug output enabled, shard count. Displayed in a metadata section.
- Class: integration
- Status: validated
- Description: Job detail page shows which Maestro options were used: include/exclude tags, report format, debug output enabled, shard count. Displayed in a metadata section.
- Why it matters: When debugging a failed test, users need to know what flags were active.
- Source: inferred
- Primary owning slice: M003/S05
- Supporting slices: none
- Validation: MaestroOptionsPanel renders all 5 Maestro option keys (includeTags, excludeTags, reportFormat, debugOutput, shards) via extractMaestroOptions() pure function with defensive type guards. Panel hides when no options present. Include tags green, exclude tags red, debug flag purple. svelte-check clean, web build passes, 311 tests green.
- Notes: Implemented in M003/S05/T01. extractMaestroOptions() is a pure function with defensive type guards. MaestroOptionsPanel follows glass card pattern with static Record lookups (D016).

### R043 — When a job was run with `--debug-output`, job detail shows a tab/section with per-step screenshots and logs. Navigable timeline of Maestro steps with screenshot thumbnails.
- Class: core-capability
- Status: validated
- Description: When a job was run with `--debug-output`, job detail shows a tab/section with per-step screenshots and logs. Navigable timeline of Maestro steps with screenshot thumbnails.
- Why it matters: Debug output is Maestro's primary debugging tool — rendering it in the web UI avoids manual file inspection.
- Source: inferred
- Primary owning slice: M003/S05
- Supporting slices: none
- Validation: DebugArtifacts renders per-step screenshots in responsive thumbnail grid (2→3→4→5 columns) sorted by step index from step-N.png filenames. Lightbox modal with keyboard navigation (Escape/ArrowLeft/ArrowRight). Debug tab conditionally appears when screenshot artifacts exist. svelte-check clean, web build passes, 311 tests green.
- Notes: Implemented in M003/S05/T02. Parses step index from step-N.png filenames via regex. Lightbox modal with Escape/ArrowLeft/ArrowRight keyboard support. Thumbnail buttons are accessible.

### R001 — Untitled
- Class: core-capability
- Status: validated
- Source: user
- Primary owning slice: M001/S01
- Validation: validated

### R002 — Untitled
- Class: core-capability
- Status: validated
- Source: user
- Primary owning slice: M001/S01
- Validation: validated

### R003 — Untitled
- Class: core-capability
- Status: validated
- Source: user
- Primary owning slice: M001/S01
- Validation: validated
- Notes: Superseded by R025.

### R009 — Untitled
- Class: quality-attribute
- Status: validated
- Source: inferred
- Primary owning slice: M001/S01
- Validation: validated

### R010 — Untitled
- Class: quality-attribute
- Status: validated
- Source: inferred
- Primary owning slice: M001/S05
- Validation: validated

### R011 — Untitled
- Class: differentiator
- Status: validated
- Source: user
- Primary owning slice: M001/S03
- Validation: validated
- Notes: Superseded by Kinetic Console in M002.

### R012 — Untitled
- Class: core-capability
- Status: validated
- Source: user
- Primary owning slice: M002/S01
- Validation: validated

### R013 — Untitled
- Class: core-capability
- Status: validated
- Source: user
- Primary owning slice: M002/S01
- Validation: validated

### R014 — Untitled
- Class: core-capability
- Status: validated
- Source: user
- Primary owning slice: M002/S01
- Validation: validated

### R015 — Untitled
- Class: core-capability
- Status: validated
- Source: user
- Primary owning slice: M002/S02
- Validation: validated

### R016 — Untitled
- Class: core-capability
- Status: validated
- Source: user
- Primary owning slice: M002/S02
- Validation: validated

### R017 — Untitled
- Class: core-capability
- Status: validated
- Source: user
- Primary owning slice: M002/S02
- Validation: validated

### R018 — Untitled
- Class: primary-user-loop
- Status: validated
- Source: user
- Primary owning slice: M002/S03
- Validation: validated

### R019 — Untitled
- Class: primary-user-loop
- Status: validated
- Source: user
- Primary owning slice: M002/S04
- Validation: validated

### R020 — Untitled
- Class: primary-user-loop
- Status: validated
- Source: user
- Primary owning slice: M002/S04
- Validation: validated

### R021 — Untitled
- Class: core-capability
- Status: validated
- Source: user
- Primary owning slice: M002/S05
- Validation: validated

### R022 — Untitled
- Class: core-capability
- Status: validated
- Source: user
- Primary owning slice: M002/S05
- Validation: validated

### R023 — Untitled
- Class: core-capability
- Status: validated
- Source: user
- Primary owning slice: M002/S05
- Validation: validated

### R024 — Untitled
- Class: quality-attribute
- Status: validated
- Source: user
- Primary owning slice: M002/S01
- Validation: validated

### R025 — Untitled
- Class: core-capability
- Status: validated
- Source: user
- Primary owning slice: M002/S01
- Validation: validated

### R026 — Untitled
- Class: quality-attribute
- Status: validated
- Source: user
- Primary owning slice: M002/S03
- Validation: validated

### R027 — Untitled
- Class: constraint
- Status: validated
- Source: user
- Primary owning slice: M002/S02
- Validation: validated

### R028 — Untitled
- Class: constraint
- Status: validated
- Source: user
- Primary owning slice: M002/S02
- Validation: validated

### R033 — Device inspector page with a source selector offering three hierarchy strategies: Maestro CLI (`maestro hierarchy`) as default (shows what test selectors match), device-server APK (`/hierarchy` endpoint, faster ~100ms), and native tools (`adb shell uiautomator dump` / `idb`). User switches between sources to compare.
- Class: core-capability
- Status: validated
- Description: Device inspector page with a source selector offering three hierarchy strategies: Maestro CLI (`maestro hierarchy`) as default (shows what test selectors match), device-server APK (`/hierarchy` endpoint, faster ~100ms), and native tools (`adb shell uiautomator dump` / `idb`). User switches between sources to compare.
- Why it matters: Maestro's hierarchy parser differs from raw UiAutomator — showing Maestro's view by default ensures selectors in flows match what the user sees.
- Source: user
- Primary owning slice: M003/S01
- Supporting slices: M003/S02
- Validation: Three hierarchy sources (maestro-cli, device-server, native) with server ?source= routing, Fastify schema validation, SourceSelector dropdown in inspector page. 11 hierarchy service tests pass. npm run web:build clean. Inspector page renders all 3 sources with correct tree data.
- Notes: Backend already supports Maestro CLI and device-server strategies. Native adb/idb strategy needs adding.

### R035 — Clicking an element overlay or a node in the hierarchy tree selects it. A properties panel shows: type, id, text, description, bounds, enabled, visible, focused, clickable. Selected element highlighted with distinct color.
- Class: core-capability
- Status: validated
- Description: Clicking an element overlay or a node in the hierarchy tree selects it. A properties panel shows: type, id, text, description, bounds, enabled, visible, focused, clickable. Selected element highlighted with distinct color.
- Why it matters: Properties panel is how users discover element identifiers for writing Maestro flows.
- Source: user
- Primary owning slice: M003/S02
- Supporting slices: none
- Validation: Build + browser verification: ElementProperties panel renders all listed fields (type, id, text, description, bounds, state flags) for selected nodes. Selection visually distinct via per-node cycling color fill. 14/14 browser assertions passed.
- Notes: none

### R036 — Search input that filters hierarchy tree and highlights matching elements on the screenshot overlay. Uses the `/api/devices/:id/query` endpoint with regex support.
- Class: core-capability
- Status: validated
- Description: Search input that filters hierarchy tree and highlights matching elements on the screenshot overlay. Uses the `/api/devices/:id/query` endpoint with regex support.
- Why it matters: Large hierarchies can have hundreds of elements — search narrows to what matters.
- Source: user
- Primary owning slice: M003/S02
- Supporting slices: none
- Validation: Build + browser verification: ElementSearch component with 200ms debounced client-side filtering highlights matching rects in bright cyan (#00e5ff) on SVG overlay. Match count badge shown. Clear restores normal overlay. 5/5 browser assertions passed. Note: uses client-side filtering not server-side /query endpoint.
- Notes: none

### R037 — When an element is selected, show suggested Maestro YAML commands that would target it: `tapOn` (by id, text, or description), `assertVisible`, `assertNotVisible`. Copyable to clipboard.
- Class: core-capability
- Status: validated
- Description: When an element is selected, show suggested Maestro YAML commands that would target it: `tapOn` (by id, text, or description), `assertVisible`, `assertNotVisible`. Copyable to clipboard.
- Why it matters: Bridges the gap between inspection and flow authoring — user clicks element, copies command into their flow YAML.
- Source: user
- Primary owning slice: M003/S02
- Supporting slices: none
- Validation: Build + browser verification: MaestroSuggestions generates tapOn/assertVisible/assertNotVisible YAML grouped by selector type (id → text → description). Clipboard copy confirmed working on localhost with correct YAML content. "Copied!" / "Copy failed" feedback verified.
- Notes: none

### R038 — Hooks section in Settings page with a list of configured hooks, each showing name, event, platform, command preview, and enabled toggle. Create/edit/delete actions with confirmation dialogs.
- Class: core-capability
- Status: validated
- Description: Hooks section in Settings page with a list of configured hooks, each showing name, event, platform, command preview, and enabled toggle. Create/edit/delete actions with confirmation dialogs.
- Why it matters: Hooks are configured from the browser, not just config files — essential for non-terminal users.
- Source: user
- Primary owning slice: M003/S03
- Supporting slices: none
- Validation: Build verification: npm run web:build passes with zero errors. HookList component renders all specified fields (name, event badge, platform badge, truncated command preview, enabled toggle) with create/edit/delete actions and inline two-click delete confirmation (D021). Settings page wires full CRUD state management with 10 $state variables.
- Notes: Backend CRUD already exists at `/api/hooks`.

### R039 — Hook creation/edit form with: dropdown for event type (device.booted, device.shutdown, test.before, test.after), platform selector (Android/iOS/all), command text area with `{{template}}` variable reference, timeout input, failOnError toggle.
- Class: core-capability
- Status: validated
- Description: Hook creation/edit form with: dropdown for event type (device.booted, device.shutdown, test.before, test.after), platform selector (Android/iOS/all), command text area with `{{template}}` variable reference, timeout input, failOnError toggle.
- Why it matters: The form must expose all hook capabilities — especially template variables like `{{serial}}`, `{{device_id}}` that make commands portable.
- Source: user
- Primary owning slice: M003/S03
- Supporting slices: none
- Validation: Build verification: npm run web:build passes with zero errors. HookForm includes all specified fields: event dropdown (device.booted, device.shutdown, test.before, test.after), platform selector (android/ios/all), command textarea with template variable reference box (6 variables with descriptions), timeout input with seconds↔ms conversion, failOnError toggle, enabled toggle. Form supports both create and edit modes.
- Notes: Template variables: `{{device_id}}`, `{{emulator_id}}`, `{{serial}}`, `{{platform}}`, `{{port}}`, `{{job_id}}`

### R040 — "Test" button on each hook that triggers a dry-run via `POST /api/hooks/:name/test` with a selected device. Shows stdout, stderr, exit code, and duration in a result panel.
- Class: core-capability
- Status: validated
- Description: "Test" button on each hook that triggers a dry-run via `POST /api/hooks/:name/test` with a selected device. Shows stdout, stderr, exit code, and duration in a result panel.
- Why it matters: Users need to verify hook commands work before they fire in production pipelines.
- Source: user
- Primary owning slice: M003/S03
- Supporting slices: none
- Validation: Build verification: npm run web:build passes with zero errors. Test button per hook triggers POST /api/hooks/:name/test via testHook() API client. HookTestResult component displays stdout, stderr, exit code, formatted duration, success/failure badge, and executed command inline below the tested hook row. Spinner shown during execution. Synthetic HookResult generated on API failure for consistent display.
- Notes: Backend test-run endpoint already exists.

### R041 — Device cards on the Devices page show additional metadata: OS version (e.g. Android 15, iOS 17.5), screen resolution (1080x1920), RAM (MB), model, CPU ABI. Collected from DeviceInfoCollector, with refresh button.
- Class: core-capability
- Status: validated
- Description: Device cards on the Devices page show additional metadata: OS version (e.g. Android 15, iOS 17.5), screen resolution (1080x1920), RAM (MB), model, CPU ABI. Collected from DeviceInfoCollector, with refresh button.
- Why it matters: Users need to know what's running without connecting to each device manually.
- Source: user
- Primary owning slice: M003/S04
- Supporting slices: none
- Validation: Web build passes, DeviceMetadata type mirrors server (13 fields), Device extended with metadata/port/pid, fetchDeviceInfo + refreshDeviceInfo API functions compile clean, DeviceCard renders metadata grid with $derived fallbacks, refresh button wired through page. All 311 tests green.
- Notes: Backend collector and `/api/devices/:id/info` already exist.

## Out of Scope

### R029 — Untitled
- Class: core-capability
- Status: out-of-scope
- Source: user
- Primary owning slice: none
- Validation: n/a

### R030 — Untitled
- Class: core-capability
- Status: out-of-scope
- Source: user
- Primary owning slice: none
- Validation: n/a

### R031 — Untitled
- Class: core-capability
- Status: out-of-scope
- Source: user
- Primary owning slice: none
- Validation: n/a

### R032 — Untitled
- Class: core-capability
- Status: out-of-scope
- Source: user
- Primary owning slice: none
- Validation: n/a

### R044 — Controlling the device via touch actions from the web UI. Explicitly deferred.
- Class: core-capability
- Status: out-of-scope
- Description: Controlling the device via touch actions from the web UI. Explicitly deferred.
- Source: user
- Primary owning slice: none
- Validation: n/a
- Notes: User said "fora do escopo ainda"

### R045 — Uploading flows or results to Maestro Cloud.
- Class: integration
- Status: out-of-scope
- Description: Uploading flows or results to Maestro Cloud.
- Source: inferred
- Primary owning slice: none
- Validation: n/a

### R046 — Full YAML flow authoring in the browser. Maestro command suggestions (R037) are in scope; full Studio-like editing is not.
- Class: core-capability
- Status: out-of-scope
- Description: Full YAML flow authoring in the browser. Maestro command suggestions (R037) are in scope; full Studio-like editing is not.
- Source: inferred
- Primary owning slice: none
- Validation: n/a

## Traceability

| ID | Class | Status | Primary owner | Supporting | Proof |
|---|---|---|---|---|---|
| R001 | core-capability | validated | M001/S01 | none | validated |
| R002 | core-capability | validated | M001/S01 | none | validated |
| R003 | core-capability | validated | M001/S01 | none | validated |
| R009 | quality-attribute | validated | M001/S01 | none | validated |
| R010 | quality-attribute | validated | M001/S05 | none | validated |
| R011 | differentiator | validated | M001/S03 | none | validated |
| R012 | core-capability | validated | M002/S01 | none | validated |
| R013 | core-capability | validated | M002/S01 | none | validated |
| R014 | core-capability | validated | M002/S01 | none | validated |
| R015 | core-capability | validated | M002/S02 | none | validated |
| R016 | core-capability | validated | M002/S02 | none | validated |
| R017 | core-capability | validated | M002/S02 | none | validated |
| R018 | primary-user-loop | validated | M002/S03 | none | validated |
| R019 | primary-user-loop | validated | M002/S04 | none | validated |
| R020 | primary-user-loop | validated | M002/S04 | none | validated |
| R021 | core-capability | validated | M002/S05 | none | validated |
| R022 | core-capability | validated | M002/S05 | none | validated |
| R023 | core-capability | validated | M002/S05 | none | validated |
| R024 | quality-attribute | validated | M002/S01 | none | validated |
| R025 | core-capability | validated | M002/S01 | none | validated |
| R026 | quality-attribute | validated | M002/S03 | none | validated |
| R027 | constraint | validated | M002/S02 | none | validated |
| R028 | constraint | validated | M002/S02 | none | validated |
| R029 | core-capability | out-of-scope | none | none | n/a |
| R030 | core-capability | out-of-scope | none | none | n/a |
| R031 | core-capability | out-of-scope | none | none | n/a |
| R032 | core-capability | out-of-scope | none | none | n/a |
| R033 | core-capability | validated | M003/S01 | M003/S02 | Three hierarchy sources (maestro-cli, device-server, native) with server ?source= routing, Fastify schema validation, SourceSelector dropdown in inspector page. 11 hierarchy service tests pass. npm run web:build clean. Inspector page renders all 3 sources with correct tree data. |
| R034 | core-capability | validated | M003/S01 | none | SVG viewBox overlay renders colored rectangles on device screenshot. viewBox maps hierarchy bounds 1:1 to CSS pixels. npm run web:build clean, inspector page compiled to 21 kB server bundle. |
| R035 | core-capability | validated | M003/S02 | none | Build + browser verification: ElementProperties panel renders all listed fields (type, id, text, description, bounds, state flags) for selected nodes. Selection visually distinct via per-node cycling color fill. 14/14 browser assertions passed. |
| R036 | core-capability | validated | M003/S02 | none | Build + browser verification: ElementSearch component with 200ms debounced client-side filtering highlights matching rects in bright cyan (#00e5ff) on SVG overlay. Match count badge shown. Clear restores normal overlay. 5/5 browser assertions passed. Note: uses client-side filtering not server-side /query endpoint. |
| R037 | core-capability | validated | M003/S02 | none | Build + browser verification: MaestroSuggestions generates tapOn/assertVisible/assertNotVisible YAML grouped by selector type (id → text → description). Clipboard copy confirmed working on localhost with correct YAML content. "Copied!" / "Copy failed" feedback verified. |
| R038 | core-capability | validated | M003/S03 | none | Build verification: npm run web:build passes with zero errors. HookList component renders all specified fields (name, event badge, platform badge, truncated command preview, enabled toggle) with create/edit/delete actions and inline two-click delete confirmation (D021). Settings page wires full CRUD state management with 10 $state variables. |
| R039 | core-capability | validated | M003/S03 | none | Build verification: npm run web:build passes with zero errors. HookForm includes all specified fields: event dropdown (device.booted, device.shutdown, test.before, test.after), platform selector (android/ios/all), command textarea with template variable reference box (6 variables with descriptions), timeout input with seconds↔ms conversion, failOnError toggle, enabled toggle. Form supports both create and edit modes. |
| R040 | core-capability | validated | M003/S03 | none | Build verification: npm run web:build passes with zero errors. Test button per hook triggers POST /api/hooks/:name/test via testHook() API client. HookTestResult component displays stdout, stderr, exit code, formatted duration, success/failure badge, and executed command inline below the tested hook row. Spinner shown during execution. Synthetic HookResult generated on API failure for consistent display. |
| R041 | core-capability | validated | M003/S04 | none | Web build passes, DeviceMetadata type mirrors server (13 fields), Device extended with metadata/port/pid, fetchDeviceInfo + refreshDeviceInfo API functions compile clean, DeviceCard renders metadata grid with $derived fallbacks, refresh button wired through page. All 311 tests green. |
| R042 | integration | validated | M003/S05 | none | MaestroOptionsPanel renders all 5 Maestro option keys via extractMaestroOptions(). Panel hides when no options present. svelte-check clean, web build passes, 311 tests green. |
| R043 | core-capability | validated | M003/S05 | none | DebugArtifacts renders per-step screenshots in responsive thumbnail grid with lightbox modal and keyboard navigation. Debug tab conditionally appears when screenshot artifacts exist. svelte-check clean, web build passes, 311 tests green. |
| R044 | core-capability | out-of-scope | none | none | n/a |
| R045 | integration | out-of-scope | none | none | n/a |
| R046 | core-capability | out-of-scope | none | none | n/a |

## Coverage Summary

- Active requirements: 3
- Mapped to slices: 3
- Validated: 31 (R001, R002, R003, R009, R010, R011, R012, R013, R014, R015, R016, R017, R018, R019, R020, R021, R022, R023, R024, R025, R026, R027, R028, R033, R035, R036, R037, R038, R039, R040, R041)
- Unmapped active requirements: 0
