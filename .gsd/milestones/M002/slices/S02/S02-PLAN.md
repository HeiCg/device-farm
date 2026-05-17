# S02: App Shell — Top Navbar, Sidebar, Mobile Nav, Layout

**Goal:** Rewrite the app shell (layout, top navbar, sidebar, mobile nav) from Jenkins light theme to Kinetic Console dark command-center aesthetic using S01's token system.
**Demo:** Open any page and see: obsidian dark top navbar with "DEVICE_FARM" brand + nav links + search; left sidebar with COMMAND_CENTER header, nav items, queue/executor/health sections; mobile bottom nav on small screens; content area correctly offset under both shell elements. All data wiring (health API polling, queue depth, executor status) still works.

## Must-Haves

- Top navbar: `h-16`, `bg-background/80 backdrop-blur-xl`, "DEVICE_FARM" brand in `text-primary font-headline`, nav links (DASHBOARD, JOBS, DEVICES, SETTINGS) with active underline, search input, notification + settings icons, user avatar placeholder (R015)
- Left sidebar: `w-64`, COMMAND_CENTER header with green pulse dot, nav items with `bg-primary/10 text-primary border-r-4` active state, Build Queue section, Build Executor Status, Node Health bar — all wired to real health API data (R016)
- Mobile bottom nav: `md:hidden`, `bg-background/95 backdrop-blur-xl`, Dashboard/Devices/Jobs/Settings with Material Symbols icons, `text-primary` active state (R017)
- Content area offset: `md:pl-64 pt-16 pb-20 md:pb-0` (sidebar + navbar + mobile nav clearance)
- No RUN_NEW_JOB button anywhere (R027, D012)
- No placeholder nav items — only Dashboard (/), Jobs (/jobs), Devices (/devices), Settings (/settings) (R028, D011)
- Zero `farm-*` token references in any layout file
- Login page renders outside the shell (existing auth gating preserved)
- `npm run web:build` exits 0

## Proof Level

- This slice proves: contract + integration
- Real runtime required: yes (health API polling must function)
- Human/UAT required: yes (visual comparison against reference for final milestone sign-off)

## Verification

1. `npm run web:build` exits 0
2. `grep -rn 'farm-' web/src/routes/+layout.svelte web/src/lib/components/layout/` → zero results
3. `grep -l 'MobileNav' web/src/routes/+layout.svelte` → found (new component imported)
4. `grep 'md:pl-64' web/src/routes/+layout.svelte` → found (correct content offset)
5. `grep 'pb-20' web/src/routes/+layout.svelte` → found (mobile bottom nav clearance)
6. `grep 'md:hidden' web/src/lib/components/layout/MobileNav.svelte` → found (mobile-only visibility)
7. `grep 'hidden md:flex' web/src/lib/components/layout/Nav.svelte` → found (sidebar hidden on mobile)
8. `grep 'DEVICE_FARM' web/src/lib/components/layout/Header.svelte` → found (correct brand per D010)
9. `grep -rn 'RUN_NEW_JOB\|DOCUMENTATION\|SUPPORT\|Analytics\|Reports\|Test.Suites\|Logs' web/src/lib/components/layout/` → zero results (excluded items absent per D011, D012, R027, R028)
10. `grep 'h-16' web/src/lib/components/layout/Header.svelte` → found (correct navbar height)
11. `grep 'w-64' web/src/lib/components/layout/Nav.svelte` → found (correct sidebar width)
12. `grep 'COMMAND_CENTER' web/src/lib/components/layout/Nav.svelte` → found (sidebar header)
13. `grep 'fetchHealth' web/src/lib/components/layout/Nav.svelte` → found (health API wiring preserved)
14. `grep 'setInterval' web/src/lib/components/layout/Nav.svelte` → found (polling preserved)

## Observability / Diagnostics

- Runtime signals: Health API polling (`setInterval(fetchHealth, 5000)`) drives queue depth, executor status, and health bar in sidebar — same mechanism as before, restyled
- Inspection surfaces: Browser DevTools Network tab shows `/api/health` calls every 5s when sidebar is visible; sidebar sections visually degrade to empty/zero state when health API is unavailable
- Failure visibility: Silent catch in `fetchHealth()` — sidebar shows stale data on API failure (existing behavior, preserved)

## Integration Closure

- Upstream surfaces consumed: S01's `app.css` with 51 `--color-*` tokens, `font-headline`/`font-body`/`font-label` font utilities, `.glass-card` CSS class
- New wiring introduced: `MobileNav.svelte` created and imported in `+layout.svelte`; layout offset changed from `ml-60 pt-12` to `md:pl-64 pt-16 pb-20 md:pb-0`
- What remains: S03 (Dashboard page content), S04 (Jobs page content), S05 (Runners/Settings/Login page content)

