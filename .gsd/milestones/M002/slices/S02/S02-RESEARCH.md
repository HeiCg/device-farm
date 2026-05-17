# S02: App Shell — Top Navbar, Sidebar, Mobile Nav, Layout — Research

**Date:** 2026-03-18

## Summary

S02 rewrites the three layout shell files (`+layout.svelte`, `Header.svelte`, `Nav.svelte`) and creates one new file (`MobileNav.svelte`). The reference HTML provides exact markup for top navbar, sidebar, mobile bottom nav, and content offset. S01 already landed all 51 color tokens, fonts, and `.glass-card` — this slice consumes them directly with no token or config work.

The key design insight: the sidebar is a **hybrid** of the reference visual style (COMMAND_CENTER header, purple active states, tonal dark palette) with the current data sections (Build Queue, Build Executor Status, Node Health). R016 explicitly requires these real-data sections; the reference HTML's RUN_NEW_JOB button and DOCUMENTATION/SUPPORT links are excluded per D012/R027 and D011/R028. The queue, executor, and health sections already have working data wiring via the health API — they just need restyling.

All four files are independent units that can be built in parallel once the layout scaffold (`+layout.svelte`) establishes the new offset dimensions (`md:pl-64 pt-16` replacing `ml-60 pt-12`). Auth gating and login-page exclusion logic stay identical.

## Recommendation

Rewrite all four files in-place. The layout file changes first (establishes new dimensions and imports MobileNav), then Header, Nav, and MobileNav can be built independently. No new APIs, no new routes, no new dependencies.

## Implementation Landscape

### Key Files

- `web/src/routes/+layout.svelte` — Root layout. Currently imports Header + Nav, wraps content in `bg-farm-canvas` with `ml-60 pt-12` offsets. Must: change to `bg-background`, import new MobileNav, update offsets to `md:pl-64 pt-16`, add `pb-20 md:pb-0` for mobile bottom nav clearance. Auth gating logic (`authChecked`, `onLoginPage`, `showDashboard`) stays as-is.
- `web/src/lib/components/layout/Header.svelte` — Top navbar. Currently `h-12 bg-farm-sidebar` with breadcrumbs. Must become: `h-16 bg-background/80 backdrop-blur-xl border-b border-primary/15`, brand "DEVICE_FARM" in `text-primary font-headline`, uppercase nav links (FLEET→Dashboard, JOBS, DEVICES, SETTINGS) with active underline detection via `page.url.pathname`, search input, notification + settings icon buttons, user avatar placeholder. Logout logic stays.
- `web/src/lib/components/layout/Nav.svelte` — Left sidebar. Currently `w-60 bg-farm-subtle border-r border-farm-border` with nav links + Build Queue + Build Executor + Node Health. Must become: `w-64 bg-background border-r border-primary/10 hidden md:flex`, COMMAND_CENTER header with green pulse dot, nav items with active state (`bg-primary/10 text-primary border-r-4 border-primary`), Build Queue section restyled to dark tonal, Build Executor table restyled, Node Health bar with secondary (green) color. Health API polling stays. All `farm-*` token references (8 occurrences) replaced with Kinetic Console tokens.
- `web/src/lib/components/layout/MobileNav.svelte` — **New file.** Fixed bottom bar, `md:hidden`, `bg-background/95 backdrop-blur-xl border-t border-primary/15`. Four items: Dashboard (dashboard), Devices (developer_board), Jobs (terminal), Settings (tune). Active state: `text-primary`. Uses `page` store for active detection.

### Reference HTML → Implementation Mapping

