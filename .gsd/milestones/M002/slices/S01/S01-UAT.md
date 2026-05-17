# S01: Design Foundation — Tokens, Fonts, Shared Components — UAT

**Milestone:** M002
**Written:** 2026-03-18

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: S01 is a foundation slice that produces CSS tokens, font loading, utility classes, and component reskins. All deliverables can be verified via build checks, grep scans, and targeted browser dev-tools inspection. No server APIs or data wiring changed.

## Preconditions

- `npm run web:build` passes (confirms all token references resolve)
- A local dev server is running (`npm run web:dev` from project root) on port 5173
- Browser with DevTools available (Chrome or Safari preferred for scrollbar inspection)

## Smoke Test

Open http://localhost:5173 in a browser. The page background should be near-black (#0e0e0e), not white. If the background is white, the token system is broken — stop and investigate `web/src/app.css`.

## Test Cases

### 1. Color Token Availability

1. Open http://localhost:5173 in Chrome.
2. Open DevTools → Console.
3. Run: `getComputedStyle(document.body).getPropertyValue('--color-primary')`
4. **Expected:** Returns `#c39bff` (purple).
5. Run: `getComputedStyle(document.body).getPropertyValue('--color-secondary')`
6. **Expected:** Returns `#00fd93` (green).
7. Run: `getComputedStyle(document.body).getPropertyValue('--color-tertiary')`
8. **Expected:** Returns `#ff7168` (red).
9. Run: `getComputedStyle(document.body).getPropertyValue('--color-background')`
10. **Expected:** Returns `#0e0e0e` (near-black).

### 2. Font Loading

1. Open http://localhost:5173.
2. Open DevTools → Console.
3. Run: `document.fonts.check('16px "Space Grotesk"')`
4. **Expected:** Returns `true`.
5. Run: `document.fonts.check('16px "Inter"')`
6. **Expected:** Returns `true`.
7. Open DevTools → Network tab → filter by `fonts.googleapis.com`.
8. **Expected:** At least one 200 response loading both font families.

### 3. Glass Card Utility

1. Open http://localhost:5173 (dashboard page).
2. Open DevTools → Elements.
3. Search for an element with class `glass-card`.
4. Inspect its computed styles.
5. **Expected:** `background-color` is `rgba(25, 25, 25, 0.6)`, `backdrop-filter` includes `blur(12px)`, a border with `rgba(255,255,255,0.05)` (ghost border) is present.

### 4. StatusBadge Pill Rendering

1. Navigate to http://localhost:5173/jobs (or any page showing job statuses).
2. Locate a status indicator (e.g. "PASSED", "FAILED", "RUNNING").
3. **Expected:** Status is displayed as a pill-shaped badge (rounded rectangle, uppercase text, ~10px font) — NOT a solid colored circle.
4. Inspect the badge element in DevTools.
5. **Expected for PASSED:** Classes include `bg-secondary/10 text-secondary border-secondary/20`. Background is a faint green tint.
6. **Expected for FAILED:** Classes include `bg-tertiary/10 text-tertiary border-tertiary/20`. Background is a faint red tint.
7. **Expected for RUNNING:** Classes include `bg-primary/10 text-primary border-primary/20`. Background is a faint purple tint.

### 5. AlertBanner Dark Theme

1. Navigate to a page showing an alert/error banner (dashboard with system alerts, or trigger one by disconnecting a device).
2. **Expected:** Banner has a dark tinted background (not light red/yellow/blue). Critical alerts use a red-tinted dark background with a left accent border. Warning alerts use a purple-tinted dark background.
3. Inspect the banner element.
4. **Expected:** No `bg-red-50`, `bg-yellow-50`, or `bg-blue-50` classes. Uses `tertiary-container` or `primary-container` tokens instead.

### 6. Filters and Pagination Dark Theme

1. Navigate to http://localhost:5173/jobs.
2. Locate the filter dropdowns (status, platform).
3. **Expected:** Dropdowns have dark surface-container background, subtle outline-variant borders, white-ish on-surface text. Not white or light-gray backgrounds.
4. Scroll to the bottom / click "Load More" pagination button.
5. **Expected:** Button has dark `surface-container-high` background with subtle border. Not a blue or white button.

### 7. FlakeyBadge Appearance

1. Navigate to a job detail page for a job with flaky tests (if available).
2. Locate the flaky badge indicator.
3. **Expected:** Badge shows `tertiary`-colored text on a faint `tertiary/10` background with `tertiary/20` border. Not yellow/orange on white.

