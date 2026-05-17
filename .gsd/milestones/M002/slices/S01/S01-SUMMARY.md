---
id: S01
parent: M002
milestone: M002
provides:
  - 51 Kinetic Console dark palette color tokens as --color-* CSS custom properties in @theme block
  - font-headline (Space Grotesk), font-body (Inter), font-label (Space Grotesk) registered in @theme
  - .glass-card CSS utility class with backdrop blur and ghost border
  - Custom border radius scale (--radius 0.125rem, --radius-lg 0.25rem, --radius-xl 0.5rem)
  - Space Grotesk + Inter loaded via Google Fonts CDN in app.html
  - StatusBadge tinted pill badge component with status→token color mapping
  - AlertBanner dark tinted variant component
  - Filters dark-themed select dropdowns
  - Pagination dark-themed load-more button
  - FlakeyBadge dark-themed flaky indicator
  - statusStyle() returning Kinetic Console token classes for all status values
requires:
  - slice: none
    provides: first slice — no upstream dependencies
affects:
  - S02 (consumes all tokens, fonts, .glass-card for shell layout)
  - S03 (consumes .glass-card for dashboard cards, StatusBadge, AlertBanner)
  - S04 (consumes StatusBadge, FlakeyBadge, Filters, Pagination, statusStyle for jobs pages)
  - S05 (consumes StatusBadge, .glass-card for devices/settings/login pages)
key_files:
  - web/src/app.css
  - web/src/app.html
  - web/src/lib/components/shared/StatusBadge.svelte
  - web/src/lib/components/shared/AlertBanner.svelte
  - web/src/lib/components/shared/Filters.svelte
  - web/src/lib/components/shared/Pagination.svelte
  - web/src/lib/components/FlakeyBadge.svelte
  - web/src/lib/utils/format.ts
key_decisions:
  - Full static class strings in StatusBadge pillStyles map — Tailwind v4 JIT cannot detect dynamically-constructed class names like bg-${color}/10
  - Kept StatusBadge size prop accepted but unused to avoid breaking 5 consumer files — S03-S05 will clean callers
  - Combined all three Google Font families into a single CDN link tag for fewer HTTP roundtrips
  - Used var() references in body styles instead of @apply for directness and CSS-spec compliance
patterns_established:
  - Tailwind v4 @theme block with --color-* namespace for all design tokens (51 tokens organized by role)
  - Font families via --font-* vars consumed by font-headline, font-body, font-label utilities
  - Radius overrides via --radius-* vars; --radius-full intentionally untouched (stays 9999px)
  - Tinted pill badge pattern for status indicators: bg-{token}/10 text-{token} border-{token}/20 with text-[10px] font-bold uppercase tracking-tighter
  - AlertBanner dark tinted variant pattern: bg-{container}/10 border-l-4 border-{accent}/20 with font-headline labels
  - Ghost border pattern: outline-variant at ≤20% opacity for interactive element boundaries
observability_surfaces:
  - "getComputedStyle(document.body).getPropertyValue('--color-primary') returns #c39bff when tokens load correctly"
  - "document.fonts.check('16px \"Space Grotesk\"') returns true after page load"
  - "npm run web:build exits non-zero if any token reference or CSS syntax is broken"
  - "grep -c '--color-' web/src/app.css returns ≥51 to verify token count"
drill_down_paths:
  - .gsd/milestones/M002/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M002/slices/S01/tasks/T02-SUMMARY.md
duration: ~18min
verification_result: passed
completed_at: 2026-03-18
---

# S01: Design Foundation — Tokens, Fonts, Shared Components

**Replaced the entire farm-* light-theme token system with 51 Kinetic Console dark palette tokens, loaded Space Grotesk + Inter fonts, created .glass-card utility, and reskinned all 5 shared components + statusStyle() to the new design system**

## What Happened

Two tasks executed sequentially to build the design foundation that every subsequent slice depends on.

