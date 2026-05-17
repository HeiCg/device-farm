---
id: T02
parent: S02
milestone: M002
provides:
  - Kinetic Console top navbar with DEVICE_FARM brand, 4 nav links with active underline, search input, icon buttons, auth-gated avatar/logout
key_files:
  - web/src/lib/components/layout/Header.svelte
key_decisions:
  - Used if/else blocks (consistent with T01 MobileNav pattern) for active/inactive nav link styling to comply with Tailwind v4 JIT static-string rule
patterns_established:
  - Nav active detection pattern: isActive(href, pathname) with strict equality for "/" and startsWith for all other routes — shared logic between Header nav links and MobileNav
observability_surfaces:
  - DEVICE_FARM brand text in purple at top-left of navbar — visible on every page
  - Active nav link underline (border-b-2 border-primary) changes on route navigation
  - Auth-gated avatar button in top-right triggers logout redirect to /login
  - Ghost border on bottom (border-primary/15) — inspectable in DevTools computed styles
duration: 5m
verification_result: passed
completed_at: 2026-03-18
blocker_discovered: false
---

# T02: Rewrite Header as top navbar with brand, nav links, search, and icons

**Rewrote Header.svelte from Jenkins breadcrumb bar to Kinetic Console top navbar with DEVICE_FARM brand, 4 nav links, search input, icon buttons, and auth-gated avatar/logout**

## What Happened

Replaced the entire 78-line Header.svelte (breadcrumb derivation logic, `bg-farm-sidebar`, `h-12`, "Mobile Device Farm" title) with a new ~85-line Kinetic Console top navbar. The script section now has a `navLinks` array (DASHBOARD, JOBS, DEVICES, SETTINGS), an `isActive()` function using strict equality for `/` and `startsWith` for other routes, and the preserved `handleLogout()` function.

The template renders a fixed `h-16` navbar with `bg-background/80 backdrop-blur-xl` glass effect and ghost bottom border (`border-primary/15`). Left section: "DEVICE_FARM" brand in `text-primary font-headline`, ghost divider, then nav links (`hidden md:flex`) with if/else branches for active (`text-primary border-b-2 border-primary pb-1`) and inactive (`text-on-surface-variant hover:text-on-surface`) states — all full static class strings. Right section: search input (`hidden md:flex`, `bg-surface-container`), notification and settings icon buttons with `hover:bg-primary/10` hover states, and auth-gated avatar button that triggers `handleLogout`.

No breadcrumb logic remains. Zero `farm-*` token references. Build passes clean.

## Verification

- `npm run web:build` exits 0
- Zero `farm-*` tokens in Header.svelte
- DEVICE_FARM brand present
- h-16, backdrop-blur, DASHBOARD, handleLogout all found
- Zero breadcrumb references
- Slice checks: 10 of 14 pass (remaining 4 target Nav.svelte — T03 scope), up from 8 after T01

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npm run web:build` | 0 | ✅ pass | 8.7s |
| 2 | `grep -rn 'farm-' Header.svelte` | 1 (no matches) | ✅ pass | <1s |
| 3 | `grep 'DEVICE_FARM' Header.svelte` | 0 | ✅ pass | <1s |
| 4 | `grep 'h-16' Header.svelte` | 0 | ✅ pass | <1s |
| 5 | `grep 'backdrop-blur' Header.svelte` | 0 | ✅ pass | <1s |
| 6 | `grep 'DASHBOARD' Header.svelte` | 0 | ✅ pass | <1s |
| 7 | `grep 'handleLogout' Header.svelte` | 0 | ✅ pass | <1s |
| 8 | `grep -c 'breadcrumb' Header.svelte` | 0 (count=0) | ✅ pass | <1s |

### Slice-level checks (intermediate — T02 of T01/T02/T03)

| # | Check | Verdict | Notes |
|---|-------|---------|-------|
| S1 | `npm run web:build` exits 0 | ✅ pass | |
| S2 | Zero `farm-` tokens in layout files | ❌ expected fail | Nav.svelte still has 8 farm-* refs (T03 scope) |
| S3 | MobileNav import in layout | ✅ pass | |
| S4 | `md:pl-64` in layout | ✅ pass | |
| S5 | `pb-20` in layout | ✅ pass | |
| S6 | `md:hidden` in MobileNav | ✅ pass | |
| S7 | `hidden md:flex` in Nav | ❌ expected fail | Nav.svelte rewrite is T03 scope |
| S8 | `DEVICE_FARM` in Header | ✅ pass | New in this task |
| S9 | Excluded items absent | ✅ pass | |
| S10 | `h-16` in Header | ✅ pass | New in this task |
| S11 | `w-64` in Nav | ❌ expected fail | T03 scope |
| S12 | `COMMAND_CENTER` in Nav | ❌ expected fail | T03 scope |
| S13 | `fetchHealth` in Nav | ✅ pass | |
| S14 | `setInterval` in Nav | ✅ pass | |

## Diagnostics

- **Brand visibility:** "DEVICE_FARM" text in purple at top-left of every page — if missing, token `text-primary` or `font-headline` may be broken
- **Active link underline:** Navigate routes and check for `border-b-2 border-primary` on the matching nav link; visit `/jobs/abc` and verify JOBS highlights (startsWith detection)
- **Auth avatar:** When auth enabled, person icon appears top-right; clicking triggers logout redirect to `/login`
- **Token health:** If navbar renders invisible/broken colors, inspect computed styles for `--color-primary`, `--color-background`, `--color-on-surface-variant`

## Deviations

None — implemented exactly as planned. Used if/else blocks instead of ternary for active state class switching (consistent with T01's MobileNav pattern, equivalent Tailwind v4 JIT compliance).

## Known Issues

None.

## Files Created/Modified

- `web/src/lib/components/layout/Header.svelte` — Complete rewrite: Kinetic Console top navbar with DEVICE_FARM brand, 4 nav links, active underline detection, search input, notification/settings icons, auth-gated avatar/logout, all Kinetic Console tokens, zero farm-* references
- `.gsd/milestones/M002/slices/S02/tasks/T02-PLAN.md` — Added Observability Impact section (pre-flight fix)
