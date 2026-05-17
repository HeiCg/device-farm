# S01: Design tokens + base components

**Goal:** Establish the complete Jenkins-utilitarian design system foundation — tokens, shared components, and utility functions — so all downstream slices can build pages purely with `farm-*` tokens and Material Symbols.
**Demo:** Shared components (StatusBadge, Filters, Pagination, FlakeyBadge) render with status balls and Material Symbols instead of Lucide icons. New WeatherIcon and AlertBanner components exist. `grep -r 'gh-' web/src/lib/` returns zero hits. `grep -r 'gh-' web/src/app.css` returns zero hits.

## Must-Haves

- `app.css` `farm-*` tokens exactly match the reference HTML's color palette
- Zero `gh-*` class references in `web/src/lib/` and `web/src/app.css`
- StatusBadge renders colored circles (status balls) instead of Lucide SVGs
- WeatherIcon component renders Material Symbols (sunny/cloudy/rainy) based on health percentage
- AlertBanner component renders critical/warning/info banners with colored left borders
- Filters, Pagination, FlakeyBadge use `farm-*` tokens and Material Symbols
- `statusStyle()` in format.ts uses `farm-*` tokens
- `npm run web:build` passes (may have warnings from page-level `gh-*` refs in S04/S05 scope — that's expected)

## Verification

- `grep -r 'gh-' web/src/lib/` returns zero hits
- `grep -r 'gh-' web/src/app.css` returns zero hits
- `grep -r 'lucide-svelte' web/src/lib/components/shared/ web/src/lib/components/FlakeyBadge.svelte` returns zero hits
- `npm run web:build` passes

## Tasks

- [x] **T01: Align design tokens and migrate shared utilities** `est:25m`
  - Why: Foundation — every component reads tokens from `app.css` and uses `statusStyle()`. Must be correct before touching any components.
  - Files: `web/src/app.css`, `web/src/lib/utils/format.ts`
  - Do: (1) Audit `app.css` `@theme` block against reference HTML's tailwind config — ensure every reference color exists as a `farm-*` token. Add missing tokens (e.g. `farm-jenkins-link` if needed). Ensure the status colors match reference exactly: success=#1e40af, failure=#ef4444, unstable=#fbbf24, aborted=#94a3b8. (2) Replace all `gh-*` references in `format.ts` `statusStyle()` with `farm-*` equivalents. (3) Verify the `.jenkins-table`, `.status-ball`, `.sidebar-link` CSS classes in `app.css` match the reference HTML's styles.
  - Verify: `grep -c 'gh-' web/src/app.css web/src/lib/utils/format.ts` returns 0 for both files
  - Done when: Token palette matches reference, `statusStyle()` returns `farm-*` classes, no `gh-*` in either file

- [x] **T02: Convert shared components to Material Symbols + farm tokens** `est:30m`
  - Why: StatusBadge, Pagination, Filters, FlakeyBadge are used across all pages. Converting them here means downstream slices get the correct rendering for free.
  - Files: `web/src/lib/components/shared/StatusBadge.svelte`, `web/src/lib/components/shared/Pagination.svelte`, `web/src/lib/components/shared/Filters.svelte`, `web/src/lib/components/FlakeyBadge.svelte`
  - Do: (1) StatusBadge — replace Lucide icon imports with `<div class="status-ball">` pattern. Map: passed→bg-farm-success (blue), failed→bg-farm-danger (red), running→bg-farm-warning (animated pulse), queued→bg-farm-aborted (grey), cancelled→bg-farm-aborted, timeout→bg-farm-danger. (2) Pagination — replace Lucide Loader2 with `<span class="material-symbols-outlined animate-spin">progress_activity</span>`. Replace `gh-*` → `farm-*`. (3) Filters — replace `gh-*` → `farm-*` in select styling. (4) FlakeyBadge — replace Lucide AlertTriangle with Material Symbol `warning`. Replace `gh-*` → `farm-*`.
  - Verify: `grep -r 'lucide-svelte' web/src/lib/components/shared/ web/src/lib/components/FlakeyBadge.svelte` returns nothing. `grep -r 'gh-' web/src/lib/components/shared/ web/src/lib/components/FlakeyBadge.svelte` returns nothing.
  - Done when: All 4 components use Material Symbols + `farm-*` tokens, zero Lucide/gh imports

- [x] **T03: Build WeatherIcon and AlertBanner components** `est:25m`
  - Why: These are new components needed by S03 (dashboard) and S05 (devices) — building them now means downstream slices just import and use.
  - Files: `web/src/lib/components/shared/WeatherIcon.svelte` (new), `web/src/lib/components/shared/AlertBanner.svelte` (new)
  - Do: (1) WeatherIcon — accepts `healthPercent: number` prop. Renders Material Symbol: `sunny` (>80%, text-yellow-500), `cloudy` (50-80%, text-slate-400), `rainy` (<50%, text-slate-300). Matches reference sizing (text-sm). (2) AlertBanner — accepts `variant: 'critical' | 'warning' | 'info'` and `message: string` props. Optional `details` slot or prop for link. Renders reference pattern: colored left border (4px), tinted background, Material Symbol icon (error/warning/info), bold label prefix, message text. Critical: red-50 bg, red-500 border, red-800 text. Warning: yellow-50 bg, yellow-400 border, yellow-800 text. Info: blue-50 bg, blue-500 border, blue-800 text.
  - Verify: Both files exist with substantive implementation (>20 lines each). Exports are importable. No Lucide or `gh-*` references.
  - Done when: `WeatherIcon` renders 3 weather states, `AlertBanner` renders 3 variants, both use Material Symbols + `farm-*` tokens

## Files Likely Touched

- `web/src/app.css`
- `web/src/lib/utils/format.ts`
- `web/src/lib/components/shared/StatusBadge.svelte`
- `web/src/lib/components/shared/Pagination.svelte`
- `web/src/lib/components/shared/Filters.svelte`
- `web/src/lib/components/FlakeyBadge.svelte`
- `web/src/lib/components/shared/WeatherIcon.svelte` (new)
- `web/src/lib/components/shared/AlertBanner.svelte` (new)
