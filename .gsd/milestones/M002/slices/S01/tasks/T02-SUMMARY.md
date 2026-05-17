---
id: T02
parent: S01
milestone: M002
provides:
  - 5 shared components + FlakeyBadge reskinned from farm-* to Kinetic Console tokens
  - StatusBadge API: tinted pill badge with status text, size prop kept optional (unused)
  - statusStyle() returns Kinetic Console token classes for all 7 status values + default
key_files:
  - web/src/lib/components/shared/StatusBadge.svelte
  - web/src/lib/components/shared/AlertBanner.svelte
  - web/src/lib/components/shared/Filters.svelte
  - web/src/lib/components/shared/Pagination.svelte
  - web/src/lib/components/FlakeyBadge.svelte
  - web/src/lib/utils/format.ts
key_decisions:
  - Used full static class strings in StatusBadge pillStyles map instead of template-string interpolation, because Tailwind v4 JIT cannot detect dynamically-constructed class names like bg-${color}/10
  - Kept StatusBadge size prop accepted but unused to avoid breaking 5 consumer files that pass it — S03-S05 will clean callers
patterns_established:
  - Tinted pill badge pattern for status indicators: bg-{token}/10 text-{token} border-{token}/20 with text-[10px] font-bold uppercase tracking-tighter
  - AlertBanner dark tinted variant pattern: bg-{container}/10 border-l-4 border-{accent}/20 with font-headline labels
observability_surfaces:
  - Build signal: npm run web:build exit code (non-zero if token references are broken)
  - Token residue check: grep -rn 'farm-' across all 6 files should return zero results
  - Visual: StatusBadge renders pill shape with uppercase text, not a solid circle
duration: ~10min
verification_result: passed
completed_at: 2026-03-18
blocker_discovered: false
---

# T02: Reskin shared components and update statusStyle utility

**Migrated all 5 shared components + FlakeyBadge + statusStyle() from farm-* tokens to Kinetic Console dark palette, replacing StatusBadge circle with tinted pill badge**

## What Happened

Rewrote 6 files to eliminate all `farm-*` token references and adopt the Kinetic Console design system tokens defined in T01.

**StatusBadge** — complete structural rewrite. Replaced the `.status-ball` circle div with a tinted pill `<span>` using the pattern `bg-{token}/10 text-{token} border-{token}/20 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-tighter`. Status→color mapping: passed/online/idle → secondary (green), failed/error/timeout → tertiary (red), running → primary (purple), queued/cancelled/booting → surface-variant neutral, offline/maintenance → outline-variant dim. The `size` prop is still accepted but not applied (backward-compatible for 5 consumer files).

**AlertBanner** — replaced light-theme `bg-red-50`/`bg-yellow-50`/`bg-blue-50` with dark tinted variants: critical uses `tertiary-container/10` + `tertiary/20` border, warning uses `primary-container/10` + `primary/20` border, info uses `surface-container-high` + `outline-variant/20` border. Added `font-headline` to label text. Replaced `text-farm-accent` link with `text-primary`.

**Filters** — swapped `farm-border`/`farm-subtle`/`farm-fg`/`farm-accent` with `outline-variant/20` border, `surface-container` background, `on-surface` text, `primary/30` focus ring.

**Pagination** — same pattern: `surface-container-high` bg, `outline-variant/30` border, `on-surface-variant` text, `surface-bright` hover, `primary/30` focus ring.

**FlakeyBadge** — replaced `farm-warning-subtle`/`farm-warning` with `tertiary/10` bg + `tertiary` text + `tertiary/20` border.

**format.ts** — updated `statusStyle()` to return new token class names: passed→text-secondary/bg-secondary, failed/error/timeout→text-tertiary/bg-tertiary, running→text-primary/bg-primary, queued/cancelled→text-on-surface-variant/bg-surface-variant. Added `error` case that was previously falling through to default.

## Verification

- `npm run web:build` → exits 0, all 490 client modules + 220 SSR modules transformed
- Zero `farm-*` references in any of the 6 modified files
- Zero `status-ball` references in StatusBadge
- `secondary` token confirmed present in StatusBadge
- `tertiary` token confirmed present in FlakeyBadge
- All 7 slice-level verification checks pass

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npm run web:build` | 0 | ✅ pass | 8.5s |
| 2 | `grep -rn 'farm-' web/src/app.css` | 1 (no match) | ✅ pass | <1s |
| 3 | `grep -rn 'farm-' web/src/lib/components/shared/ ...FlakeyBadge... ...format.ts` | 1 (no match) | ✅ pass | <1s |
| 4 | `grep -c '\-\-color-' web/src/app.css` | 0 → 56 | ✅ pass (≥51) | <1s |
| 5 | `grep 'Space+Grotesk' web/src/app.html` | 0 | ✅ pass | <1s |
| 6 | `grep 'glass-card' web/src/app.css` | 0 | ✅ pass | <1s |
| 7 | `grep -c 'jenkins-table\|status-ball\|sidebar-link' web/src/app.css` | 1 (no match) | ✅ pass | <1s |

## Diagnostics

- **Token residue:** `grep -rn 'farm-' web/src/lib/components/shared/ web/src/lib/components/FlakeyBadge.svelte web/src/lib/utils/format.ts` — should return zero results
- **StatusBadge structure:** Inspect any StatusBadge element in browser DevTools — should be a `<span>` with pill shape (rounded corners, uppercase text), not a `<div>` circle
- **statusStyle contract:** `import { statusStyle } from '$lib/utils/format'; statusStyle('passed').color` should return `'text-secondary'`
- **Build health:** `npm run web:build` — non-zero exit means a token reference is broken

## Deviations

None — implemented exactly as planned.

## Known Issues

None.

## Files Created/Modified

- `web/src/lib/components/shared/StatusBadge.svelte` — rewritten from .status-ball circle to tinted pill badge with status→token color mapping
- `web/src/lib/components/shared/AlertBanner.svelte` — dark tinted variant backgrounds with tertiary/primary/surface-container tokens
- `web/src/lib/components/shared/Filters.svelte` — surface-container bg, outline-variant border, on-surface text, primary focus ring
- `web/src/lib/components/shared/Pagination.svelte` — surface-container-high bg, outline-variant border, on-surface-variant text
- `web/src/lib/components/FlakeyBadge.svelte` — tertiary/10 bg + tertiary text + tertiary/20 border
- `web/src/lib/utils/format.ts` — statusStyle() returns Kinetic Console token classes for all statuses
