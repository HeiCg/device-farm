# S02: Element Inspector & Maestro Suggestions — Research

**Date:** 2026-03-19

## Summary

S02 extends the inspector page built in S01 with three capabilities: a properties panel for selected elements (R035), search/filter with overlay highlighting (R036), and copyable Maestro YAML command suggestions (R037). The heavy lifting is already done — S01 wired `selectedNodeId` state, `onNodeClick` callback, a `findNode()` recursive lookup, and a working selected-element detail panel that already shows type/id/text/description/bounds/state flags. The API client already exports `queryElements()` for server-side search. This slice is primarily UI component work on top of established patterns.

The main work is: (1) extract the inline selected-node panel to a standalone component and add Maestro command generation logic, (2) build a search input with client-side tree filtering + overlay highlight support, and (3) add clipboard copy with visual feedback. No server changes are needed — all APIs exist.

## Recommendation

Build three new components — `ElementProperties.svelte` (extracted/enhanced panel), `MaestroSuggestions.svelte` (command generation + copy), and `ElementSearch.svelte` (search input + filtering) — then wire them into the existing inspector page. Use **client-side tree filtering** for search rather than the server-side `queryElements()` endpoint, because the full hierarchy is already loaded in memory and client-side avoids extra network latency. Keep the server-side `queryElements()` call as an optional refinement (regex search that the client can't do). Use `navigator.clipboard.writeText()` for copy with a transient "Copied!" feedback state.

## Implementation Landscape

### Key Files

- `web/src/routes/devices/[id]/inspector/+page.svelte` — **Inspector page (modify).** Already has `selectedNodeId`, `handleNodeClick`, `findNode()` inline, and a selected-node detail panel (lines 154-193). The detail panel needs to be replaced with the new `ElementProperties` component. Search state and wiring added here.
- `web/src/lib/components/inspector/ScreenshotOverlay.svelte` — **Screenshot overlay (modify).** Already accepts `selectedNodeId` and `onNodeClick`. Needs a new `highlightedNodeIds` prop (string set/array) so search matches render with a distinct highlight color separate from the selected-node color.
- `web/src/lib/api/maestro.ts` — **API client (no changes needed).** Already exports `queryElements(deviceId, { text?, id? })` returning `QueryResult`. May be used for server-side regex search if client-side filtering is insufficient.
- `web/src/lib/api/types.ts` — **Types (no changes needed).** `HierarchyNode` already has all properties R035 requires: `type`, `id`, `text`, `description`, `bounds`, `enabled`, `visible`, `focused`, `clickable`.
- `web/src/lib/utils/coordinate-mapping.ts` — **Utilities (no changes needed).** `flattenTree()` returns `HierarchyNode[]` for client-side search filtering. Note: S01 summary claims it returns `{ node, depth }[]` — this is incorrect; it returns plain `HierarchyNode[]`. If tree-view indentation is needed, a new `flattenTreeWithDepth()` variant should be added here.
- `web/src/lib/components/inspector/ElementProperties.svelte` — **New.** Extracted from the inspector page's inline `{#if selectedNodeId}` block. Receives a `HierarchyNode` prop, renders all R035 properties, and embeds `MaestroSuggestions`.
- `web/src/lib/components/inspector/MaestroSuggestions.svelte` — **New.** Pure presentation: takes a `HierarchyNode`, generates Maestro YAML command strings (`tapOn`, `assertVisible`, `assertNotVisible`) based on available selectors (id → text → description), renders each as a copyable code block.
- `web/src/lib/components/inspector/ElementSearch.svelte` — **New.** Search input with debounced filtering. Emits matched node IDs for overlay highlighting and optionally a filtered node list.

### Maestro Command Generation Logic

Given a `HierarchyNode`, generate commands using the best available selector (preference order: id, text, description):

```yaml
# By ID (resource-id)
- tapOn:
    id: "com.app:id/login_button"
- assertVisible:
    id: "com.app:id/login_button"

# By text (visible text)
- tapOn: "Login"
- assertVisible:
    text: "Login"

# By description (content-desc / accessibility label)
- tapOn:
    id: ".*login.*"   # fallback: regex on description
- assertVisible:
    label: "Login button"
```

The generation is pure string formatting — no library needed. Each command is a YAML string rendered in a `<pre>` / `<code>` block with a copy button.

### Build Order

1. **ElementProperties + MaestroSuggestions components** — Build these first because they're self-contained, testable in isolation, and immediately useful once wired in. Extract the existing inline panel from the inspector page into `ElementProperties.svelte`. Add `MaestroSuggestions.svelte` as a child component with command generation logic and clipboard copy.

2. **ElementSearch + overlay highlighting** — Add search input component and the `highlightedNodeIds` prop to `ScreenshotOverlay`. This requires modifying both a new and existing component, so it comes second. Client-side filtering via `flattenTree()` + string matching is the primary approach.

3. **Inspector page integration** — Wire all three new components into the inspector page, replacing the inline detail panel and adding search to the layout. This is the final assembly step.

### Verification Approach

- **`npm run web:build`** — zero errors, confirms all new components compile and type-check
- **Full test suite** — `npm test` — all 311+ existing tests pass (no regressions)
- **Browser verification with mocked data** — navigate to `/devices/test-id/inspector`, verify:
  - Clicking an SVG rect populates the properties panel with all R035 fields
  - Maestro command suggestions appear for elements with id/text/description
  - Copy button writes to clipboard (verify via `navigator.clipboard.readText()` in console)
  - Search input filters visible nodes on the overlay (highlighted nodes change)
  - Clearing search restores full overlay
  - Deselecting a node (click again or close) hides the properties panel

## Constraints

- **D016: Static Tailwind classes** — all color/style classes must be full strings in Record lookups, not template-interpolated. The existing `RECT_COLORS`/`RECT_FILLS` arrays in ScreenshotOverlay establish this pattern. New highlight colors for search matches must follow the same approach.
- **D019: SVG overlay** — all interactive overlays use SVG, not Canvas. Search highlights are additional `<rect>` style changes, not a separate rendering layer.
- **D020: Read-only inspector** — no device interaction (tap/swipe/type). Maestro suggestions are for copy-paste into flow YAML files, not for live execution.
- **Svelte 5 runes only** — `$state`, `$derived`, `$props`, `$effect`. No legacy `let`/`$:` reactivity.
- **No new dependencies** — clipboard API is built into browsers, search filtering is pure JS, YAML formatting is string concatenation. No libraries needed.

## Common Pitfalls

- **`flattenTree()` returns `HierarchyNode[]`, not `{ node, depth }[]`** — S01's forward intelligence claims it returns depth info, but the actual implementation does not. If indented tree rendering is needed for search results, either add a `flattenTreeWithDepth()` variant or compute depth separately during rendering. For S02's search, depth is not needed — we only need matching node IDs for overlay highlighting.
- **Clipboard API requires secure context** — `navigator.clipboard.writeText()` only works on HTTPS or localhost. This is fine for dev (localhost:5173/3000) but worth noting. Wrap in try/catch and show fallback "Copy failed" message.
- **Search debouncing** — without debounce, typing in the search input triggers re-filtering on every keystroke. For trees with ~500 nodes this is fast enough, but add a 200ms debounce as defensive practice. Use a simple `setTimeout`/`clearTimeout` pattern — no library needed.
- **Node ID uniqueness** — `HierarchyNode.id` is the resource-id (e.g., `com.app:id/button`), which is not guaranteed unique across elements (multiple views can share a resource-id). For selection/highlighting, use a positional identifier or the node reference itself. The existing S01 code uses `node.id` for `selectedNodeId` which could theoretically select the wrong node if IDs collide. For S02's search highlighting, use the index in the flattened array or generate a synthetic unique key.

## Sources

- Maestro YAML command reference for `tapOn`, `assertVisible`, `assertNotVisible` selector formats (source: [Maestro docs](https://maestro.mobile.dev/api-reference/commands))
