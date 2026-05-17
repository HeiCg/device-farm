---
estimated_steps: 5
estimated_files: 2
---

# T03: Build ScreenshotOverlay and SourceSelector components

**Slice:** S01 — Hierarchy Viewer Canvas
**Milestone:** M003

## Description

The two core UI components for the inspector. ScreenshotOverlay renders the device screenshot with SVG element-bounds rectangles overlaid (R034). SourceSelector is the dropdown for switching hierarchy sources (R033 UI). Both use Svelte 5 runes exclusively.

The coordinate mapping approach (per D019 and research) uses SVG `viewBox` set to the image's natural dimensions. The SVG is sized to match the rendered `<img>` dimensions. SVG internally handles all coordinate scaling — no manual per-rect pixel math needed. This is the simplest and most reliable approach.

**Relevant skill:** `frontend-design` — these are production UI components that should follow the project's Kinetic Console design system (Tailwind v4 with `@theme` tokens). Colors for overlay rects use the project's existing design tokens where appropriate.

## Steps

1. **Create `web/src/lib/components/inspector/ScreenshotOverlay.svelte`**:
   - Props via `$props()`:
     - `screenshotUrl: string` — URL for the device screenshot (from `getScreenshotUrl()`)
     - `nodes: HierarchyNode[]` — hierarchy tree to overlay
     - `selectedNodeId?: string` — optional selected node (for S02 later; highlight with different color)
     - `onNodeClick?: (node: HierarchyNode) => void` — optional click handler (for S02 later)
   - Layout: a container `<div>` with `position: relative`. Inside:
     - `<img>` with `bind:naturalWidth`, `bind:naturalHeight`, `bind:clientWidth`, `bind:clientHeight` — loads the screenshot
     - `<svg>` absolutely positioned over the img, same rendered size as img
     - SVG `viewBox="0 0 {naturalWidth} {naturalHeight}"` — matches device resolution, SVG handles scaling
     - SVG `preserveAspectRatio="xMidYMid meet"` to match img scaling behavior
   - Flatten the hierarchy tree recursively into a flat array of leaf nodes that have `bounds` defined. Use a `$derived` rune for the flattened list.
   - Render `<rect>` per flattened node:
     - `x={bounds[0]}` `y={bounds[1]}` `width={bounds[2] - bounds[0]}` `height={bounds[3] - bounds[1]}`
     - Semi-transparent stroke color based on depth. Use a static `Record<number, string>` lookup for colors per D016 (Tailwind JIT requires full static class strings). Use inline SVG styles rather than Tailwind classes on SVG elements.
     - `fill="none"` (outlines only), `stroke-width` scaled for visibility
     - Optional: `on:click` handler that calls `onNodeClick` with the node
     - Optional: `on:mouseenter`/`on:mouseleave` for hover highlight (prep for S02)
   - Handle loading state: show a loading spinner/skeleton while img is loading (`$state` flag toggled by img `onload`)
   - Handle missing bounds gracefully — nodes without `bounds` are skipped

2. **Handle image resize reactivity**:
   - The `bind:clientWidth` / `bind:clientHeight` on the `<img>` update reactively when the window resizes (Svelte handles this via ResizeObserver internally)
   - Use `$derived` for SVG container dimensions based on img client dimensions
   - The SVG element's `width` and `height` attributes should track the img's `clientWidth` and `clientHeight`

3. **Create `web/src/lib/components/inspector/SourceSelector.svelte`**:
   - Props via `$props()`:
     - `value: HierarchySource` — current selection
     - `onchange: (source: HierarchySource) => void` — callback when user switches
     - `loading?: boolean` — when true, disable the dropdown (prevents switching during fetch)
   - Render a `<select>` element with three `<option>` values:
     - `"maestro-cli"` → label "Maestro CLI"
     - `"device-server"` → label "Device Server (APK)"
     - `"native"` → label "Native (adb/idb)"
   - Style following existing component patterns from the Kinetic Console design system (check existing select/dropdown usage in the codebase for class patterns)
   - Bind `value` to the select, fire `onchange` on change event

4. **Depth-color mapping** for overlay rects:
   - Define a static lookup of depth → SVG stroke color. Example:
     ```typescript
     const depthColors: Record<number, string> = {
       0: 'rgba(59, 130, 246, 0.7)',   // blue
       1: 'rgba(16, 185, 129, 0.7)',   // green
       2: 'rgba(245, 158, 11, 0.7)',   // amber
       3: 'rgba(239, 68, 68, 0.7)',    // red
       4: 'rgba(139, 92, 246, 0.7)',   // purple
       5: 'rgba(236, 72, 153, 0.7)',   // pink
     };
     ```
   - Nodes at depth > 5 cycle back through the palette: `depthColors[depth % 6]`
   - Track depth during the recursive flatten step

5. **Build check**: `npm run web:build` passes with zero errors.

## Must-Haves

- [ ] ScreenshotOverlay renders `<img>` + `<svg>` overlay with `viewBox` matching natural image dimensions
- [ ] Hierarchy tree flattened recursively; each node with `bounds` gets a `<rect>`
- [ ] Bounds `[left, top, right, bottom]` correctly converted to SVG `x, y, width, height`
- [ ] SVG scales correctly when browser window resizes (reactive dimensions)
- [ ] SourceSelector renders 3 options with correct values and fires `onchange`
- [ ] All Tailwind classes are full static strings (D016)
- [ ] Svelte 5 runes only — `$state`, `$derived`, `$props()` (no legacy stores)
- [ ] Loading state shown while screenshot loads

## Verification

- `npm run web:build` — zero errors
- Components accept the documented props and render without runtime errors (verified visually in T04)

## Inputs

- `web/src/lib/api/types.ts` — `HierarchyNode`, `HierarchySource` types (from T02)
- `web/src/lib/api/maestro.ts` — `getScreenshotUrl()` function (from T02)
- Existing component styling patterns from `web/src/lib/components/` (reference for Tailwind classes, layout patterns)

## Expected Output

- `web/src/lib/components/inspector/ScreenshotOverlay.svelte` — screenshot + SVG overlay component
- `web/src/lib/components/inspector/SourceSelector.svelte` — hierarchy source dropdown
