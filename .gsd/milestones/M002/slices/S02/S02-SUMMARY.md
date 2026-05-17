---
id: S02
parent: M002
milestone: M002
provides:
  - Kinetic Console top navbar (h-16, backdrop-blur, DEVICE_FARM brand, 4 nav links with active underline, search, icons, auth avatar/logout)
  - Kinetic Console left sidebar (w-64, COMMAND_CENTER header with green pulse, active right-border nav items, Build Queue, Build Executor, Node Health bar — all health API wired)
  - Mobile bottom nav (md:hidden, 4 items with Material Symbols icons, text-primary active state)
  - Layout scaffold with correct offsets (md:pl-64 pt-16 pb-20 md:pb-0) and auth gating preserved
requires:
  - slice: S01
    provides: 51 @theme color tokens, font-headline/font-body/font-label families, .glass-card class
affects:
  - S03
  - S04
  - S05
key_files:
  - web/src/routes/+layout.svelte
  - web/src/lib/components/layout/Header.svelte
  - web/src/lib/components/layout/Nav.svelte
  - web/src/lib/components/layout/MobileNav.svelte
key_decisions:
  - If/else blocks (not ternary) for active/inactive styling across all nav components — Tailwind v4 JIT static-string compliance (extends D016 pattern from S01)
patterns_established:
  - Nav active detection: isActive(href, pathname) with strict equality for "/" and startsWith for all other routes — shared across Header and MobileNav
  - Sidebar data section headers: font-headline text-[10px] tracking-[0.2em] uppercase text-on-surface-variant — consistent pattern for all sidebar widget labels
  - Device state color mapping: text-secondary (Running), text-on-surface-variant (Idle), text-primary (Booting/Allocated), text-primary/70 (Cleanup), text-tertiary (Error), text-outline-variant (Offline)
observability_surfaces:
  - Health API polling (setInterval(fetchHealth, 5000)) drives sidebar queue/executor/health sections — /api/health calls visible in Network tab
  - Sidebar degrades gracefully on health API failure — silent catch shows stale/zero data
  - Active nav state visible across all three nav surfaces (Header underline, Nav right-border, MobileNav text color)
drill_down_paths:
  - .gsd/milestones/M002/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M002/slices/S02/tasks/T02-SUMMARY.md
  - .gsd/milestones/M002/slices/S02/tasks/T03-SUMMARY.md
duration: 25m
verification_result: passed
completed_at: 2026-03-18
---

# S02: App Shell — Top Navbar, Sidebar, Mobile Nav, Layout

**Rewrote the entire app shell from Jenkins light theme to Kinetic Console dark command-center: fixed top navbar with DEVICE_FARM brand and nav links, w-64 left sidebar with COMMAND_CENTER header and health-API-wired data sections, mobile bottom nav for small viewports, and correctly offset content area.**

## What Happened

Three tasks rewrote the four layout files that frame every page in the app.

**T01 (Layout + MobileNav):** Created `MobileNav.svelte` as a fixed bottom bar visible on mobile (`md:hidden`) with 4 nav items (Dashboard, Jobs, Devices, Settings) using Material Symbols icons and `page.url.pathname` active detection. Rewrote `+layout.svelte` to replace `bg-farm-canvas` with `bg-background`, restructured the authenticated branch to render Header, Nav, main content (`md:pl-64 pt-16 pb-20 md:pb-0`), and MobileNav as flat siblings. Auth gating logic preserved exactly.

**T02 (Header as top navbar):** Complete rewrite of `Header.svelte` from a 78-line breadcrumb bar to an 85-line Kinetic Console top navbar. Fixed `h-16` with `bg-background/80 backdrop-blur-xl` glass effect and ghost bottom border. Left section: "DEVICE_FARM" brand in `text-primary font-headline`. Center: 4 nav links with if/else active detection (underline on active route). Right: search input, notification/settings icons, auth-gated avatar/logout button.

**T03 (Nav sidebar):** Complete reskin of `Nav.svelte` (145→158 lines) preserving all script logic. Changed from `w-60 top-12 bg-farm-subtle` to `w-64 top-16 bg-background hidden md:flex`. Added COMMAND_CENTER header with green pulse dot. Restyled all nav items with purple active right-border. Replaced all 8 `farm-*` token references in `deviceStateLabel()` with Kinetic Console semantic tokens. Restyled Build Queue, Build Executor, and Node Health sections with dark tonal palette. Health API polling (`fetchHealth`, `setInterval(5000)`, `onDestroy` cleanup) preserved exactly.

## Verification

All 14 slice-level checks pass:

