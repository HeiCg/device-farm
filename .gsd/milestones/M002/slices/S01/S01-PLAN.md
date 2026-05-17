# S01: Design Foundation — Tokens, Fonts, Shared Components

**Goal:** Replace the M001 light-theme `farm-*` token system with the Kinetic Console dark palette (~51 tokens), load Space Grotesk + Inter fonts, create the `.glass-card` utility, and reskin all shared components to use the new design system.
**Demo:** Open any page and see obsidian `#0e0e0e` background, purple `#c39bff` accents, Space Grotesk headlines, glass card surfaces. StatusBadge shows tinted pill badges (not solid circles). AlertBanner, Filters, Pagination, FlakeyBadge all render with dark tokens. `npm run web:build` succeeds.

## Must-Haves

- All ~51 reference color tokens defined as `--color-*` vars in Tailwind v4 `@theme` block
- `font-headline` (Space Grotesk), `font-body` (Inter), `font-label` (Space Grotesk) registered in `@theme`
- Space Grotesk + Inter loaded via Google Fonts CDN in `app.html`
- `.glass-card` CSS class: `rgba(25, 25, 25, 0.6)` background + `backdrop-filter: blur(12px)`
- Custom border radius overrides: `--radius: 0.125rem`, `--radius-lg: 0.25rem`, `--radius-xl: 0.5rem` (NOT `--radius-full`)
- Zero `farm-*` tokens in `app.css`, shared components, `FlakeyBadge.svelte`, or `format.ts`
- Jenkins-era CSS removed (`.jenkins-table`, `.status-ball`, `.sidebar-link`)
- StatusBadge rewritten from solid circle to tinted pill badge with status→color mapping per R025
- Standard Tailwind utilities (`text-gray-*`, `bg-white`, etc.) still work — do NOT clear `--color-*: initial`
- `npm run web:build` passes with zero errors

## Proof Level

- This slice proves: contract
- Real runtime required: no (build verification sufficient — visual UAT deferred to milestone-level)
- Human/UAT required: no

## Verification

- `npm run web:build` — zero errors
- `grep -rn 'farm-' web/src/app.css` — zero results (all old tokens removed)
- `grep -rn 'farm-' web/src/lib/components/shared/ web/src/lib/components/FlakeyBadge.svelte web/src/lib/utils/format.ts` — zero results
- `grep -c '\-\-color-' web/src/app.css` — ≥51 token definitions
- `grep 'Space Grotesk' web/src/app.html` — confirms font CDN link present
- `grep 'glass-card' web/src/app.css` — confirms utility class exists
- `grep -c 'jenkins-table\|status-ball\|sidebar-link' web/src/app.css` — zero results

## Integration Closure

- Upstream surfaces consumed: none (first slice)
- New wiring introduced: `@theme` token block consumed by all Tailwind utilities project-wide; `.glass-card` class consumed by S02–S05; StatusBadge API preserved (consumers still pass `status` + optional `size`, `size` is accepted but ignored)
- What remains: ~160 `farm-*` usages in page-level components (S02–S05 scope), layout shell (S02), page-specific reskins (S03–S05)

## Tasks

- [x] **T01: Replace token system and add fonts in app.css + app.html** `est:45m`
  - Why: Foundation — every subsequent task and slice depends on these tokens, fonts, and utility classes being defined. Highest-risk piece is the v3→v4 `@theme` translation for ~51 color tokens.
  - Files: `web/src/app.css`, `web/src/app.html`
  - Do: (1) Clear all `farm-*` token definitions from `@theme`. (2) Add all 51 reference color tokens as `--color-*` vars. (3) Add `--font-headline`, `--font-body`, `--font-label` vars. (4) Add `--radius`, `--radius-lg`, `--radius-xl` overrides (NOT `--radius-full`). (5) Add `.glass-card` CSS class. (6) Update `body` styles for dark background. (7) Update `.log-viewer` scrollbar styles for dark theme. (8) Remove `.jenkins-table`, `.status-ball`, `.sidebar-link` CSS classes. (9) Add Space Grotesk + Inter Google Fonts CDN `<link>` tags to `app.html`. Constraints: Do NOT add `--color-*: initial` — standard Tailwind colors must remain available. Do NOT override `--radius-full` — it must stay `9999px` for circular elements.
  - Verify: `grep 'farm-' web/src/app.css` returns 0 results. `grep -c '\-\-color-' web/src/app.css` shows ≥51. `grep 'glass-card' web/src/app.css` finds the class. `grep 'Space Grotesk' web/src/app.html` finds font link.
  - Done when: `app.css` has complete `@theme` block with all 51 tokens + 3 fonts + 3 radii, `.glass-card` class defined, Jenkins CSS removed, `app.html` loads both Google Fonts, and no `farm-*` tokens remain in either file.

