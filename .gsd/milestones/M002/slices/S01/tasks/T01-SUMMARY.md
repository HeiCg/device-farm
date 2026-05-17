---
id: T01
parent: S01
milestone: M002
provides:
  - 51 Kinetic Console dark palette color tokens as @theme CSS custom properties
  - font-headline (Space Grotesk), font-body (Inter), font-label (Space Grotesk) registered in @theme
  - border radius overrides (--radius, --radius-lg, --radius-xl) without breaking rounded-full
  - .glass-card utility class with backdrop blur and ghost border
  - Google Fonts CDN links for Space Grotesk + Inter in app.html
  - Dark body styles (bg #0e0e0e, text white, Inter font)
key_files:
  - web/src/app.css
  - web/src/app.html
key_decisions:
  - Combined all three Google Fonts (Space Grotesk, Inter, Material Symbols) into a single CDN request for fewer HTTP roundtrips
  - Used var() references in body styles instead of @apply for directness and CSS-spec compliance
  - Log viewer scrollbar now uses token vars instead of hardcoded hex for theme consistency
patterns_established:
  - Tailwind v4 @theme block with --color-* namespace for all design tokens
  - Font families via --font-* vars consumed by font-headline, font-body, font-label utilities
  - Radius overrides via --radius-* vars; --radius-full intentionally untouched
observability_surfaces:
  - "getComputedStyle(document.body).getPropertyValue('--color-primary') returns #c39bff when tokens load correctly"
  - "grep -c '--color-' web/src/app.css returns ≥51 to verify token count"
  - "npm run web:build fails with CSS parse error if @theme syntax is broken"
duration: 8m
verification_result: passed
completed_at: 2026-03-18
blocker_discovered: false
---

# T01: Replace token system and add fonts in app.css + app.html

**Replaced entire farm-* light-theme token system with 51 Kinetic Console dark palette tokens, loaded Space Grotesk + Inter fonts via CDN, added .glass-card utility, removed Jenkins-era CSS**

## What Happened

Replaced the full contents of `web/src/app.css`:
- Removed all 24 `farm-*` and `jenkins-*` token definitions from `@theme`
- Added all 51 Kinetic Console dark palette tokens as `--color-*` vars organized by role (surfaces, on-surface, primary, secondary, tertiary, error, outline)
- Registered three font family vars: `--font-headline` (Space Grotesk), `--font-body` (Inter), `--font-label` (Space Grotesk)
- Added border radius overrides (`--radius: 0.125rem`, `--radius-lg: 0.25rem`, `--radius-xl: 0.5rem`) without touching `--radius-full`
- Updated body element to use dark background (`--color-background`), white text (`--color-on-surface`), and Inter font via `var(--font-body)`
- Added `.glass-card` class with `rgba(25, 25, 25, 0.6)` background, `backdrop-filter: blur(12px)`, and ghost border
- Updated `.log-viewer` scrollbar to use `var(--color-surface-container)` and `var(--color-outline-variant)` instead of hardcoded hex
- Deleted `.jenkins-table`, `.status-ball`, `.sidebar-link` class definitions entirely

Updated `web/src/app.html`:
- Added `<link rel="preconnect">` for `fonts.googleapis.com` and `fonts.gstatic.com`
- Consolidated all three Google Font families (Space Grotesk 400–700, Inter 400–600, Material Symbols) into a single CDN `<link>` tag

## Verification

All 7 task-level verification checks pass. Build succeeds with zero errors. Slice-level `farm-*` check for shared components shows expected remaining references (T02 scope).

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `grep 'farm-' web/src/app.css` | 1 (no match) | ✅ pass | <1s |
| 2 | `grep -c '\-\-color-' web/src/app.css` | 0 (56 matches, ≥51) | ✅ pass | <1s |
| 3 | `grep 'glass-card' web/src/app.css` | 0 (found) | ✅ pass | <1s |
| 4 | `grep 'jenkins-table\|status-ball\|sidebar-link' web/src/app.css` | 1 (no match) | ✅ pass | <1s |
| 5 | `grep 'Space.Grotesk' web/src/app.html` | 0 (found) | ✅ pass | <1s |
| 6 | `grep 'Inter' web/src/app.html` | 0 (found) | ✅ pass | <1s |
| 7 | `grep 'radius-full' web/src/app.css` | 1 (no match) | ✅ pass | <1s |
| 8 | `npm run web:build` | 0 | ✅ pass | 10s |
| 9 | `grep -c '^\s*--color-' web/src/app.css` (exact token count) | 0 (51) | ✅ pass | <1s |
| 10 | `grep -rn 'farm-' web/src/app.css` (slice check) | 1 (zero) | ✅ pass | <1s |
| 11 | `grep -rn 'farm-' web/src/lib/components/shared/ ...` (slice check) | 0 (17 hits) | ⏳ T02 scope | <1s |

## Diagnostics

- **Token verification:** `grep -c '\-\-color-' web/src/app.css` → should return ≥51
- **Build health:** `npm run web:build` → should exit 0
- **Font loading (browser):** `document.fonts.check('16px "Space Grotesk"')` → returns `true` after page load
- **Token value (browser):** `getComputedStyle(document.body).getPropertyValue('--color-primary')` → returns `#c39bff`
- **Missing token symptoms:** Components using `bg-primary`, `text-secondary`, etc. render transparent → token name typo in `@theme`

## Deviations

- Combined all three Google Font families into a single `<link>` tag instead of separate tags — reduces HTTP requests, same result.
- Used `var(--font-body)` in body `font-family` instead of `@apply font-body` — more direct, avoids Tailwind compilation step for base body styles.
- The `--color-` grep returns 56 (not 51) because 5 lines reference color tokens inside `var()` calls in scrollbar styles; the actual token definitions count is exactly 51.

## Known Issues

None.

## Files Created/Modified

- `web/src/app.css` — Complete rewrite: 51 dark palette tokens, 3 font families, 3 radius overrides, .glass-card utility, dark body styles, updated scrollbar, Jenkins CSS removed
- `web/src/app.html` — Added Google Fonts CDN preconnect + combined font link for Space Grotesk + Inter