**Top Navbar** (from `dashboard_fleet_overview/code.html`):
- Dimensions: `fixed top-0 w-full z-50 h-16`
- Background: `bg-background/80 backdrop-blur-xl`  
- Border: `border-b border-primary/15` (ghost border, not solid line — No-Line Rule)
- Shadow: `shadow-[0_4px_24px_rgba(157,89,255,0.06)]` (ambient purple glow)
- Brand: `text-xl font-bold tracking-tighter text-primary font-headline` → text "DEVICE_FARM" (per D010)
- Nav links: `font-headline uppercase tracking-wider text-sm` — active: `text-primary border-b-2 border-primary pb-1`, inactive: `text-on-surface-variant hover:text-on-surface`
- Nav items per D011/R028: Dashboard (/), Jobs (/jobs), Devices (/devices), Settings (/settings) — no Analytics/Reports/Logs
- Search: `bg-surface-container rounded-lg px-3 py-1 border border-outline-variant/30` — hidden on mobile (`hidden md:flex`)
- Icons: notification + settings buttons with `hover:bg-primary/10 hover:text-primary`
- Avatar: `w-8 h-8 rounded-full border border-primary/30` — placeholder div (no real user image)

**Sidebar** (hybrid of reference style + R016 data sections):
- Dimensions: `fixed left-0 top-16 h-[calc(100vh-4rem)] w-64`
- Background: `bg-background border-r border-primary/10`
- Visibility: `hidden md:flex flex-col`
- COMMAND_CENTER header: green pulse dot (`w-2 h-2 rounded-full bg-secondary animate-pulse`) + "COMMAND_CENTER" in `font-headline font-bold text-primary text-sm` + version string `text-[10px] text-on-surface-variant font-mono`
- Nav items: `flex items-center px-6 py-3 gap-3` — active: `bg-primary/10 text-primary border-r-4 border-primary` — inactive: `text-on-surface-variant hover:bg-white/5`  
- Icon hover micro-interaction: `group-hover:translate-x-1 transition-transform`
- Build Queue section (NOT in reference — from R016, restyled): section header `font-headline text-[10px] tracking-[0.2em] uppercase text-on-surface-variant`, content in `bg-surface-container-low rounded-lg p-3 text-[11px] text-on-surface-variant`
- Build Executor Status (NOT in reference — from R016, restyled): device list with state colors using Kinetic Console tokens (`text-secondary` for running, `text-on-surface-variant` for idle, `text-tertiary` for error)
- Node Health bar (NOT in reference — from R016, restyled): `bg-secondary` bar on `bg-surface-container-highest` track, percentage in `text-on-surface-variant` with secondary highlight
- NO RUN_NEW_JOB button (D012/R027)
- NO DOCUMENTATION/SUPPORT links (D011/R028 — not real routes)

**Mobile Bottom Nav** (from `dashboard_fleet_overview/code.html`):
- Dimensions: `fixed bottom-0 left-0 w-full h-16 z-50`
- Visibility: `md:hidden`
- Background: `bg-background/95 backdrop-blur-xl border-t border-primary/15`
- Items: `flex justify-around items-center` — each: column flex with icon + `text-[10px] font-label` label
- Active: `text-primary font-bold`, inactive: `text-on-surface-variant`
- Nav items: Dashboard, Devices, Jobs, Settings (per R028)

**Layout offsets** (from reference `<main>`):
- Current: `ml-60 pt-12`
- New: `md:pl-64 pt-16` — uses `pl` (padding) not `ml` (margin) since sidebar is hidden on mobile
- Mobile: no left offset, add `pb-20` for bottom nav clearance

### Nav Item Mapping (D011/R028 applied to reference)

| Reference Label | Our Label | Route | Icon | Location |
|----------------|-----------|-------|------|----------|
| FLEET | DASHBOARD | / | dashboard | navbar + sidebar + mobile |
| JOBS | JOBS | /jobs | terminal | navbar + sidebar + mobile |
| DEVICE_FARM | DEVICES | /devices | developer_board | navbar + sidebar + mobile |
| SETTINGS | SETTINGS | /settings | tune | navbar + sidebar + mobile |
| ~~ANALYTICS~~ | — | — | — | excluded (D011) |
| ~~REPORTS~~ | — | — | — | excluded (D011) |
| ~~TEST_SUITES~~ | — | — | — | excluded (D011) |
| ~~LOGS~~ | — | — | — | excluded (D011) |

### farm-* Token Replacement Map

