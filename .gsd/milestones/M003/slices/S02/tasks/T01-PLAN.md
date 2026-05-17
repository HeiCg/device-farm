---
estimated_steps: 6
estimated_files: 3
---

# T01: Build ElementProperties panel with Maestro command suggestions and clipboard copy

**Slice:** S02 — Element Inspector & Maestro Suggestions
**Milestone:** M003

## Description

Extract the inline selected-element detail panel from the inspector page into a standalone `ElementProperties.svelte` component and create a `MaestroSuggestions.svelte` child component that generates copyable Maestro YAML commands. This delivers R035 (properties panel showing all element attributes) and R037 (Maestro command suggestions with clipboard copy).

The inspector page (`+page.svelte`) already has a working inline `{#if selectedNodeId}` block (lines ~154-193) that renders type, id, text, description, bounds, and state flags. This task extracts that into a proper component, enhances it with `MaestroSuggestions`, and replaces the inline block.

**Relevant skills:** `frontend-design` (for component styling consistency with existing inspector UI).

## Steps

1. **Create `MaestroSuggestions.svelte`** in `web/src/lib/components/inspector/`. Accepts a `HierarchyNode` prop. Generates Maestro YAML commands based on the node's available selectors:
   - If `node.id` is set: generate `tapOn: { id: "..." }`, `assertVisible: { id: "..." }`, `assertNotVisible: { id: "..." }`
   - If `node.text` is set: generate `tapOn: "..."`, `assertVisible: { text: "..." }`, `assertNotVisible: { text: "..." }`
   - If `node.description` is set: generate `tapOn: { label: "..." }`, `assertVisible: { label: "..." }`, `assertNotVisible: { label: "..." }`
   - Preference order: id first, then text, then description. Generate commands for ALL available selectors, grouped by selector type.
   - Each command rendered in a `<pre><code>` block with a copy button.
   - Copy uses `navigator.clipboard.writeText(commandText)` wrapped in try/catch. On success, button text changes to "Copied!" for 2 seconds via `$state` boolean. On failure, shows "Copy failed" briefly.
   - Add `data-testid="maestro-command"` to each command block for observability.
   - Use Svelte 5 runes only (`$props`, `$state`).

2. **Create `ElementProperties.svelte`** in `web/src/lib/components/inspector/`. Accepts props: `node: HierarchyNode`, `onClose: () => void`. Renders:
   - Header with "Selected Element" label and close button (calls `onClose`)
   - Properties section: type (always shown), id (if set), text (if set), description (if set), bounds (if set, formatted as `[left, top, right, bottom]`), state flags (clickable, focused, enabled, visible/hidden)
   - `<MaestroSuggestions {node} />` embedded below the properties
   - Styled to match existing inspector panel aesthetic (bg-surface-container-low, border-primary/20, text-xs, font-mono for technical values)
   - Use Svelte 5 runes only (`$props`).

3. **Replace inline detail panel in inspector page.** In `web/src/routes/devices/[id]/inspector/+page.svelte`:
   - Add imports for `ElementProperties` and remove the inline `{#if selectedNodeId}` block (the `{@const findNode = ...}` through its closing `{/if}`)
   - Move the `findNode` function from the template `{@const}` into the `<script>` block as a regular function
   - Add a `$derived` for the selected node: `let selectedNode = $derived(selectedNodeId && hierarchy ? findNode(hierarchy.tree, selectedNodeId) : null)`
   - Replace the removed block with: `{#if selectedNode}<ElementProperties node={selectedNode} onClose={() => (selectedNodeId = null)} />{/if}`

4. **Verify build.** Run `npm run web:build` from the project root — must produce zero errors.

5. **Verify tests.** Run `npm test` — all 311+ existing tests must pass.

6. **Browser verification.** Navigate to `/devices/test-id/inspector`. Click an SVG rect → ElementProperties panel appears with all fields. Maestro commands section shows YAML commands. Copy button copies to clipboard. Click close → panel disappears. Click same rect again → panel toggles off.

## Must-Haves

- [ ] ElementProperties displays: type, id, text, description, bounds, enabled, visible, focused, clickable
- [ ] MaestroSuggestions generates tapOn, assertVisible, assertNotVisible commands
- [ ] Command selector preference: id → text → description (generate for all available, id first)
- [ ] Each command has a copy button with "Copied!" / "Copy failed" feedback
- [ ] Clipboard copy uses `navigator.clipboard.writeText()` in try/catch
- [ ] Inline detail panel in inspector page replaced with `<ElementProperties>` component
- [ ] All Tailwind classes are full static strings (D016-compliant)
- [ ] Svelte 5 runes only ($props, $state, $derived) — no legacy let/$: reactivity

## Verification

- `npm run web:build` — zero errors
- `npm test` — all existing tests pass (zero regressions)
- Browser: click overlay rect → ElementProperties shows all node attributes + Maestro commands
- Browser: copy button writes correct YAML to clipboard (test via Ctrl+V in text editor)
- Browser: close button hides panel; clicking same rect toggles panel off

## Inputs

- `web/src/routes/devices/[id]/inspector/+page.svelte` — existing inspector page with inline detail panel (lines 154-193), `selectedNodeId` state, `handleNodeClick` callback, and `findNode` function defined as `{@const}` in the template
- `web/src/lib/api/types.ts` — `HierarchyNode` type with fields: `type`, `id`, `text`, `description`, `bounds`, `enabled`, `visible`, `focused`, `clickable`, `children`
- `web/src/lib/components/inspector/ScreenshotOverlay.svelte` — already wired with `selectedNodeId` and `onNodeClick` props (no changes needed in this task)

## Observability Impact

- **New DOM signals:** `document.querySelectorAll('[data-testid="maestro-command"]')` returns all rendered Maestro command blocks — count indicates which selectors the selected node has (id, text, description). Zero count means no selectors available.
- **Clipboard feedback:** Each copy button shows visible "Copied!" / "Copy failed" text for 2 seconds after click — observable without dev tools.
- **Component presence:** `document.querySelector('[data-testid="element-properties"]')` detects whether the properties panel is mounted (non-null = a node is selected).
- **Failure visibility:** Clipboard errors are caught in try/catch and surfaced as "Copy failed" button text — no silent failures.
- **Inspection by future agents:** To verify this task's output, click any SVG rect on the inspector overlay, then check that `[data-testid="element-properties"]` is visible and `[data-testid="maestro-command"]` elements exist with correct YAML content.

## Expected Output

- `web/src/lib/components/inspector/MaestroSuggestions.svelte` — new component generating Maestro YAML commands from HierarchyNode with clipboard copy
- `web/src/lib/components/inspector/ElementProperties.svelte` — new component showing all element properties + embedding MaestroSuggestions
- `web/src/routes/devices/[id]/inspector/+page.svelte` — modified: inline detail panel replaced with ElementProperties component, findNode moved to script block, selectedNode derived state added
