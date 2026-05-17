---
id: T01
parent: S02
milestone: M002
provides:
  - Layout scaffold with new Kinetic Console offsets (md:pl-64 pt-16 pb-20 md:pb-0)
  - MobileNav component with 4 nav items, active state detection, md:hidden visibility
key_files:
  - web/src/routes/+layout.svelte
  - web/src/lib/components/layout/MobileNav.svelte
key_decisions:
  - Used if/else blocks (not ternary class expressions) for active state styling in MobileNav to comply with Tailwind v4 JIT static-string rule
patterns_established:
  - MobileNav pattern: full static class strings in if/else branches for active/inactive state — avoids dynamic class construction per KNOWLEDGE.md Tailwind v4 JIT rule
observability_surfaces:
  - Inspect main element for md:pl-64 pt-16 pb-20 md:pb-0 classes to verify layout offsets
  - Resize below md breakpoint to verify MobileNav appears fixed at bottom
  - Navigate routes and check active nav item has text-primary class
duration: 8m
verification_result: passed
completed_at: 2026-03-18
blocker_discovered: false
---

# T01: Rewrite layout scaffold and create mobile bottom nav

**Rewrote +layout.svelte with Kinetic Console offsets and created MobileNav.svelte fixed bottom bar with 4 nav items**

## What Happened

Created `MobileNav.svelte` as a fixed bottom navigation bar visible only on mobile (`md:hidden`). It renders 4 items (Dashboard, Jobs, Devices, Settings) with Material Symbols icons and uses `page.url.pathname` for active state detection — active items get `text-primary font-bold`, inactive get `text-on-surface-variant`. All class names are full static strings in `{#if}/{:else}` blocks to satisfy the Tailwind v4 JIT scanning rule.

Rewrote `+layout.svelte` to replace the old shell structure. Changed `bg-farm-canvas` to `bg-background`, removed the `flex flex-1 pt-12` wrapper, and restructured the `showDashboard` branch to place Header, Nav, main content, and MobileNav as flat siblings. The main content area uses `md:pl-64 pt-16 pb-20 md:pb-0` for sidebar width (desktop only), navbar height, and mobile bottom nav clearance. All auth gating logic (`authChecked`, `onLoginPage`, `showDashboard`) and the login page bare-children branch preserved exactly.

Initial build failed because `<script>` lacked `lang="ts"` for the TypeScript function signature — fixed by adding the attribute.

## Verification

- `npm run web:build` exits 0
- Zero `farm-*` tokens in `+layout.svelte`
- MobileNav imported and rendered in layout
- Layout uses `md:pl-64`, `pt-16`, `pb-20 md:pb-0` offsets
- MobileNav has `md:hidden`, `text-primary`, and exactly 4 nav items
- Slice-level checks: 8 of 14 pass (remaining 6 target Header.svelte and Nav.svelte — T02/T03 scope)

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npm run web:build` | 0 | ✅ pass | 7.7s |
| 2 | `grep -rn 'farm-' web/src/routes/+layout.svelte` | 1 (no matches) | ✅ pass | <1s |
| 3 | `grep 'MobileNav' web/src/routes/+layout.svelte` | 0 | ✅ pass | <1s |
| 4 | `grep 'md:pl-64' web/src/routes/+layout.svelte` | 0 | ✅ pass | <1s |
| 5 | `grep 'pb-20' web/src/routes/+layout.svelte` | 0 | ✅ pass | <1s |
| 6 | `grep 'md:hidden' .../MobileNav.svelte` | 0 | ✅ pass | <1s |
| 7 | `grep 'text-primary' .../MobileNav.svelte` | 0 | ✅ pass | <1s |
| 8 | `grep -c 'Dashboard\|Jobs\|Devices\|Settings' .../MobileNav.svelte` | 0 (count=4) | ✅ pass | <1s |

### Slice-level checks (intermediate — T01 of T01/T02/T03)

| # | Check | Verdict | Notes |
|---|-------|---------|-------|
| S1 | `npm run web:build` exits 0 | ✅ pass | |
| S2 | `grep -rn 'farm-'` in layout files → zero | ❌ expected fail | Header.svelte and Nav.svelte still have farm-* tokens (T02/T03 scope) |
| S3 | MobileNav import in layout | ✅ pass | |
| S4 | `md:pl-64` in layout | ✅ pass | |
| S5 | `pb-20` in layout | ✅ pass | |
| S6 | `md:hidden` in MobileNav | ✅ pass | |
| S7 | `hidden md:flex` in Nav | ❌ expected fail | Nav.svelte rewrite is T03 scope |
| S8 | `DEVICE_FARM` in Header | ❌ expected fail | Header.svelte rewrite is T02 scope |
| S9 | Excluded items absent | ✅ pass | No RUN_NEW_JOB, DOCUMENTATION, etc. in layout dir |
| S10 | `h-16` in Header | ❌ expected fail | Header.svelte rewrite is T02 scope |
| S11 | `w-64` in Nav | ❌ expected fail | Nav.svelte rewrite is T03 scope |
| S12 | `COMMAND_CENTER` in Nav | ❌ expected fail | Nav.svelte rewrite is T03 scope |
| S13 | `fetchHealth` in Nav | ✅ pass | Existing wiring preserved |
| S14 | `setInterval` in Nav | ✅ pass | Existing polling preserved |

## Diagnostics

- **Layout offsets:** Inspect `<main>` element in DevTools for classes `md:pl-64 pt-16 pb-20 md:pb-0`
- **MobileNav visibility:** Resize browser below 768px → fixed bottom bar appears; above 768px → hidden
- **Active state:** Navigate between routes, inspect MobileNav links for `text-primary` (active) vs `text-on-surface-variant` (inactive)
- **Auth gating:** Visit `/login` → no shell chrome; visit `/` authenticated → full shell with Header, Nav, main, MobileNav

## Deviations

- Added `lang="ts"` to MobileNav's `<script>` tag — plan didn't specify but TypeScript type annotations require it in Svelte components.

## Known Issues

None.

## Files Created/Modified

- `web/src/lib/components/layout/MobileNav.svelte` — New: fixed bottom nav bar with 4 items, Material Symbols icons, active state via page.url.pathname, md:hidden
- `web/src/routes/+layout.svelte` — Rewritten: bg-background, md:pl-64 pt-16 pb-20 md:pb-0 offsets, MobileNav imported, auth gating preserved
- `.gsd/milestones/M002/slices/S02/tasks/T01-PLAN.md` — Added Observability Impact section (pre-flight fix)
