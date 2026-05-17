---
id: T02
parent: S02
milestone: M003
provides:
  - ElementSearch component with debounced client-side tree filtering and match count display
  - ScreenshotOverlay highlight prop rendering matched rects in bright cyan
  - Inspector page wiring connecting search results to overlay highlighting
key_files:
  - web/src/lib/components/inspector/ElementSearch.svelte
  - web/src/lib/components/inspector/ScreenshotOverlay.svelte
  - web/src/routes/devices/[id]/inspector/+page.svelte
key_decisions:
  - Track original flattenTree index alongside each visible node in ScreenshotOverlay to fix index mismatch between filtered visibleNodes and full flat-tree indices used by ElementSearch
patterns_established:
  - Debounce pattern in Svelte 5 $effect: setTimeout/clearTimeout with cleanup return function
  - flatIndex tracking in ScreenshotOverlay to bridge filtered-array iteration with full-tree index-based highlighting
observability_surfaces:
  - "DOM: document.querySelector('[data-testid=\"element-search\"]') — search input presence"
  - "DOM: document.querySelectorAll('svg rect[data-highlighted=\"true\"]').length — highlighted rect count matches badge"
  - "Badge text inside ElementSearch shows 'N match(es)' count"
duration: 15m
verification_result: passed
completed_at: 2026-03-19
blocker_discovered: false
---

# T02: Build element search with overlay highlighting

**Add debounced element search with bright cyan overlay highlighting and match count badge to the hierarchy inspector**

## What Happened

Created `ElementSearch.svelte` with a debounced (200ms) client-side search over flattened hierarchy nodes matching against `id`, `text`, `type`, and `description` fields. Added `highlightedNodeIds` prop to `ScreenshotOverlay.svelte` as `Set<number>` with D016-compliant static highlight constants (`HIGHLIGHT_STROKE = 'stroke-[#00e5ff]'`, `HIGHLIGHT_FILL = 'fill-[#00e5ff4d]'`). Selection highlight takes priority over search highlight — when a node is both selected and highlighted, it shows the selection style. Wired everything into the inspector page with state clearing on source change.

Key implementation detail: ScreenshotOverlay's `visibleNodes` filters out boundless nodes, so its loop indices don't match `flattenTree()` indices. Solved by mapping each visible node entry to `{ node, flatIndex }` so `highlightedNodeIds.has(flatIndex)` resolves correctly against the search filter's index space.

## Verification

- `npm run web:build` — zero errors (a11y warning about SVG rect click handler is pre-existing, not new)
- `npm test` — 33 test files, 311 tests passed, zero failures
- Browser: Typed "clock" → 1 match badge shown, clock rect highlighted in cyan
- Browser: Typed "search" → 1 match, search bar rect highlighted in cyan
- Browser: Typed "TextView" → 2 matches, both TextViews highlighted simultaneously
- Browser: Clear search → 0 highlighted rects confirmed via DOM query
- Browser: Selected a highlighted node → selection style applied (not cyan highlight), `data-highlighted` was null, 0 rects with `data-highlighted="true"`
- DOM assertions all passed: element-search input visible, match count visible, element-properties panel visible, maestro commands visible

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npm run web:build` | 0 | ✅ pass | 5.1s |
| 2 | `npm test` | 0 | ✅ pass | 9.5s |
| 3 | Browser: search "clock" → 1 highlighted rect | n/a | ✅ pass | — |
| 4 | Browser: search "TextView" → 2 highlighted rects | n/a | ✅ pass | — |
| 5 | Browser: clear search → 0 highlighted rects | n/a | ✅ pass | — |
| 6 | Browser: select highlighted node → selection priority | n/a | ✅ pass | — |
| 7 | browser_assert: 5/5 checks passed | n/a | ✅ pass | — |

## Diagnostics

- **Search input presence:** `document.querySelector('[data-testid="element-search"]')` — non-null when hierarchy loaded
- **Highlighted rect count:** `document.querySelectorAll('svg rect[data-highlighted="true"]').length` — should match the badge "N matches" count
- **Highlight priority:** When a node is both selected and highlighted, inspect the rect's class list — it should contain per-node selection fill (e.g., `fill-[#4fc3f71a]`), NOT highlight fill (`fill-[#00e5ff4d]`)
- **Clear behavior:** Empty search term or source change → all `data-highlighted` attributes removed

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `web/src/lib/components/inspector/ElementSearch.svelte` — new: debounced search input with match count badge and clear button
- `web/src/lib/components/inspector/ScreenshotOverlay.svelte` — modified: added `highlightedNodeIds` prop, `HIGHLIGHT_STROKE`/`HIGHLIGHT_FILL` constants, flatIndex tracking in visibleNodes, conditional highlight styling with selection priority
- `web/src/routes/devices/[id]/inspector/+page.svelte` — modified: imported ElementSearch, added highlightedNodeIds state and handleSearchResults handler, wired search to overlay, clear highlights on source change
- `.gsd/milestones/M003/slices/S02/tasks/T02-PLAN.md` — added Observability Impact section
