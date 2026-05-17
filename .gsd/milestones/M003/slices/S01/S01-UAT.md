# S01: Hierarchy Viewer Canvas — UAT

**Milestone:** M003
**Written:** 2026-03-19

## UAT Type

- UAT mode: mixed (artifact-driven for builds/tests + live-runtime for visual verification)
- Why this mode is sufficient: Server and web build verification confirms contract correctness. Visual alignment of hierarchy overlays on a live emulator screenshot requires human judgment — no automated pixel comparison can confirm "this rect encloses the correct button."

## Preconditions

- Server running: `npm run dev` from project root (Fastify on :3000)
- At least one Android emulator booted and visible in device pool (`config.yaml` configured)
- Emulator has a visible UI (home screen or an app open) — needed for meaningful hierarchy data
- Web build deployed: `npm run web:build` completed (SvelteKit SPA served by Fastify static plugin)
- Browser open to `http://localhost:3000`

## Smoke Test

Navigate to Devices page → find an Idle device → click "Inspect" link → confirm the inspector page loads with a device screenshot and colored rectangles overlaid on it.

## Test Cases

### 1. Inspector page loads with default Maestro CLI source

1. Navigate to `http://localhost:3000/devices`
2. Find a device card in Idle or Running state
3. Click the "Inspect" link on that device card
4. **Expected:** Browser navigates to `/devices/<deviceId>/inspector`. Page shows:
   - Page title "Device Inspector" with device ID
   - A device screenshot image
   - Colored SVG rectangles overlaid on the screenshot, enclosing visible UI elements
   - Source selector dropdown showing "Maestro CLI" (default)
   - Right panel showing hierarchy info: element count > 0, source "maestro-cli", fetch time in ms

### 2. Source selector switches hierarchy

1. On the inspector page (from test 1), open the source selector dropdown
2. Switch to "Device Server (APK)"
3. **Expected:** Screenshot refreshes (may flicker briefly). Overlay rectangles redraw — may show different element count or layout since device-server parses hierarchy differently than Maestro CLI. Info panel updates to show source "device-server".
4. Switch to "Native (adb/idb)"
5. **Expected:** Overlay redraws with native uiautomator hierarchy. Source shows "native" in info panel.
6. Switch back to "Maestro CLI"
7. **Expected:** Original hierarchy restores.

### 3. Overlay rectangles align with screenshot elements

1. On the inspector page with any source selected, look at the colored rectangles
2. Identify a clearly visible UI element on the screenshot (e.g., a large button, the status bar, a text field)
3. **Expected:** A colored rectangle visually encloses that element. Rects should not be wildly offset — they should overlap the correct screen region. Minor sub-pixel misalignment is acceptable; rects covering the wrong element or floating in empty space is a failure.

### 4. Element click shows properties

1. On the inspector page, click one of the colored rectangles overlaying a UI element
2. **Expected:** Right panel "Selected Element" section populates with:
   - Element type (e.g., "android.widget.Button")
   - ID (if present)
   - Text content (if present)
   - Bounds as `[left, top, right, bottom]`
   - State flags (clickable, enabled, etc.)

### 5. DeviceCard Inspect link state gating

1. Navigate to `http://localhost:3000/devices`
2. Find device cards in different states
3. **Expected:**
   - Idle device: "Inspect" link visible → clicking navigates to inspector
   - Running device: "Inspect" link visible
   - Error device: "Inspect" link NOT visible
   - Offline device: "Inspect" link NOT visible
   - Booting device: "Inspect" link NOT visible

### 6. Inspector error handling

1. Navigate directly to `/devices/nonexistent-device-id/inspector`
2. **Expected:** Page shows error state — "Failed to load hierarchy. Device may not be ready." message with a Retry button. No unhandled JavaScript errors in console.
3. Click Retry
4. **Expected:** Fetch retries. Same error message persists (device still doesn't exist).

## Edge Cases

### Source selector during loading

1. On the inspector page, switch source rapidly (click through all 3 options quickly)
2. **Expected:** No crash, no stale data. The most recent source selection wins. Loading state may flash briefly between switches.

### Empty hierarchy

1. If possible, test with a device that returns an empty hierarchy (e.g., blank screen during boot)
2. **Expected:** Screenshot displays but with no overlay rectangles. Info panel shows element count of 0. No errors.

### Screenshot-only failure

1. If screenshot endpoint fails but hierarchy succeeds (rare edge case)
2. **Expected:** "Screenshot unavailable" message shown in the image area. Hierarchy info panel still populates (element count, source). The page does not crash.

## Failure Signals

- Inspector page shows loading spinner indefinitely — hierarchy endpoint not responding
- Colored rectangles are all positioned at top-left (0,0) — bounds parsing or coordinate mapping broken
- Rectangles do not appear at all despite element count > 0 — SVG overlay rendering broken
- Source dropdown does not change overlay — re-fetch not wired on source change
- Browser console shows JavaScript errors on page load
- "Inspect" link visible on Error/Offline devices — state gating broken
- `npm run web:build` fails with TypeScript errors

## Requirements Proved By This UAT

- R033 — Three hierarchy sources switchable via dropdown (test cases 1, 2). `?source=` query parameter routes correctly on the server.
- R034 — Screenshot displayed with colored rectangle overlays aligned to UI elements (test cases 1, 3). Coordinate mapping via SVG viewBox confirmed visually.

## Not Proven By This UAT

- R034 coordinate accuracy across different device densities (only tested with one emulator resolution)
- Hierarchy parsing correctness for all possible Maestro CLI output variants (edge cases in CLI format)
- iOS native hierarchy (stubbed — only Android uiautomator dump implemented)
- Performance with very deep hierarchy trees (>500 elements)

## Notes for Tester

- The SVG rect a11y warning (`a11y_click_events_have_key_events`) in the build output is expected and non-blocking — SVG shapes as click targets is a known Svelte limitation.
- The "selected node" detail panel in the right column was added beyond the minimum plan scope. It's wired and functional but is primarily a foundation for S02's full element inspector.
- If the emulator has a complex UI open (e.g., Settings app with many nested elements), you should see many colored rectangles at varying depths. Simple screens (home screen) may show fewer elements.
- The three hierarchy sources may return different element counts and tree structures — this is expected since Maestro CLI, device-server, and uiautomator parse the UI differently.
- Coordinate mapping uses SVG viewBox — if rects look wrong, check the browser's Inspector on the `<svg>` element to verify `viewBox` matches the image's natural dimensions.
