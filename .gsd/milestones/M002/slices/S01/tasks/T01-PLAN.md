---
estimated_steps: 9
estimated_files: 2
---

# T01: Replace token system and add fonts in app.css + app.html

**Slice:** S01 — Design Foundation — Tokens, Fonts, Shared Components
**Milestone:** M002

## Description

Replace the entire M001 `farm-*` light-theme token system in `app.css` with the Kinetic Console dark palette (~51 color tokens), register three font families, override border radii, add the `.glass-card` utility class, clean up Jenkins-era CSS, and add Google Fonts CDN links to `app.html`. This is the foundation — every subsequent task and slice depends on these tokens being live and correct.

The key risk is translating the reference's Tailwind v3 `tailwind.config` format into Tailwind v4's `@theme` CSS custom properties. The mapping is: `colors.primary: "#c39bff"` → `--color-primary: #c39bff;` inside `@theme { }`. Font families use `--font-*` vars, border radii use `--radius-*` vars.

**Relevant skill:** `frontend-design` — load if you need guidance on design token systems.

## Steps

1. **Read `web/src/app.css`** to understand the current `@theme` block structure and all existing classes.

2. **Replace the `@theme` block** — remove all `farm-*` token definitions. Add all 51 color tokens as `--color-*` vars:
   ```
   @theme {
     --color-background: #0e0e0e;
     --color-surface: #0e0e0e;
     --color-surface-dim: #0e0e0e;
     --color-surface-bright: #2c2c2c;
     --color-surface-variant: #262626;
     --color-surface-container-lowest: #000000;
     --color-surface-container-low: #131313;
     --color-surface-container: #191919;
     --color-surface-container-high: #1f1f1f;
     --color-surface-container-highest: #262626;
     --color-surface-tint: #c39bff;
     --color-on-surface: #ffffff;
     --color-on-surface-variant: #ababab;
     --color-on-background: #ffffff;
     --color-inverse-surface: #f9f9f9;
     --color-inverse-on-surface: #555555;
     --color-primary: #c39bff;
     --color-primary-dim: #914cf2;
     --color-primary-fixed: #b889ff;
     --color-primary-fixed-dim: #ad77ff;
     --color-primary-container: #b889ff;
     --color-on-primary: #410084;
     --color-on-primary-container: #310068;
     --color-on-primary-fixed: #000000;
     --color-on-primary-fixed-variant: #3e007e;
     --color-inverse-primary: #7a30db;
     --color-secondary: #00fd93;
     --color-secondary-dim: #00ed89;
     --color-secondary-fixed: #00fd93;
     --color-secondary-fixed-dim: #00ed89;
     --color-secondary-container: #006d3c;
     --color-on-secondary: #005b31;
     --color-on-secondary-fixed: #004624;
     --color-on-secondary-fixed-variant: #006638;
     --color-on-secondary-container: #e2ffe6;
     --color-tertiary: #ff7168;
     --color-tertiary-dim: #e2242a;
     --color-tertiary-fixed: #ff9289;
     --color-tertiary-fixed-dim: #ff7b71;
     --color-tertiary-container: #f53335;
     --color-on-tertiary: #4a0004;
     --color-on-tertiary-fixed: #3a0002;
     --color-on-tertiary-fixed-variant: #7a000b;
     --color-on-tertiary-container: #000000;
     --color-error: #ff6e84;
     --color-error-dim: #d73357;
     --color-error-container: #a70138;
     --color-on-error: #490013;
     --color-on-error-container: #ffb2b9;
     --color-outline: #757575;
     --color-outline-variant: #484848;
   }
   ```

3. **Add font family vars** inside the same `@theme` block:
   ```
   --font-headline: "Space Grotesk", sans-serif;
   --font-body: "Inter", sans-serif;
   --font-label: "Space Grotesk", sans-serif;
   ```

4. **Add border radius overrides** inside `@theme`:
   ```
   --radius: 0.125rem;
   --radius-lg: 0.25rem;
   --radius-xl: 0.5rem;
   ```
   **CRITICAL:** Do NOT add `--radius-full`. The default `9999px` value must remain for `rounded-full` (used on avatars, circular status dots).