### 8. No farm-* Token Residue in Foundation Files

1. In terminal, run: `grep -rn 'farm-' web/src/app.css`
2. **Expected:** Zero results.
3. Run: `grep -rn 'farm-' web/src/lib/components/shared/ web/src/lib/components/FlakeyBadge.svelte web/src/lib/utils/format.ts`
4. **Expected:** Zero results.

### 9. No Jenkins-Era CSS

1. Run: `grep -c 'jenkins-table\|status-ball\|sidebar-link' web/src/app.css`
2. **Expected:** Returns `0`.

### 10. Body Styles

1. Open http://localhost:5173.
2. Inspect the `<body>` element in DevTools.
3. **Expected:** `background-color` is `#0e0e0e`, `color` is the on-surface white, `font-family` starts with `Inter` (or the font-body value).

## Edge Cases

### Standard Tailwind Colors Still Work

1. Open DevTools Console on any page.
2. Create a test element: `document.body.insertAdjacentHTML('beforeend', '<div id="tw-test" class="text-red-500 bg-white p-4">Test</div>')`
3. Inspect `#tw-test` computed styles.
4. **Expected:** `color` is red-500 (#ef4444), `background-color` is white (#ffffff). Standard Tailwind utilities were NOT broken by the custom token system.
5. Clean up: `document.getElementById('tw-test').remove()`

### Border Radius Scale

1. Open DevTools Console.
2. Run: `getComputedStyle(document.body).getPropertyValue('--radius')`
3. **Expected:** `0.125rem`.
4. Run: `getComputedStyle(document.body).getPropertyValue('--radius-lg')`
5. **Expected:** `0.25rem`.
6. Run: `getComputedStyle(document.body).getPropertyValue('--radius-xl')`
7. **Expected:** `0.5rem`.
8. Create test: `document.body.insertAdjacentHTML('beforeend', '<div id="radius-test" class="rounded-full w-8 h-8 bg-primary"></div>')`
9. Inspect `#radius-test` computed `border-radius`.
10. **Expected:** `9999px` — `rounded-full` was NOT affected by the radius overrides.
11. Clean up: `document.getElementById('radius-test').remove()`

### Log Viewer Scrollbar

1. Navigate to a job detail page with log output.
2. Scroll the log viewer.
3. In WebKit browsers (Chrome/Safari): **Expected** scrollbar thumb and track use dark colors matching the theme, not default gray or the old light-theme colors.

## Failure Signals

- **White/light background on any page** → `--color-background` token not loading; check `@theme` block in app.css
- **Transparent or invisible text** → Token name typo; `text-primary` class generates no CSS if `--color-primary` is missing from @theme
- **Solid colored circles instead of pill badges** → StatusBadge rewrite didn't take effect; check StatusBadge.svelte
- **Build failure** → CSS syntax error in @theme block or invalid token reference in a component
- **Missing fonts (system serif/sans)** → Google Fonts CDN link missing or malformed in app.html
- **"farm-" in grep results** → Incomplete migration; check the specific file

## Requirements Proved By This UAT

- R012 — Token system replacement proven by test cases 1, 8, 10 (all tokens present, no farm-* residue, dark body styles)
- R013 — Font loading proven by test case 2 (Space Grotesk + Inter load and render)
- R014 — Glass card proven by test case 3 (backdrop-filter, ghost border)
- R024 — No-line rule partially proven by test cases 4-7 (shared components use ghost borders, not solid 1px borders). Full proof requires S02-S05 page-level audit.
- R025 — Status indicator style proven by test case 4 (pill badges with tinted backgrounds, not solid circles)

## Not Proven By This UAT

- Visual pixel-fidelity against reference PNGs (deferred to milestone-level visual comparison)
- Full page-level dark theme (S02-S05 scope — ~160 farm-* usages remain in route components)
- Mobile responsive behavior of shared components (S02 scope)
- Runtime data wiring (unchanged by this slice — no API or WebSocket changes)
- Performance of backdrop-filter on lower-end hardware

## Notes for Tester

- The dashboard and other pages will look partially broken — the layout shell, sidebar, and page-level components still use `farm-*` tokens. This is expected. S01 only covers `app.css`, `app.html`, shared components, and `format.ts`.
- StatusBadge's `size` prop is intentionally ignored — if you see size="sm" or size="lg" being passed in consumer code, that's expected and will be cleaned up in S03-S05.
- The Rollup circular dependency warning during build ("Export tick of module...") is a known SvelteKit/Vite issue and does not affect runtime behavior.
