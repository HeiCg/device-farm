# S02: Element Inspector & Maestro Suggestions — UAT

**Milestone:** M003
**Written:** 2026-03-19

## UAT Type

- UAT mode: mixed (artifact-driven build verification + live-runtime browser inspection)
- Why this mode is sufficient: Build verification confirms components compile and existing tests pass. Browser verification with mocked hierarchy data confirms element selection, property display, Maestro command generation, clipboard copy, and search highlighting without requiring a live emulator.

## Preconditions

- `npm run web:build` passes with zero errors
- `npm test` passes all 311+ tests
- Web dev server running (`npm run web:dev` from project root) or production build served by Fastify
- Browser open to `http://localhost:5173` (dev) or `http://localhost:3000` (production)
- A device ID exists with hierarchy data available (or mocked hierarchy data is loaded)

## Smoke Test

Navigate to `/devices/<device-id>/inspector`. Confirm the page loads with a screenshot overlay. Click any colored rect on the screenshot — a properties panel should appear on the right side showing element attributes and Maestro commands.

## Test Cases

### 1. Element Selection and Properties Display

1. Navigate to `/devices/<device-id>/inspector`
2. Wait for hierarchy to load (element count should be non-zero in the subtitle)
3. Click a colored rect on the screenshot overlay
4. **Expected:** Properties panel appears with:
   - "Selected Element" header with × close button
   - Type field (always present, e.g., "android.widget.Button")
   - ID field (if node has one, e.g., "com.app:id/login_btn")
   - Text field (if node has one)
   - Description field (if node has one)
   - Bounds field showing `[x1, y1, x2, y2]` coordinates
   - State flag pills: clickable (touch_app icon), focused (center_focus_strong), enabled (check_circle), visible/hidden (visibility/visibility_off)

### 2. Element Deselection

1. With a properties panel open from Test 1
2. Click the × close button in the panel header
3. **Expected:** Properties panel disappears
4. Click the same rect on the overlay again
5. **Expected:** Properties panel reappears
6. Click the same rect a second time (toggle)
7. **Expected:** Properties panel disappears (toggle off behavior)

### 3. Maestro Command Generation — Node with ID

1. Click a rect for a node that has an `id` attribute
2. Scroll down in the properties panel to "Maestro Commands" section
3. **Expected:**
   - "By ID" group appears first with 3 commands: tapOn, assertVisible, assertNotVisible
   - tapOn command reads: `- tapOn:\n    id: "<node-id>"`
   - assertVisible command reads: `- assertVisible:\n    id: "<node-id>"`
   - assertNotVisible command reads: `- assertNotVisible:\n    id: "<node-id>"`
4. If node also has text, **Expected:** "By Text" group appears below "By ID" with 3 more commands
5. If node also has description, **Expected:** "By Label" group appears below with 3 more commands

### 4. Maestro Command Generation — Node with Only Text

1. Click a rect for a node that has `text` but no `id`
2. **Expected:**
   - No "By ID" group
   - "By Text" group appears with tapOn: `- tapOn: "<text>"`, assertVisible/assertNotVisible with `text:` key
   - If description exists, "By Label" group appears below

### 5. Clipboard Copy

1. Select a node with Maestro commands visible
2. Click the "Copy" button on the first tapOn command
3. **Expected:**
   - Button text changes to "✓ Copied!" in primary color
   - After ~2 seconds, button reverts to "Copy"
4. Paste into any text editor
5. **Expected:** Pasted text matches the YAML shown in the command block exactly

### 6. Search — Basic Match

1. With hierarchy loaded, locate the search input above the screenshot (placeholder: "Search elements…")
2. Type a known text value from an element (e.g., a button label visible on screenshot)
3. Wait ~200ms for debounce
4. **Expected:**
   - Match count badge appears (e.g., "1 match" or "3 matches")
   - Matching rects on the overlay change to bright cyan (`#00e5ff`) stroke and fill, visually distinct from the normal cycling colors
   - Non-matching rects remain in their original colors

