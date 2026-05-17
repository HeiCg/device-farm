# S01: Design Foundation — Tokens, Fonts, Shared Components — Research

**Date:** 2026-03-18
**Depth:** Targeted

## Summary

S01 replaces the entire M001 light-theme token system (~24 `farm-*` tokens) with the reference Kinetic Console palette (~51 tokens), adds Google Fonts (Space Grotesk + Inter), creates a `.glass-card` CSS utility, and reskins 5 shared components plus the `statusStyle()` utility. The work is straightforward CSS/component reskinning — no new APIs, no architectural changes, no unfamiliar technology. The only genuine risk is translating the reference's Tailwind v3 `tailwind.config` color/font/radius definitions into Tailwind v4 `@theme` CSS custom properties correctly.

The reference HTML files and DESIGN.md provide exact token values, exact class patterns for every component variant, and exact CSS for the glass-card utility. There are 218 occurrences of `farm-*` tokens across `.svelte` and `.ts` files, but S01 only needs to replace them inside the 5 shared components + `format.ts` + `app.css`. The remaining `farm-*` usages in page-level components are handled by S02–S05.

## Recommendation

1. **Start with `app.css`** — this is the foundation everything depends on. Clear all `farm-*` tokens, define all ~51 reference color tokens as `--color-*` vars, add font families as `--font-*` vars, add custom `--radius-*` overrides, add `.glass-card` class, update body styles, update scrollbar styles, remove Jenkins-era CSS (`.jenkins-table`, `.status-ball`, `.sidebar-link`).
2. **Then update `app.html`** — add Space Grotesk + Inter Google Fonts CDN links.
3. **Then update shared components** one at a time — each is independent. StatusBadge is the most impactful (used in 5 files). The components only need token swaps and markup changes, not logic changes.
4. **Update `format.ts` `statusStyle()`** last — update returned class names from `farm-*` to new token classes.
5. **Verify** with `npm run web:build` — must pass with zero errors.

## Implementation Landscape

### Key Files