- [x] **T02: Reskin shared components and update statusStyle utility** `est:45m`
  - Why: Completes S01 by migrating all shared components from `farm-*` tokens to the new design system. These components are consumed by S02–S05, so their contract (props, behavior) must be stable.
  - Files: `web/src/lib/components/shared/StatusBadge.svelte`, `web/src/lib/components/shared/AlertBanner.svelte`, `web/src/lib/components/shared/Filters.svelte`, `web/src/lib/components/shared/Pagination.svelte`, `web/src/lib/components/FlakeyBadge.svelte`, `web/src/lib/utils/format.ts`
  - Do: (1) Rewrite StatusBadge from `.status-ball` circle to tinted pill badge — pattern: `bg-{color}/10 text-{color} border border-{color}/20 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-tighter`. Map: passed/online/idle→secondary, failed/error/timeout→tertiary, running→primary, queued/cancelled/booting→surface-variant+on-surface-variant, offline/maintenance→outline-variant. Keep `size` prop in interface but ignore it (avoids breaking 5 consumer files). (2) Update AlertBanner to dark tinted variants: critical→`bg-tertiary-container/10 border border-tertiary/20`, warning/info similar patterns. (3) Update Filters: `surface-container` bg, `outline-variant/20` border, `on-surface` text. (4) Update Pagination: `surface-container-high` bg, `outline-variant` border, `on-surface-variant` text. (5) Update FlakeyBadge: `bg-tertiary/10 text-tertiary border border-tertiary/20`. (6) Update `statusStyle()` in format.ts: passed→`text-secondary`/`bg-secondary`, failed→`text-tertiary`/`bg-tertiary`, running→`text-primary`/`bg-primary`, queued/cancelled→`text-on-surface-variant`/`bg-surface-variant`. (7) Run `npm run web:build` and fix any errors.
  - Verify: `npm run web:build` passes. `grep -rn 'farm-' web/src/lib/components/shared/ web/src/lib/components/FlakeyBadge.svelte web/src/lib/utils/format.ts` returns zero results.
  - Done when: All 5 shared components + FlakeyBadge use new tokens exclusively, StatusBadge renders as pill badge, `statusStyle()` returns new token classes, and web build succeeds.

## Observability / Diagnostics

- **Token availability:** `getComputedStyle(document.body).getPropertyValue('--color-primary')` returns `#c39bff` in browser dev tools. If empty, the `@theme` block is not loading.
- **Font loading:** Browser Network tab → filter `fonts.googleapis.com` → confirm 200 responses for Space Grotesk and Inter. `document.fonts.check('16px "Space Grotesk"')` returns `true` after load.
- **Build failure visibility:** `npm run web:build` exits non-zero with Tailwind compilation errors if any token name is invalid or CSS syntax is broken. Build log shows the exact line.
- **Broken utility detection:** If a `--color-*` token shadows a Tailwind built-in (e.g., `--color-red-500: initial`), classes like `text-red-500` will render transparent. Inspect any element using a built-in color utility and verify it renders correctly.
- **Scrollbar theming:** `.log-viewer` scrollbar colors are only visible on WebKit browsers; verify in Chrome/Safari dev tools.
- **Redaction constraints:** No secrets in this slice. All values are design tokens (hex colors, font names, border radii).

## Files Likely Touched

- `web/src/app.css`
- `web/src/app.html`
- `web/src/lib/components/shared/StatusBadge.svelte`
- `web/src/lib/components/shared/AlertBanner.svelte`
- `web/src/lib/components/shared/Filters.svelte`
- `web/src/lib/components/shared/Pagination.svelte`
- `web/src/lib/components/FlakeyBadge.svelte`
- `web/src/lib/utils/format.ts`
