---
id: T01
parent: S02
milestone: M003
provides:
  - ElementProperties panel component with full HierarchyNode attribute display
  - MaestroSuggestions component generating tapOn/assertVisible/assertNotVisible YAML commands
  - Clipboard copy with "Copied!" / "Copy failed" visual feedback
key_files:
  - web/src/lib/components/inspector/MaestroSuggestions.svelte
  - web/src/lib/components/inspector/ElementProperties.svelte
  - web/src/routes/devices/[id]/inspector/+page.svelte
key_decisions:
  - Moved findNode from {@const} template expression to script block function for reuse with $derived
  - Used $derived for both selectedNode and Maestro command groups instead of {@const} (Svelte 5 constraint — {@const} only valid inside control flow blocks)
  - State flags rendered as styled pills with Material Symbols icons for visual distinction
patterns_established:
  - Clipboard copy pattern: navigator.clipboard.writeText() in try/catch with $state index tracking for per-button "Copied!" / "Copy failed" feedback with 2-second timeout
  - data-testid="maestro-command" on each command block for DOM observability
  - data-testid="element-properties" on the panel container for component presence detection
observability_surfaces:
  - DOM: document.querySelector('[data-testid="element-properties"]') — panel presence
  - DOM: document.querySelectorAll('[data-testid="maestro-command"]') — command block count
  - Visual: "Copied!" / "Copy failed" button text feedback after clipboard operations
duration: 20m
verification_result: passed
completed_at: 2026-03-19
blocker_discovered: false
---

# T01: Build ElementProperties panel with Maestro command suggestions and clipboard copy

**Extract inline element detail panel into ElementProperties component with MaestroSuggestions child generating copyable tapOn/assertVisible/assertNotVisible YAML commands grouped by selector type (id → text → description)**

## What Happened

Created two new Svelte 5 components and refactored the inspector page:

1. **MaestroSuggestions.svelte** — Accepts a `HierarchyNode` prop. Generates Maestro YAML commands grouped by selector type in preference order: id → text → description. For each available selector, generates tapOn, assertVisible, and assertNotVisible commands. Each command rendered in a `<pre><code>` block with a Copy button that uses `navigator.clipboard.writeText()` in try/catch. Feedback state tracked via `$state` indices — "Copied!" for 2 seconds on success, "Copy failed" on error. All command blocks tagged with `data-testid="maestro-command"`.

2. **ElementProperties.svelte** — Accepts `node: HierarchyNode` and `onClose: () => void` props. Renders a properties panel showing type (always), id/text/description/bounds (if set), and state flags (clickable, focused, enabled, visible/hidden) as styled pills with Material Symbols icons. Embeds `<MaestroSuggestions>` below a divider. Panel tagged with `data-testid="element-properties"`.

3. **Inspector page refactor** — Moved `findNode` from `{@const}` in the template to a regular function in the script block. Added `selectedNode = $derived(...)` to compute the selected node reactively. Replaced the 40-line inline `{#if selectedNodeId}` block with a 3-line `<ElementProperties>` usage.

Hit one build error during implementation: Svelte 5 doesn't allow `{@const}` at the template root — moved the `generateCommands()` result to a `$derived` in the script block.

## Verification

- **`npm run web:build`** — zero errors, all components compiled (only pre-existing a11y warning on ScreenshotOverlay)
- **`npm test`** — all 311 tests pass, zero regressions
- **Browser verification** with mocked hierarchy data:
  - Clicked SVG rect → ElementProperties panel appeared with all fields (type, id, text, description, bounds, state flags)
  - Maestro Commands section showed 3 groups (By ID, By Text, By Label) with 9 total commands
  - Copy button → clipboard contained exact YAML (`- tapOn:\n    id: "com.app:id/login_btn"`)
  - "Copied!" feedback confirmed via delayed DOM read
  - Close button (×) → panel hidden, headings reverted
  - Click same rect again → toggle off (panel hidden)
  - 14/14 browser assertions passed (selector_visible, text_visible for all fields)

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npm run web:build` | 0 | ✅ pass | 3.3s |
| 2 | `npm test` | 0 | ✅ pass | 8.9s |
| 3 | Browser: click rect → panel visible | — | ✅ pass | — |
| 4 | Browser: 14/14 assertions (properties + commands) | — | ✅ pass | — |
| 5 | Browser: close button hides panel | — | ✅ pass | — |
| 6 | Browser: toggle off by re-clicking rect | — | ✅ pass | — |
| 7 | Browser: clipboard contains correct YAML | — | ✅ pass | — |

## Diagnostics

- **Panel presence:** `document.querySelector('[data-testid="element-properties"]')` — non-null when a node with a non-null ID is selected
- **Command count:** `document.querySelectorAll('[data-testid="maestro-command"]').length` — shows how many commands were generated (3 per selector group: tapOn, assertVisible, assertNotVisible)
- **Clipboard feedback:** Each Copy button shows "Copied!" (with check icon in primary color) or "Copy failed" (with error icon in tertiary color) for 2 seconds
- **Command content:** `document.querySelectorAll('[data-testid="maestro-command"] code')` — read textContent of each to verify YAML correctness

## Deviations

- Used `$derived` instead of `{@const}` for the command groups in MaestroSuggestions — Svelte 5 restricts `{@const}` to inside control flow blocks, not the template root.
- Added `data-testid="element-properties"` to the panel container for observability (not in original plan but consistent with slice diagnostics requirements).
- Enhanced state flag display from plain text spans to styled pills with Material Symbols icons — matches the design quality standard from the frontend-design skill.

## Known Issues

- Nodes with `null` IDs cannot be selected via the existing `handleNodeClick` / `selectedNodeId` mechanism. This is a pre-existing limitation of the inspector's selection system, not introduced by this task. T02 or a future task may address this by using flattened-tree indices instead of node IDs.

## Files Created/Modified

- `web/src/lib/components/inspector/MaestroSuggestions.svelte` — new component generating Maestro YAML commands with clipboard copy
- `web/src/lib/components/inspector/ElementProperties.svelte` — new component showing all element properties + embedding MaestroSuggestions
- `web/src/routes/devices/[id]/inspector/+page.svelte` — replaced inline detail panel with ElementProperties component, moved findNode to script block, added selectedNode derived state
- `.gsd/milestones/M003/slices/S02/tasks/T01-PLAN.md` — added Observability Impact section (pre-flight fix)