## Tasks

- [x] **T01: Rewrite layout scaffold and create mobile bottom nav** `est:25m`
  - Why: Establishes the new shell dimensions (`md:pl-64 pt-16 pb-20 md:pb-0`), replaces `bg-farm-canvas` with `bg-background`, imports the new `MobileNav` component. T02 and T03 depend on this being in place first.
  - Files: `web/src/routes/+layout.svelte`, `web/src/lib/components/layout/MobileNav.svelte`
  - Do: Rewrite `+layout.svelte` to use `bg-background`, new offsets, import MobileNav, preserve auth gating exactly. Create `MobileNav.svelte` as a fixed bottom bar with 4 nav items using Material Symbols icons, active state detection via `page.url.pathname`, `md:hidden` visibility.
  - Verify: `npm run web:build` exits 0; `grep -rn 'farm-' web/src/routes/+layout.svelte` → zero results; `grep 'MobileNav' web/src/routes/+layout.svelte` → found; `grep 'md:pl-64' web/src/routes/+layout.svelte` → found; `grep 'md:hidden' web/src/lib/components/layout/MobileNav.svelte` → found
  - Done when: Layout uses new tokens, MobileNav renders on mobile viewports, build passes

- [x] **T02: Rewrite Header as top navbar with brand, nav links, search, and icons** `est:30m`
  - Why: Replaces the Jenkins-era breadcrumb header with the Kinetic Console top navbar (R015). Complete structural redesign — breadcrumbs removed, replaced by horizontal nav links with active underline detection, search input, icon buttons, and "DEVICE_FARM" brand.
  - Files: `web/src/lib/components/layout/Header.svelte`
  - Do: Complete rewrite. Fixed `h-16` navbar, `bg-background/80 backdrop-blur-xl`, brand with `text-primary font-headline`, 4 nav links (DASHBOARD, JOBS, DEVICES, SETTINGS) with `page.url.pathname` active detection (use `.startsWith()` for /jobs/:id), search input, notification + settings icons, user avatar placeholder. Preserve logout logic. All class names must be full static strings (Tailwind v4 JIT rule).
  - Verify: `npm run web:build` exits 0; `grep -rn 'farm-' web/src/lib/components/layout/Header.svelte` → zero results; `grep 'DEVICE_FARM' web/src/lib/components/layout/Header.svelte` → found; `grep 'h-16' web/src/lib/components/layout/Header.svelte` → found
  - Done when: Header renders as Kinetic Console top navbar with brand, nav links, search, icons — zero `farm-*` tokens

- [x] **T03: Rewrite Nav sidebar with COMMAND_CENTER header and restyled data sections** `est:35m`
  - Why: Replaces the Jenkins-era light sidebar with Kinetic Console dark sidebar (R016). Must preserve all health API wiring (fetchHealth, setInterval, onDestroy cleanup, queue depth, executor status, health bar) while completely restyling. Most complex file in the slice — 145 lines with data logic that must survive the reskin.
  - Files: `web/src/lib/components/layout/Nav.svelte`
  - Do: Complete rewrite preserving all script logic. `w-64` sidebar, `hidden md:flex`, COMMAND_CENTER header with green pulse dot, nav items with active state (`bg-primary/10 text-primary border-r-4 border-primary`), icon hover micro-interaction. Restyle Build Queue to dark tonal (`bg-surface-container-low`), Build Executor table to use Kinetic Console state colors (`text-secondary` running, `text-on-surface-variant` idle, `text-tertiary` error), Node Health bar to `bg-secondary` on `bg-surface-container-highest` track. Replace all 8 `farm-*` token references. All `deviceStateLabel` classes must be full static strings (Tailwind v4 JIT rule). NO RUN_NEW_JOB button. NO DOCUMENTATION/SUPPORT links.
  - Verify: `npm run web:build` exits 0; `grep -rn 'farm-' web/src/lib/components/layout/Nav.svelte` → zero results; `grep 'hidden md:flex' web/src/lib/components/layout/Nav.svelte` → found; `grep 'w-64' web/src/lib/components/layout/Nav.svelte` → found; `grep 'COMMAND_CENTER' web/src/lib/components/layout/Nav.svelte` → found; `grep 'fetchHealth' web/src/lib/components/layout/Nav.svelte` → found; `grep 'setInterval' web/src/lib/components/layout/Nav.svelte` → found
  - Done when: Sidebar renders with COMMAND_CENTER header, dark-themed data sections, health API polling preserved — zero `farm-*` tokens

## Files Likely Touched

- `web/src/routes/+layout.svelte`
- `web/src/lib/components/layout/Header.svelte`
- `web/src/lib/components/layout/Nav.svelte`
- `web/src/lib/components/layout/MobileNav.svelte` (new)
