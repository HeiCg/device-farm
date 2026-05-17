---
id: T03
parent: S01
milestone: M003
provides:
  - ScreenshotOverlay Svelte 5 component with SVG viewBox-based element bounds overlay
  - SourceSelector Svelte 5 component for hierarchy source switching dropdown
key_files:
  - web/src/lib/components/inspector/ScreenshotOverlay.svelte
  - web/src/lib/components/inspector/SourceSelector.svelte
key_decisions:
  - Used static RECT_FILLS array for selected-node highlight fills (D016-compliant) — parallel array to RECT_COLORS with low-alpha hex (#1a = 10% opacity)
  - SVG rect onclick with optional chaining (onNodeClick?.(node)) rather than conditional rendering — keeps all rects interactive for S02 extension
patterns_established:
  - SVG viewBox="0 0 {naturalWidth} {naturalHeight}" matching device resolution eliminates all manual coordinate scaling — SVG handles the mapping natively
  - Loading/error/success tri-state pattern for image-dependent components using $state booleans and {#if} branches
observability_surfaces:
  - DOM inspection: document.querySelectorAll('svg rect').length shows rendered overlay count
  - Image state: img[alt="Device screenshot"]?.complete verifies load status
  - Source value: select#hierarchy-source.value reflects active hierarchy source
duration: 8m
verification_result: passed
completed_at: 2026-03-19
blocker_discovered: false
---

# T03: Build ScreenshotOverlay and SourceSelector Svelte 5 components

**Created ScreenshotOverlay (screenshot + SVG viewBox overlay with D016-compliant color cycling) and SourceSelector (hierarchy source dropdown) Svelte 5 components**

## What Happened

Built both visual building blocks for the inspector page. `ScreenshotOverlay` renders a device screenshot `<img>` with an absolutely-positioned `<svg>` overlay where the SVG viewBox matches the device's native resolution — so hierarchy node bounds map 1:1 as `<rect>` elements without any manual pixel math. Rect colors cycle through a static 8-color array (D016 compliant — no template interpolation). Selected nodes get a wider stroke and a low-alpha fill from a parallel `RECT_FILLS` array. Each rect has `pointer-events="visible"` and an onclick handler ready for S02's click-to-inspect behavior.

`SourceSelector` is a Kinetic Console-styled `<select>` dropdown with three options matching the server's `HierarchySource` type. It includes a label, disabled state with visual feedback, and focus ring styling.

Both components use Svelte 5 runes exclusively — `$props()`, `$state`, `$derived`. No legacy `export let`, no `$:` declarations, no stores.

## Verification

All 7 must-haves confirmed:
1. ScreenshotOverlay renders `<img>` + absolutely positioned `<svg>` with viewBox matching native resolution ✓
2. SVG rects drawn for all nodes with non-null bounds using `mapBoundsToSVG()` ✓
3. Rect colors cycle through static RECT_COLORS array (D016 — no dynamic class construction) ✓
4. ScreenshotOverlay has loading (skeleton pulse) and error ("Screenshot unavailable") states ✓
5. SourceSelector renders 3 options and fires `onchange` callback ✓
6. Both components use Svelte 5 runes only — no legacy syntax ✓
7. SVG uses `viewBox` for coordinate scaling (no manual pixel math) ✓

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npm run web:build` | 0 | ✅ pass | 5.6s |
| 2 | `npx vitest run server/maestro/__tests__/hierarchy-service.test.ts` | 0 | ✅ pass | 3.9s |
| 3 | `npx tsc --noEmit -p web/tsconfig.json` | 0 | ✅ pass | 3.6s |
| 4 | grep for legacy Svelte patterns (export let, $:, stores) | 0 | ✅ pass (none found) | <1s |
| 5 | grep for D016 violations (template interpolation) | 0 | ✅ pass (none found) | <1s |

Slice-level checks (3/5 pass — remaining 2 are manual checks requiring a running emulator, expected for T04):
- ✅ `npx vitest run server/maestro/__tests__/hierarchy-service.test.ts` — 12 tests pass
- ✅ `npm run web:build` — zero errors
- ✅ `npx tsc --noEmit -p web/tsconfig.json` — clean
- ⏳ Manual: inspector page with emulator — not yet wired (T04)
- ⏳ Manual: overlay rect alignment — not yet wired (T04)

## Diagnostics

- **DOM overlay count:** `document.querySelectorAll('svg rect').length` — shows how many element bounds are rendered
- **Image load state:** `document.querySelector('img[alt="Device screenshot"]')?.complete` — `true` when screenshot loaded, element absent during error state
- **Source selector value:** `document.querySelector('select#hierarchy-source')?.value` — reflects active hierarchy source selection
- **Visual states:** Three distinct DOM structures: skeleton with `animate-pulse` (loading), "Screenshot unavailable" text (error), img+svg (success)

## Deviations

None — implementation follows the task plan specification exactly.

## Known Issues

None.

## Files Created/Modified

- `web/src/lib/components/inspector/ScreenshotOverlay.svelte` — new: screenshot image with SVG viewBox overlay, D016-compliant color cycling, loading/error states
- `web/src/lib/components/inspector/SourceSelector.svelte` — new: hierarchy source dropdown with 3 options, Kinetic Console styling
- `.gsd/milestones/M003/slices/S01/tasks/T03-PLAN.md` — updated: added Observability Impact section