5. **Update `body` styles** — set `@apply bg-background text-on-surface font-body;` (or equivalent) so the base page uses obsidian dark background with white text and Inter font.

6. **Add `.glass-card` utility class** outside `@theme`:
   ```css
   .glass-card {
     background: rgba(25, 25, 25, 0.6);
     backdrop-filter: blur(12px);
     -webkit-backdrop-filter: blur(12px);
     border: 1px solid rgba(255, 255, 255, 0.05);
     border-radius: 0.5rem;
   }
   ```

7. **Update `.log-viewer` scrollbar styles** — change track/thumb colors to dark theme tokens (`surface-container` / `outline-variant`).

8. **Remove Jenkins-era CSS classes** — delete `.jenkins-table`, `.status-ball`, `.sidebar-link` class definitions entirely from `app.css`.

9. **Update `web/src/app.html`** — add Google Fonts CDN `<link>` tags for Space Grotesk (weights 400–700) and Inter (weights 400–600) in `<head>`, alongside the existing Material Symbols link. Use `<link rel="preconnect">` for `fonts.googleapis.com` and `fonts.gstatic.com` for performance.

## Must-Haves

- [ ] All 51 color tokens present in `@theme` as `--color-*` vars with exact hex values from reference
- [ ] `--font-headline`, `--font-body`, `--font-label` defined with correct font families + sans-serif fallback
- [ ] `--radius`, `--radius-lg`, `--radius-xl` overridden; `--radius-full` NOT overridden
- [ ] `.glass-card` class defined with `backdrop-filter: blur(12px)` and ghost border
- [ ] Zero occurrences of `farm-*` in `app.css`
- [ ] Zero occurrences of `.jenkins-table`, `.status-ball`, `.sidebar-link` in `app.css`
- [ ] Standard Tailwind utilities (`text-gray-*`, `bg-white`, etc.) NOT broken — no `--color-*: initial`
- [ ] Space Grotesk + Inter fonts loaded via CDN in `app.html`
- [ ] Body has dark background and white text base styles

## Verification

- `grep 'farm-' web/src/app.css` → zero results
- `grep -c '\-\-color-' web/src/app.css` → ≥51
- `grep 'glass-card' web/src/app.css` → match found
- `grep 'jenkins-table\|status-ball\|sidebar-link' web/src/app.css` → zero results
- `grep 'Space Grotesk' web/src/app.html` → match found
- `grep 'Inter' web/src/app.html` → match found
- `grep 'radius-full' web/src/app.css` → zero results (must NOT be overridden)

## Observability Impact

- **What changes:** The entire CSS custom property namespace shifts from `--color-farm-*` to `--color-*`. Any component using `farm-*` tokens via `var(--color-farm-*)` or Tailwind `text-farm-*` / `bg-farm-*` classes will lose styling until migrated (expected — T02 handles components).
- **How to inspect:** Open browser dev tools → Elements → `<html>` computed styles → filter `--color-` → all 51 tokens should appear with correct hex values. `--font-headline`, `--font-body`, `--font-label` should show font families.
- **Failure states visible:** If the CDN font links are missing or malformed, `document.fonts.check('16px "Space Grotesk"')` returns `false` and text renders in system sans-serif fallback. If `@theme` block has syntax errors, `npm run web:build` fails with a Tailwind CSS parse error showing the line number.
- **Diagnostic command:** `grep -c '\-\-color-' web/src/app.css` should return ≥51. If lower, tokens are missing.

## Inputs

- `web/src/app.css` — current file with `@theme` block containing ~24 `farm-*` tokens, Jenkins-era CSS classes, scrollbar styles
- `web/src/app.html` — current file with Material Symbols CDN link only
- Reference color palette (all 51 tokens listed in step 2 above and in S01-RESEARCH.md)

## Expected Output

- `web/src/app.css` — complete `@theme` block with 51 color tokens + 3 font families + 3 radius overrides, `.glass-card` class, dark body styles, updated scrollbar, no `farm-*` tokens, no Jenkins CSS
- `web/src/app.html` — Google Fonts CDN links for Space Grotesk + Inter added alongside existing Material Symbols link
