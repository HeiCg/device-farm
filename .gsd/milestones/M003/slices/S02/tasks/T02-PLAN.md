---
estimated_steps: 6
estimated_files: 3
---

# T02: Build element search with overlay highlighting

**Slice:** S02 — Element Inspector & Maestro Suggestions
**Milestone:** M003

## Description

Build an `ElementSearch.svelte` component with debounced client-side tree filtering and add a `highlightedNodeIds` prop to `ScreenshotOverlay.svelte` so search matches render with a distinct highlight color. Wire both into the inspector page. This delivers R036 (search input with overlay highlighting).

The full hierarchy tree is already loaded in memory on the inspector page (`hierarchy.tree`), and `flattenTree()` from `coordinate-mapping.ts` flattens it into a `HierarchyNode[]` for iteration. Search filtering works client-side by matching the search term against each node's `id`, `text`, `type`, and `description` fields. Matched nodes are tracked by their index in the flattened array (since `node.id` — the resource-id — is not guaranteed unique across elements).

**Relevant skills:** `frontend-design` (for search input styling consistency).

## Steps

1. **Add `highlightedNodeIds` prop to `ScreenshotOverlay.svelte`.** Modify the component's `$props()` to accept an optional `highlightedNodeIds` prop typed as `Set<number>` (indices into the flattened `visibleNodes` array). In the `{#each visibleNodes}` loop, check if the current `index` is in the set. If highlighted:
   - Apply a distinct static highlight color: use a bright cyan/magenta stroke (e.g., `stroke-[#00e5ff]`) and semi-transparent fill (e.g., `fill-[#00e5ff4d]`) — visually different from both the 8-color cycling array AND the selection highlight.
   - Add these as new static constants: `HIGHLIGHT_STROKE = 'stroke-[#00e5ff]'` and `HIGHLIGHT_FILL = 'fill-[#00e5ff4d]'` (D016-compliant).
   - Set `stroke-width` to 3 for highlighted rects (same as selected, to stand out from normal rects at 2).
   - Set `opacity` to 1 for highlighted rects.
   - Add `data-highlighted="true"` attribute on highlighted rects for observability.
   - Selection highlight takes priority over search highlight (if a node is both selected and highlighted, show the selection style).

2. **Create `ElementSearch.svelte`** in `web/src/lib/components/inspector/`. Props: `nodes: HierarchyNode[]` (the root tree array from hierarchy), `onSearchResults: (matchedIndices: Set<number>) => void`. Internal state:
   - `searchTerm` as `$state('')`
   - Debounce with 200ms `setTimeout`/`clearTimeout` pattern in a `$effect` watching `searchTerm`
   - On each debounced change: call `flattenTree(nodes)`, filter to nodes where `node.id?.toLowerCase().includes(term)` OR `node.text?.toLowerCase().includes(term)` OR `node.type.toLowerCase().includes(term)` OR `node.description?.toLowerCase().includes(term)`. Collect matching indices into a `Set<number>`. Call `onSearchResults(matchedSet)`.
   - When search term is empty, call `onSearchResults(new Set())` to clear highlights.
   - Render: text input with search icon, clear button (appears when search term is non-empty), match count badge showing "N matches".
   - Add `data-testid="element-search"` on the input for observability.
   - Style to match inspector aesthetic: `bg-surface-container-low`, `border-outline-variant/20`, etc.
   - Use Svelte 5 runes only.

3. **Wire search into the inspector page.** In `web/src/routes/devices/[id]/inspector/+page.svelte`:
   - Import `ElementSearch`
   - Add state: `let highlightedNodeIds = $state<Set<number>>(new Set())`
   - Add handler: `function handleSearchResults(matched: Set<number>) { highlightedNodeIds = matched; }`
   - Place `<ElementSearch>` above the ScreenshotOverlay (inside the left column, before the error/loading/overlay block), passing `nodes={overlayNodes}` and `onSearchResults={handleSearchResults}`
   - Pass `highlightedNodeIds={highlightedNodeIds}` to `<ScreenshotOverlay>`
   - On source change (`handleSourceChange`), also clear search: `highlightedNodeIds = new Set()`