**T01 (Token System + Fonts)** rewrote `web/src/app.css` from scratch. All 24 `farm-*` and `jenkins-*` token definitions were removed from the `@theme` block and replaced with 51 Kinetic Console dark palette tokens organized by role: surface tiers (`background` #0e0e0e through `surface-bright` #2a2a2a), on-surface text variants, primary purple (#c39bff), secondary green (#00fd93), tertiary red (#ff7168), error, and outline variants. Three font families were registered (`font-headline`, `font-body`, `font-label`), three border radius overrides added (without touching `--radius-full`), and the `.glass-card` class created with `rgba(25,25,25,0.6)` background + `backdrop-filter: blur(12px)`. Jenkins-era CSS classes (`.jenkins-table`, `.status-ball`, `.sidebar-link`) were deleted. `app.html` received Google Fonts CDN preconnect headers and a consolidated link tag loading Space Grotesk, Inter, and Material Symbols in a single request.

**T02 (Shared Components + statusStyle)** migrated all 6 consumer files. StatusBadge was structurally rewritten from a `.status-ball` colored circle div to a tinted pill `<span>` using static class lookup maps (critical for Tailwind v4 JIT detection). The status→color mapping follows the reference: passed/online/idle → secondary green, failed/error/timeout → tertiary red, running → primary purple, queued/cancelled/booting → surface-variant neutral, offline/maintenance → outline-variant dim. AlertBanner switched from light `bg-red-50`/`bg-yellow-50`/`bg-blue-50` to dark tinted variants using tertiary-container and primary-container tokens. Filters and Pagination adopted surface-container backgrounds with outline-variant ghost borders and primary focus rings. FlakeyBadge switched to `tertiary/10` tinted style. `statusStyle()` in `format.ts` was updated to return new token class names for all 7 status values plus a default fallback.

## Verification

All 7 slice-level verification checks pass:

| # | Check | Result |
|---|-------|--------|
| 1 | `npm run web:build` exits 0 | ✅ 490 client + 220 SSR modules |
| 2 | `grep -rn 'farm-' web/src/app.css` → zero results | ✅ |
| 3 | `grep -rn 'farm-'` across all 6 shared files → zero results | ✅ |
| 4 | `grep -c '\-\-color-' web/src/app.css` → ≥51 | ✅ (56 — 51 definitions + 5 var() refs) |
| 5 | `grep 'Space Grotesk' web/src/app.html` → found | ✅ |
| 6 | `grep 'glass-card' web/src/app.css` → found | ✅ |
| 7 | `grep -c 'jenkins-table\|status-ball\|sidebar-link' web/src/app.css` → zero | ✅ |

## Requirements Advanced

- R012 — All 51 reference color tokens defined as `--color-*` vars in Tailwind v4 `@theme`. Background #0e0e0e, primary #c39bff, secondary #00fd93, tertiary #ff7168, surface-container tiers all present. Zero `farm-*` tokens remain in app.css or shared components.
- R013 — Space Grotesk + Inter loaded via Google Fonts CDN. `font-headline`, `font-body`, `font-label` registered in @theme. CDN link confirmed in app.html.
- R014 — `.glass-card` class defined with exact spec: `rgba(25,25,25,0.6)` bg + `backdrop-filter: blur(12px)` + ghost border. Runtime visual proof deferred to milestone UAT.
- R024 — Ghost border pattern established in shared components (outline-variant at ≤20% opacity). Full validation across all pages is S02-S05 scope.
- R025 — StatusBadge rewritten as tinted pill badge with status→token color mapping per spec. statusStyle() returns new token classes. Solid status balls eliminated.

## Requirements Validated

- none — slice proof level is contract (build verification). Runtime visual validation deferred to milestone-level UAT.

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

- Combined three Google Font families into a single `<link>` tag instead of separate tags — reduces HTTP requests, same result.
- Used `var(--font-body)` in body `font-family` instead of `@apply font-body` — more direct CSS, avoids Tailwind compilation step for base body styles.
- `grep -c '--color-' web/src/app.css` returns 56 instead of 51 because 5 lines reference tokens inside `var()` calls in scrollbar styles; actual token definitions count is exactly 51.

## Known Limitations

- ~160 `farm-*` usages remain in page-level components (layouts, route pages) — these are S02-S05 scope, not shared component scope.
- StatusBadge `size` prop is accepted but ignored — avoids breaking 5 consumer files that pass it. Callers should be cleaned up in S03-S05.
- Visual fidelity against reference PNGs is unverified — this slice proves contract (build + grep), not runtime appearance. Full visual UAT is milestone-level.
- Standard Tailwind color utilities (e.g. `text-red-500`, `bg-white`) still work — no `--color-*: initial` was added — but any component using them will look visually inconsistent with the dark theme until migrated.

## Follow-ups

- S02-S05: Migrate ~160 remaining `farm-*` token usages in page-level components
- S03-S05: Clean up StatusBadge `size` prop from consumer call sites (5 files)
- Milestone UAT: Visual comparison of rendered pages against reference PNGs

## Files Created/Modified

- `web/src/app.css` — Complete rewrite: 51 dark palette tokens, 3 font families, 3 radius overrides, .glass-card utility, dark body styles, updated scrollbar, Jenkins CSS removed
- `web/src/app.html` — Added Google Fonts CDN preconnect + combined font link for Space Grotesk + Inter
- `web/src/lib/components/shared/StatusBadge.svelte` — Rewritten from .status-ball circle to tinted pill badge with status→token color mapping
- `web/src/lib/components/shared/AlertBanner.svelte` — Dark tinted variant backgrounds with tertiary/primary/surface-container tokens
- `web/src/lib/components/shared/Filters.svelte` — surface-container bg, outline-variant border, on-surface text, primary focus ring
- `web/src/lib/components/shared/Pagination.svelte` — surface-container-high bg, outline-variant border, on-surface-variant text
- `web/src/lib/components/FlakeyBadge.svelte` — tertiary/10 bg + tertiary text + tertiary/20 border
- `web/src/lib/utils/format.ts` — statusStyle() returns Kinetic Console token classes for all statuses

## Forward Intelligence

### What the next slice should know
- All 51 tokens are live in `@theme` and immediately usable as Tailwind utilities (`bg-background`, `text-primary`, `border-outline-variant/20`, etc.). No import or config changes needed.
- `.glass-card` is a plain CSS class, not a Tailwind utility — apply it directly in HTML class attributes.
- The surface-container tier hierarchy for depth: `surface-container` (darkest cards) → `surface-container-high` → `surface-container-highest` → `surface-bright` (lightest). Use these to create tonal depth without borders.
- Font utilities: `font-headline` for Space Grotesk headings, `font-body` for Inter body text, `font-label` for Space Grotesk labels/metadata.

### What's fragile
- **Tailwind v4 JIT class detection** — any dynamically-constructed class name (`` `bg-${color}/10` ``) will silently produce no CSS. Always use full static strings in lookup maps. This is documented in `.gsd/KNOWLEDGE.md` but easy to forget.
- **`--radius-full` must not be overridden** — it's intentionally left at 9999px. Overriding it breaks `rounded-full` for avatars, status dots, and circular elements. The custom radii only override `--radius`, `--radius-lg`, `--radius-xl`.

### Authoritative diagnostics
- `npm run web:build` — single source of truth for whether token references are valid. Non-zero exit = broken token name or CSS syntax.
- `grep -c '^\s*--color-' web/src/app.css` — returns exactly 51 for the token definition count.
- `grep -rn 'farm-' web/src/` — shows remaining migration work. After S01, expect ~160 hits in page-level components (not in shared/ or app.css).

### What assumptions changed
- Token count is 51, not "~40" as estimated in the roadmap — the reference palette has more surface-container tiers and outline variants than initially scoped. No impact on downstream work.
- `grep -c '--color-'` returns 56 not 51 because var() references in scrollbar styles also match — use `grep -c '^\s*--color-'` for exact definition count.