### 7. Search — Multiple Matches

1. Type a value that matches multiple elements (e.g., a common widget type like "TextView")
2. **Expected:**
   - Badge shows correct count (e.g., "4 matches")
   - All matching rects are highlighted in cyan simultaneously
   - Other rects are unchanged

### 8. Search — Clear

1. With active search results highlighted
2. Click the × clear button in the search input
3. **Expected:**
   - Search input clears
   - Badge disappears
   - All cyan highlights removed — overlay returns to normal cycling colors
   - DOM: `document.querySelectorAll('svg rect[data-highlighted="true"]').length === 0`

### 9. Search + Selection Priority

1. Type a search term that highlights multiple elements
2. Click one of the highlighted (cyan) rects
3. **Expected:**
   - Clicked rect changes from cyan highlight to selection highlight (its cycling color fill, thicker stroke)
   - Other matching rects remain cyan
   - Properties panel opens for the selected node
4. Click the selected rect again to deselect
5. **Expected:** Rect returns to cyan highlight (search match), not to normal color

### 10. Source Change Clears Search and Selection

1. Select a node and enter a search term (both active)
2. Switch hierarchy source via the dropdown (e.g., maestro-cli → device-server)
3. **Expected:**
   - Search highlights cleared
   - Selected node cleared (properties panel hidden)
   - New hierarchy loads with fresh data

## Edge Cases

### Node with No Selectors

1. Find and click a node that has no id, no text, and no description (e.g., a layout container)
2. **Expected:**
   - Properties panel shows Type and Bounds but no ID/Text/Description fields
   - Maestro Commands section shows "No selectors available" message instead of command blocks

### Empty Search

1. Type a search term that matches nothing (e.g., "zzz_nonexistent_xyz")
2. **Expected:**
   - Badge shows "0 matches"
   - No rects highlighted on overlay
   - No errors in console

### Rapid Typing (Debounce)

1. Type quickly, entering and deleting characters rapidly
2. **Expected:**
   - No flickering or error states
   - Final search term is applied after 200ms of no typing
   - Match count reflects the final term only

## Failure Signals

- Properties panel doesn't appear after clicking a rect — check `document.querySelector('[data-testid="element-properties"]')` returns non-null
- No Maestro commands shown — check `document.querySelectorAll('[data-testid="maestro-command"]').length` (should be > 0 for nodes with at least one selector)
- Copy button shows "Copy failed" — clipboard API may be blocked (not on localhost/HTTPS)
- Search doesn't highlight anything — check `document.querySelectorAll('svg rect[data-highlighted="true"]').length` matches expected count
- Cyan highlights don't appear — check Tailwind generated CSS includes the `#00e5ff` color classes

## Requirements Proved By This UAT

- R035 — Tests 1, 2 prove click-to-select with full properties panel (type, id, text, description, bounds, state flags) and distinct selection highlight
- R036 — Tests 6, 7, 8, 9 prove search input filters hierarchy and highlights matching elements on overlay with distinct color
- R037 — Tests 3, 4, 5 prove Maestro YAML commands (tapOn, assertVisible, assertNotVisible) are generated with correct selectors and copyable to clipboard

## Not Proven By This UAT

- Server-side query endpoint (`/api/devices/:id/query`) — search is client-side only
- Selection of nodes without IDs — pre-existing S01 limitation, not addressed in S02
- Live emulator hierarchy data accuracy — this UAT works with mocked or real hierarchy data but doesn't validate the parser's correctness (that's S01's responsibility)

## Notes for Tester

- The a11y warning about SVG rect click handlers is pre-existing from S01 and does not affect functionality
- If testing without a live device, the inspector page will show an error state — inject mock hierarchy data via browser devtools or use a running emulator
- Clipboard copy requires localhost or HTTPS — it will fail on non-secure origins
- The debounce timer is 200ms — wait briefly after typing before checking highlights