| Old Token | New Token | Files |
|-----------|-----------|-------|
| `bg-farm-canvas` | `bg-background` | +layout.svelte |
| `bg-farm-sidebar` | `bg-background/80 backdrop-blur-xl` | Header.svelte |
| `bg-farm-subtle` | `bg-background` | Nav.svelte |
| `border-farm-border` | `border-primary/10` or `border-outline-variant/20` | Nav.svelte |
| `text-farm-accent` | `text-primary` or `text-on-surface-variant` | Nav.svelte |
| `text-farm-fg` | `text-on-surface` | Nav.svelte |
| `text-farm-danger` | `text-tertiary` | Nav.svelte |
| `bg-white` (light) | `bg-surface-container` or `bg-primary/10` | Nav.svelte |

### Build Order

1. **`+layout.svelte`** first — establishes the new shell dimensions and imports. Without this, nothing else renders correctly.
2. **`MobileNav.svelte`** (new file) — created early since layout imports it. Simple stateless component.
3. **`Header.svelte`** and **`Nav.svelte`** can be built in either order — they're independent siblings in the layout.

Recommended task decomposition:
- **T01**: Layout scaffold + MobileNav (new file + layout rewrite — establishes offsets, imports, mobile padding)
- **T02**: Header rewrite (top navbar — brand, nav links, search, icons)
- **T03**: Nav rewrite (sidebar — COMMAND_CENTER, nav items, queue/executor/health sections)

T02 and T03 are independent after T01.

### Verification Approach

1. `npm run web:build` exits 0 — proves no broken imports or token references
2. `grep -rn 'farm-' web/src/routes/+layout.svelte web/src/lib/components/layout/` → zero results — all old tokens eliminated
3. `grep -l 'MobileNav' web/src/routes/+layout.svelte` → found — new component imported
4. `grep 'md:pl-64' web/src/routes/+layout.svelte` → found — correct content offset
5. `grep 'md:hidden' web/src/lib/components/layout/MobileNav.svelte` → found — mobile-only visibility
6. `grep 'hidden md:flex' web/src/lib/components/layout/Nav.svelte` → found — sidebar hidden on mobile
7. `grep 'DEVICE_FARM' web/src/lib/components/layout/Header.svelte` → found — correct brand (D010)
8. `grep 'RUN_NEW_JOB\|DOCUMENTATION\|SUPPORT\|Analytics\|Reports\|Test.Suites\|Logs' web/src/lib/components/layout/` → zero results — excluded items absent (D011, D012, R027, R028)
9. `grep 'h-16' web/src/lib/components/layout/Header.svelte` → found — correct navbar height
10. `grep 'w-64' web/src/lib/components/layout/Nav.svelte` → found — correct sidebar width

## Constraints

- **Tailwind v4 JIT static class rule** (D016, KNOWLEDGE.md) — all class names must be full static strings. Active state classes in nav items must use conditional expressions selecting between complete class strings, never template interpolation.
- **No-Line Rule** (DESIGN.md §2) — no `1px solid` borders for sectioning. Use background color shifts or ghost borders (`border-primary/10`, `border-outline-variant/20`).
- **Login page excluded from shell** — current `onLoginPage` conditional rendering must be preserved exactly.
- **Health API polling** — Nav.svelte's `setInterval(fetchHealth, 5000)` + `onDestroy` cleanup must be preserved for queue/executor/health data.

## Common Pitfalls

- **Mobile bottom nav overlapping content** — the main content area needs `pb-20 md:pb-0` to prevent the bottom nav from covering content on mobile. The reference uses `min-h-screen` on main but doesn't add bottom padding — our implementation must.
- **Sidebar visibility class order** — `hidden md:flex` must be in this order for Tailwind to generate the correct responsive override. `flex hidden md:block` would not work correctly.
- **`page.url.pathname` reactive access** — Svelte 5 uses `page` from `$app/state` (not `$app/stores`). The current code already uses the correct import. Active state detection for `/jobs/:id` must also highlight the JOBS link — use `pathname.startsWith('/jobs')` not strict equality.
