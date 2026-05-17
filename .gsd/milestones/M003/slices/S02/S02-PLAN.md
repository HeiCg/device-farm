# S02: Element Inspector & Maestro Suggestions

**Goal:** Clicking an element overlay opens a properties panel with id/text/bounds/state flags. A search input filters elements and highlights matches on the overlay. Selected elements show copyable Maestro YAML commands (tapOn, assertVisible, assertNotVisible).
**Demo:** Navigate to `/devices/:id/inspector` → click a rect overlay → properties panel appears with all attributes → Maestro commands section shows tapOn/assertVisible/assertNotVisible with correct selectors → copy button copies YAML to clipboard. Type in search box → matching elements highlight on overlay with distinct color → clear search restores normal view.

## Must-Haves

- ElementProperties panel displays type, id, text, description, bounds, enabled, visible, focused, clickable for selected node
- MaestroSuggestions generates tapOn, assertVisible, assertNotVisible commands using best available selector (id → text → description)
- Copy button on each command writes YAML to clipboard with transient "Copied!" feedback
- Search input with debounced client-side filtering highlights matching nodes on the SVG overlay
- Search highlight uses a visually distinct color/style from the normal rect cycling colors and from the selection highlight
- All new components use Svelte 5 runes exclusively ($state, $derived, $props, $effect)
- All color/style classes are static strings in Record lookups (D016)
- No new npm dependencies

## Proof Level

- This slice proves: integration (UI components consuming S01's hierarchy data and overlay infrastructure)
- Real runtime required: no (mocked hierarchy data sufficient for build verification; live emulator for UAT)
- Human/UAT required: yes (visual inspection of overlay highlights, clipboard behavior)

## Verification

- `npm run web:build` — zero errors, all new components compiled
- `npm test` — all 311+ existing tests pass (zero regressions)
- Browser verification: navigate to `/devices/test-id/inspector` with mocked data, confirm:
  - Click a rect → ElementProperties panel appears with all R035 fields
  - Maestro commands section shows correct YAML for tapOn/assertVisible based on node's id/text/description
  - Copy button triggers "Copied!" feedback (clipboard write succeeds on localhost)
  - Search input → matching rects highlight with distinct color
  - Clear search → highlight removed, normal overlay restored
  - Deselect node (click close or click same rect again) → properties panel hides

## Observability / Diagnostics

- Inspection surfaces: DOM `document.querySelectorAll('[data-testid="maestro-command"]')` — count of generated Maestro commands; `document.querySelector('[data-testid="element-search"]')` — search input presence; `document.querySelectorAll('svg rect[data-highlighted="true"]')` — highlighted node count
- Failure visibility: clipboard copy wrapped in try/catch with visible "Copy failed" fallback message

## Integration Closure

- Upstream surfaces consumed: `web/src/routes/devices/[id]/inspector/+page.svelte` (inspector page with selectedNodeId state, onNodeClick callback, findNode function), `web/src/lib/components/inspector/ScreenshotOverlay.svelte` (SVG overlay with selectedNodeId prop, onNodeClick callback), `web/src/lib/utils/coordinate-mapping.ts` (flattenTree utility), `web/src/lib/api/types.ts` (HierarchyNode type)
- New wiring introduced: ElementProperties + MaestroSuggestions replace inline detail panel in inspector page; ElementSearch adds search state and highlightedNodeIds prop to ScreenshotOverlay
- What remains before the milestone is truly usable end-to-end: S03 (hooks management), S04 (device cards), S05 (debug artifacts)

## Tasks

- [x] **T01: Build ElementProperties panel with Maestro command suggestions and clipboard copy** `est:45m`
  - Why: Delivers R035 (properties panel) and R037 (Maestro YAML suggestions) — the core value of the inspector's element interaction. Extracts the inline detail panel from the inspector page into a reusable component and adds command generation logic.
  - Files: `web/src/lib/components/inspector/ElementProperties.svelte`, `web/src/lib/components/inspector/MaestroSuggestions.svelte`, `web/src/routes/devices/[id]/inspector/+page.svelte`
  - Do: Create `ElementProperties.svelte` receiving a `HierarchyNode` prop — render all R035 fields (type, id, text, description, bounds, enabled, visible, focused, clickable) with close button. Create `MaestroSuggestions.svelte` receiving a `HierarchyNode` prop — generate tapOn/assertVisible/assertNotVisible YAML commands using best selector (id first, then text, then description). Each command in a `<pre>` block with copy button using `navigator.clipboard.writeText()` wrapped in try/catch, transient "Copied!" state via `$state`. Replace the inline `{#if selectedNodeId}` detail panel in the inspector page with `<ElementProperties>`. Embed `<MaestroSuggestions>` inside ElementProperties. All Tailwind classes static (D016). Svelte 5 runes only.
  - Verify: `npm run web:build` zero errors. `npm test` all tests pass. Browser: click overlay rect → properties panel shows all fields + Maestro commands appear.
  - Done when: ElementProperties renders all R035 fields for any selected node, MaestroSuggestions generates correct YAML for nodes with id/text/description, copy button works on localhost.

- [x] **T02: Build element search with overlay highlighting** `est:45m`
  - Why: Delivers R036 (search/filter with overlay highlighting). Adds client-side search across the loaded hierarchy tree and visually highlights matching elements on the SVG overlay with a distinct color.
  - Files: `web/src/lib/components/inspector/ElementSearch.svelte`, `web/src/lib/components/inspector/ScreenshotOverlay.svelte`, `web/src/routes/devices/[id]/inspector/+page.svelte`
  - Do: Create `ElementSearch.svelte` — text input with 200ms debounce (setTimeout/clearTimeout), filters `flattenTree(nodes)` by case-insensitive substring match on `id`, `text`, `type`, and `description`. Emits matched node indices (Set<number>) since node.id is not unique. Add `highlightedNodeIds` prop (Set<number> of flattened-array indices) to ScreenshotOverlay — highlighted rects get a distinct static color class (e.g., bright cyan stroke + 30% fill) different from the 8-color cycling array and the selection highlight. Wire search into the inspector page: add ElementSearch above the overlay, derive highlightedNodeIds from search term + flattenTree, pass to ScreenshotOverlay. Static color classes only (D016). Svelte 5 runes only.
  - Verify: `npm run web:build` zero errors. `npm test` all tests pass. Browser: type in search → matching rects highlight in distinct color → clear search → highlights removed.
  - Done when: Search input filters hierarchy tree client-side, matching elements highlight on SVG overlay with visually distinct color, clearing search restores normal overlay.

## Files Likely Touched

- `web/src/lib/components/inspector/ElementProperties.svelte` (new)
- `web/src/lib/components/inspector/MaestroSuggestions.svelte` (new)
- `web/src/lib/components/inspector/ElementSearch.svelte` (new)
- `web/src/lib/components/inspector/ScreenshotOverlay.svelte` (modified — add highlightedNodeIds prop)
- `web/src/routes/devices/[id]/inspector/+page.svelte` (modified — replace inline panel, add search)