- `web/src/app.css` — The `@theme` block currently holds ~24 `farm-*` color tokens. Needs complete replacement with ~51 reference tokens as `--color-*` vars, plus `--font-headline`, `--font-body`, `--font-label` vars, plus `--radius-*` overrides. Also contains `.jenkins-table`, `.status-ball`, `.sidebar-link` CSS classes to remove, and `.log-viewer` scrollbar styles to update. The `.glass-card` class gets added here.
- `web/src/app.html` — Currently loads only Material Symbols via Google Fonts CDN. Needs `Space Grotesk` (weights 400–700) and `Inter` (weights 400–600) added as `<link>` tags.
- `web/src/lib/components/shared/StatusBadge.svelte` — Currently a solid circle (`.status-ball` div with `bg-farm-*` classes). Must become a tinted pill badge: `<span>` with pattern `bg-{color}/10 text-{color} border border-{color}/20 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-tighter`. Status→color mapping: passed/online/idle→`secondary`, failed/error/timeout→`tertiary`, running→`primary`, queued/cancelled/booting→`surface-variant`+`on-surface-variant`, offline/maintenance→`outline-variant`. The `size` prop is removed (pills don't use pixel sizing). The status label text should be rendered inside the badge.
- `web/src/lib/components/shared/AlertBanner.svelte` — Currently light backgrounds (`bg-red-50`, `bg-yellow-50`, `bg-blue-50`) with colored left borders. Must become dark tinted: `bg-tertiary-container/10 border border-tertiary/20` for critical, similar patterns for warning/info using reference tokens. Uses `font-headline` for label, `text-on-surface/80` for body text.
- `web/src/lib/components/shared/Filters.svelte` — Currently uses `farm-border`, `farm-subtle`, `farm-fg`, `farm-accent` tokens. Must become dark-themed selects using `surface-container` background, `outline-variant/20` borders, `on-surface` text, `primary` focus ring.
- `web/src/lib/components/shared/Pagination.svelte` — Currently uses `farm-border`, `farm-subtle`, `farm-fg`, `farm-accent`, `farm-neutral-subtle`. Must become dark-themed: `surface-container` or `surface-container-high` background, `outline-variant` border, `on-surface-variant` text, `primary` focus ring.
- `web/src/lib/components/FlakeyBadge.svelte` — Located at `web/src/lib/components/FlakeyBadge.svelte` (NOT in `shared/`). Currently uses `farm-warning-subtle`, `farm-warning`. Must become dark-themed: `bg-tertiary/10 text-tertiary border border-tertiary/20` (flaky = warning = error-adjacent in the new system, use tertiary).
- `web/src/lib/utils/format.ts` — The `statusStyle()` function returns `{ color, bg, label }` with `farm-*` class names. Must update to return new token class names: passed→`text-secondary`/`bg-secondary`, failed→`text-tertiary`/`bg-tertiary`, running→`text-primary`/`bg-primary`, queued/cancelled→`text-on-surface-variant`/`bg-surface-variant`. Note: `statusStyle()` is currently NOT imported by any .svelte file — only `formatRelativeTime` and `platformLabel` are used from `format.ts`. But it must be updated for S04 which will use it.
- `web/src/lib/components/shared/WeatherIcon.svelte` — Uses hardcoded Tailwind color classes (`text-yellow-500`, `text-slate-400`, `text-slate-300`) for sun/cloud/rain. Per open question in roadmap, the reference designs don't use weather metaphor. This component may not need changes in S01 if it's replaced in later slices — but its hardcoded colors should at minimum be updated to use new tokens if it stays.

### Token Translation: v3 Config → v4 `@theme`

The reference HTML uses Tailwind v3 CDN with `tailwind.config = { theme: { extend: { colors: {...} } } }`. Our project uses Tailwind v4 with `@theme` directive in CSS. The translation pattern:

| v3 config | v4 `@theme` | Generated utility |
|-----------|------------|-------------------|
| `colors.primary: "#c39bff"` | `--color-primary: #c39bff;` | `bg-primary`, `text-primary`, `border-primary` |
| `colors["surface-container"]: "#191919"` | `--color-surface-container: #191919;` | `bg-surface-container` |
| `colors["on-surface-variant"]: "#ababab"` | `--color-on-surface-variant: #ababab;` | `text-on-surface-variant` |
| `fontFamily.headline: ["Space Grotesk"]` | `--font-headline: "Space Grotesk", sans-serif;` | `font-headline` |
| `fontFamily.body: ["Inter"]` | `--font-body: "Inter", sans-serif;` | `font-body` |
| `fontFamily.label: ["Space Grotesk"]` | `--font-label: "Space Grotesk", sans-serif;` | `font-label` |
| `borderRadius.DEFAULT: "0.125rem"` | `--radius: 0.125rem;` | `rounded` |
| `borderRadius.lg: "0.25rem"` | `--radius-lg: 0.25rem;` | `rounded-lg` |
| `borderRadius.xl: "0.5rem"` | `--radius-xl: 0.5rem;` | `rounded-xl` |

**Important:** Do NOT clear `--color-*: initial`. The reference HTML uses standard Tailwind utilities like `text-gray-400`, `text-gray-500`, `bg-white`, `hover:text-gray-200` alongside the custom tokens. These must remain available.

**Important:** Do NOT override `--radius-full`. The reference uses `rounded-full` for circular elements (avatar images, status dots) which requires `border-radius: 9999px` (Tailwind's default). Only override `--radius`, `--radius-lg`, `--radius-xl`.

### Complete Color Token List (51 tokens from reference)

```
background: #0e0e0e, surface: #0e0e0e, surface-dim: #0e0e0e,
surface-bright: #2c2c2c, surface-variant: #262626,
surface-container-lowest: #000000, surface-container-low: #131313,
surface-container: #191919, surface-container-high: #1f1f1f,
surface-container-highest: #262626, surface-tint: #c39bff,
on-surface: #ffffff, on-surface-variant: #ababab, on-background: #ffffff,
inverse-surface: #f9f9f9, inverse-on-surface: #555555,
primary: #c39bff, primary-dim: #914cf2, primary-fixed: #b889ff,
primary-fixed-dim: #ad77ff, primary-container: #b889ff,
on-primary: #410084, on-primary-container: #310068,
on-primary-fixed: #000000, on-primary-fixed-variant: #3e007e,
inverse-primary: #7a30db,
secondary: #00fd93, secondary-dim: #00ed89, secondary-fixed: #00fd93,
secondary-fixed-dim: #00ed89, secondary-container: #006d3c,
on-secondary: #005b31, on-secondary-fixed: #004624,
on-secondary-fixed-variant: #006638, on-secondary-container: #e2ffe6,
tertiary: #ff7168, tertiary-dim: #e2242a, tertiary-fixed: #ff9289,
tertiary-fixed-dim: #ff7b71, tertiary-container: #f53335,
on-tertiary: #4a0004, on-tertiary-fixed: #3a0002,
on-tertiary-fixed-variant: #7a000b, on-tertiary-container: #000000,
error: #ff6e84, error-dim: #d73357, error-container: #a70138,
on-error: #490013, on-error-container: #ffb2b9,
outline: #757575, outline-variant: #484848
```

### Build Order

1. **`app.css`** — Foundation. Every other change depends on tokens being defined. Also add `.glass-card`, update body styles, update scrollbar, remove Jenkins CSS.
2. **`app.html`** — Add font CDN links. Independent of token work but fonts must load for visual verification.
3. **StatusBadge.svelte** — Highest impact shared component (used in 5 consumer files). Complete structural change from circle to pill.
4. **AlertBanner.svelte** — Used on dashboard. Token swap + dark variant styles.
5. **Filters.svelte** — Used on jobs page. Token swap only, same structure.
6. **Pagination.svelte** — Used on jobs page. Token swap only, same structure.
7. **FlakeyBadge.svelte** — Used on job detail. Token swap + minor style update.
8. **`format.ts` `statusStyle()`** — Update returned class names. No structural change.
9. **Build verification** — `npm run web:build` must pass.

### Verification Approach

1. `npm run web:build` — must succeed with zero errors (confirms no broken class references or import issues)
2. `grep -rn 'farm-' web/src/app.css` — must return zero results (all old tokens removed)
3. `grep -rn 'farm-' web/src/lib/components/shared/ web/src/lib/components/FlakeyBadge.svelte web/src/lib/utils/format.ts` — must return zero results (all shared components migrated)
4. `grep -c 'color-' web/src/app.css` — should show ~51 token definitions in `@theme`
5. `grep 'Space Grotesk' web/src/app.html` — confirms font loaded
6. `grep 'glass-card' web/src/app.css` — confirms utility class exists
7. `grep 'jenkins-table\|status-ball\|sidebar-link' web/src/app.css` — must return zero (Jenkins CSS removed)

## Constraints

- **Tailwind v4 `@theme` only** — no `tailwind.config.ts` or `tailwind.config.js`. All tokens go in `app.css`.
- **Do not clear `--color-*: initial`** — standard Tailwind colors (`gray-*`, `white`, `black`, `slate-*`) are used in the reference HTML and in existing components that S02–S05 will update.
- **Do not touch page-level components** — S01 scope is `app.css`, `app.html`, 5 shared components, `FlakeyBadge`, and `format.ts`. The ~160 remaining `farm-*` occurrences in route files and layout components are S02–S05 scope.
- **StatusBadge API change** — consumers pass `status` and `size` props. The new pill badge removes `size` (pills auto-size from text). Consumers that pass `size={18}` or `size={14}` or `size={22}` will get a TS warning if `size` is removed from the props type — but this is acceptable as S03–S05 will update those consumers. Alternatively, keep `size` in the interface but ignore it to avoid breaking callers.
- **Svelte 5 runes** — all components use `$props()`, `$derived()`, `$state()`. No legacy reactive syntax.

## Common Pitfalls

- **`rounded-full` override** — The reference config sets `full: 0.75rem` which would break circular avatar images and status dots. Do NOT override `--radius-full`. Only override `--radius`, `--radius-lg`, `--radius-xl`.
- **Opacity modifiers on custom colors** — Tailwind v4 supports `bg-primary/10` out of the box when colors are defined as hex in `@theme`. No special configuration needed. But if colors were defined as `rgb()` or `hsl()` without the alpha channel syntax, opacity modifiers wouldn't work. Hex values from the reference are fine.
- **Font fallbacks** — The reference config lists `["Space Grotesk"]` with no fallback. In `@theme`, define as `--font-headline: "Space Grotesk", sans-serif;` to avoid FOUT showing system serif.
- **StatusBadge breaking change** — If `size` prop is fully removed, 5 consumer files will have type errors. Safer to keep `size` as an optional ignored prop during S01, letting S03–S05 clean up callers.