4. **Verify build.** Run `npm run web:build` — zero errors.

5. **Verify tests.** Run `npm test` — all existing tests pass.

6. **Browser verification.** Navigate to `/devices/test-id/inspector`. Type a search term → matching rects highlight in bright cyan. Clear search → highlights removed. Change hierarchy source → search highlights cleared. Combine search + selection: selected node keeps its selection style even when also matched by search.

## Must-Haves

- [ ] ElementSearch provides debounced (200ms) client-side filtering over id, text, type, description
- [ ] ScreenshotOverlay accepts `highlightedNodeIds` prop and renders matched rects with distinct highlight color
- [ ] Highlight color is visually distinct from both the 8-color cycling array and the selection highlight
- [ ] Selection highlight takes priority over search highlight for nodes that are both
- [ ] Search results cleared when search input is emptied or hierarchy source changes
- [ ] Match count displayed next to search input
- [ ] All color classes are full static strings (D016-compliant)
- [ ] Svelte 5 runes only — no legacy reactivity

## Verification

- `npm run web:build` — zero errors
- `npm test` — all existing tests pass (zero regressions)
- Browser: type search term → matching rects highlight in cyan → match count shows correct number
- Browser: clear search → all highlights removed
- Browser: select a node that's also highlighted → selection style shown (not search highlight)
- DOM: `document.querySelectorAll('svg rect[data-highlighted="true"]').length` matches the displayed match count

## Inputs

- `web/src/lib/components/inspector/ScreenshotOverlay.svelte` — existing component with `visibleNodes` derived from `flattenTree(nodes)`, 8-color rect cycling, `selectedNodeId` prop. T02 adds `highlightedNodeIds` prop.
- `web/src/routes/devices/[id]/inspector/+page.svelte` — inspector page modified by T01 (inline panel replaced with ElementProperties). T02 adds search state + wiring.
- `web/src/lib/utils/coordinate-mapping.ts` — `flattenTree()` returns `HierarchyNode[]` (flat array, depth-first order). Indices in this array are used as node identifiers for highlighting.
- `web/src/lib/api/types.ts` — `HierarchyNode` type (unchanged).
- **From T01:** The inspector page now imports `ElementProperties` and has `selectedNode` as a `$derived` value. The `findNode` function is in the `<script>` block. The inline detail panel is gone.

## Observability Impact

- **Search input presence:** `document.querySelector('[data-testid="element-search"]')` — non-null when hierarchy is loaded
- **Highlighted rect count:** `document.querySelectorAll('svg rect[data-highlighted="true"]').length` — matches the displayed "N matches" badge count
- **Match count badge:** The badge text inside `ElementSearch` shows the number of matched nodes, confirming the debounced filter ran
- **Highlight priority:** When a node is both selected and highlighted, inspect the rect's class list — it should contain the per-node selection fill (e.g., `fill-[#4fc3f71a]`), NOT the search highlight fill (`fill-[#00e5ff4d]`)
- **Failure visibility:** If `flattenTree()` returns zero nodes, the match count shows "0 matches" and no rects are highlighted. Empty search term clears all `data-highlighted` attributes.

## Expected Output

- `web/src/lib/components/inspector/ElementSearch.svelte` — new component with debounced search input, client-side tree filtering, match count display
- `web/src/lib/components/inspector/ScreenshotOverlay.svelte` — modified: new `highlightedNodeIds` prop, highlight color constants, conditional highlight styling in the rect rendering loop
- `web/src/routes/devices/[id]/inspector/+page.svelte` — modified: ElementSearch wired in, highlightedNodeIds state, search results handler, highlights cleared on source change