| # | Check | Result |
|---|-------|--------|
| 1 | `npm run web:build` exits 0 | ✅ |
| 2 | Zero `farm-*` in layout files | ✅ (grep returns no matches) |
| 3 | MobileNav imported in layout | ✅ |
| 4 | `md:pl-64` in layout | ✅ |
| 5 | `pb-20` in layout | ✅ |
| 6 | `md:hidden` in MobileNav | ✅ |
| 7 | `hidden md:flex` in Nav | ✅ |
| 8 | `DEVICE_FARM` in Header | ✅ |
| 9 | Excluded items absent (RUN_NEW_JOB, DOCUMENTATION, etc.) | ✅ |
| 10 | `h-16` in Header | ✅ |
| 11 | `w-64` in Nav | ✅ |
| 12 | `COMMAND_CENTER` in Nav | ✅ |
| 13 | `fetchHealth` in Nav | ✅ |
| 14 | `setInterval` in Nav | ✅ |

## Requirements Advanced

- R012 — Layout files now use Kinetic Console tokens exclusively. ~160 farm-* usages remain only in page-level components (S03-S05 scope).
- R013 — font-headline applied to DEVICE_FARM brand (Header) and COMMAND_CENTER header (Nav). font-body/font-label used in nav items and sidebar sections.
- R024 — Ghost borders used throughout: `border-primary/15` on navbar bottom, `border-primary/10` on sidebar right edge, `border-outline-variant/10` on executor table — no solid 1px sectioning borders.

## Requirements Validated

- R015 — Top navbar implements full spec: h-16, bg-background/80 backdrop-blur, DEVICE_FARM brand, 4 nav links with active underline, search, icons, avatar
- R016 — Sidebar implements full spec: w-64, COMMAND_CENTER header + pulse dot, active state nav items, queue/executor/health all wired to fetchHealth polling
- R017 — MobileNav: md:hidden bottom bar with 4 items, Material Symbols icons, text-primary active state
- R027 — Zero RUN_NEW_JOB references in any layout file
- R028 — Only real routes in all three nav surfaces; zero placeholder items

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

- Added `lang="ts"` to MobileNav's `<script>` tag — plan didn't specify but TypeScript type annotations require it in Svelte components.
- T03 noted a plan-internal contradiction: verification grep for `bg-white\b` would match `bg-white/5` which the plan itself prescribes as a hover overlay. No code change needed.

## Known Limitations

- Search input in top navbar is visual-only — no search functionality wired (placeholder, consistent with reference design scope)
- Notification icon is visual-only — no notification system exists
- Sidebar health data degrades silently on API failure — stale/zero data shown (existing behavior, intentionally preserved)

## Follow-ups

- none

## Files Created/Modified

- `web/src/lib/components/layout/MobileNav.svelte` — New: fixed bottom nav bar with 4 items, Material Symbols icons, active state, md:hidden
- `web/src/routes/+layout.svelte` — Rewritten: bg-background, md:pl-64 pt-16 pb-20 md:pb-0 offsets, MobileNav imported, auth gating preserved
- `web/src/lib/components/layout/Header.svelte` — Rewritten: Kinetic Console top navbar with DEVICE_FARM brand, nav links, search, icons, auth avatar/logout
- `web/src/lib/components/layout/Nav.svelte` — Reskinned: COMMAND_CENTER header, dark nav items, restyled queue/executor/health, all farm-* tokens replaced

## Forward Intelligence

### What the next slice should know
- The layout offset is `md:pl-64 pt-16 pb-20 md:pb-0` — all page content renders inside this padded container. Pages don't need their own navbar/sidebar spacing.
- Header nav links use `startsWith` matching for sub-routes (e.g., `/jobs/abc` highlights JOBS). New routes must be added to `navLinks` array in Header.svelte if they should appear in the top nav.
- Login page renders outside the shell — the auth gating in `+layout.svelte` shows bare `<slot />` when `onLoginPage` is true.

### What's fragile
- The `isActive()` function uses exact `===` for "/" and `startsWith` for all other routes. If a route like `/devices-new` is added, it would incorrectly match `/devices`. Not a current risk since all routes are clean prefixes.
- `bg-background/80` on the navbar depends on Tailwind v4 parsing the opacity modifier on custom `@theme` colors. If Tailwind config changes, the glass effect could break silently.

### Authoritative diagnostics
- Network tab → `/api/health` requests every 5s confirm sidebar data polling is alive
- DevTools → inspect `<main>` element classes to verify layout offsets are correct
- Resize to <768px → MobileNav appears, sidebar hides; >768px → sidebar appears, MobileNav hides

### What assumptions changed
- Sidebar grew from 145 to 158 lines — the COMMAND_CENTER header and restyled sections add visual structure but the data logic surface area is unchanged
- Nav link labels changed (Build History→Jobs, Runners→Devices, Manage→Settings) to match the top navbar's vocabulary — all three nav surfaces now use consistent route names
