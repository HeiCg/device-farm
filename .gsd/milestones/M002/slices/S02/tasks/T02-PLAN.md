---
estimated_steps: 4
estimated_files: 1
---

# T02: Rewrite Header as top navbar with brand, nav links, search, and icons

**Slice:** S02 — App Shell — Top Navbar, Sidebar, Mobile Nav, Layout
**Milestone:** M002

## Description

Complete rewrite of `Header.svelte` from the Jenkins-era dark navy breadcrumb bar to the Kinetic Console top navbar (R015). The current file is 78 lines with breadcrumb derivation logic and a logout button. The new file will have horizontal nav links with active underline detection, a search input, notification + settings icon buttons, a user avatar placeholder, and the "DEVICE_FARM" brand in purple.

The breadcrumb derivation logic (`routeLabels`, `breadcrumbs` derived) is removed entirely — replaced by a simpler nav links array with `isActive()` detection. The logout handler is preserved and wired to the user avatar area.

**Relevant skill:** `frontend-design` — load for Svelte 5 / Tailwind v4 component patterns.

## Steps

1. **Rewrite `Header.svelte`** with new script section:
   - Keep imports: `page` from `$app/state`, auth stores (`isAuthenticated`, `isAuthEnabled`, `clearApiKey`)
   - Remove: `routeLabels` and `breadcrumbs` derived logic
   - Add nav links array:
     ```typescript
     const navLinks = [
       { href: '/', label: 'DASHBOARD' },
       { href: '/jobs', label: 'JOBS' },
       { href: '/devices', label: 'DEVICES' },
       { href: '/settings', label: 'SETTINGS' },
     ];
     ```
   - Add `isActive(href, pathname)` function: for `/` use strict equality, for others use `pathname.startsWith(href)`. Must also highlight JOBS for `/jobs/:id` paths.
   - Keep `handleLogout()` function exactly as-is

2. **Write new template** — fixed top navbar:
   - Outer `<header>`: `fixed top-0 left-0 right-0 z-50 h-16 bg-background/80 backdrop-blur-xl border-b border-primary/15 shadow-[0_4px_24px_rgba(157,89,255,0.06)]`
   - Inner layout: `flex items-center justify-between px-6 h-full`
   - **Left section** — brand + nav links:
     - Brand: `<span class="text-xl font-bold tracking-tighter text-primary font-headline">DEVICE_FARM</span>`
     - Separator: `<div class="h-6 w-px bg-outline-variant/20 mx-4"></div>` (ghost divider, No-Line Rule)
     - Nav links: `{#each navLinks as link}` — each is an `<a>` with:
       - Active: `text-primary border-b-2 border-primary pb-1` 
       - Inactive: `text-on-surface-variant hover:text-on-surface`
       - Common: `font-headline uppercase tracking-wider text-sm px-3 py-1 transition-colors`
       - Use full static class strings via ternary — NOT dynamic construction
       - Hidden on mobile: wrap nav links container in `hidden md:flex items-center gap-2`
   - **Right section** — search + icons + avatar:
     - Search input: `hidden md:flex` container, `<input>` with `bg-surface-container rounded-lg px-3 py-1.5 text-sm border border-outline-variant/30 text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:border-primary/50 w-48`, placeholder "Search..."
     - Notification icon button: `<button>` with `p-2 rounded-lg hover:bg-primary/10 hover:text-primary text-on-surface-variant transition-colors`, Material Symbols `notifications` icon
     - Settings icon button: same styling, `settings` icon
     - User avatar area (only when authenticated): `<div class="w-8 h-8 rounded-full border border-primary/30 bg-surface-container flex items-center justify-center cursor-pointer">` with `person` icon, onclick triggers logout
     - When auth enabled + authenticated, show avatar with logout on click. Keep the logout logic from current file.

3. **Verify build**: Run `npm run web:build` and confirm exit code 0.

4. **Verify token migration**: Run `grep -rn 'farm-' web/src/lib/components/layout/Header.svelte` and confirm zero results.

## Must-Haves

- [ ] Brand text is "DEVICE_FARM" (not "Mobile Device Farm" or "KINETIC_CONSOLE") — per D010
- [ ] Navbar is `h-16` with `bg-background/80 backdrop-blur-xl` — per R015
- [ ] Exactly 4 nav links: DASHBOARD, JOBS, DEVICES, SETTINGS — per R028
- [ ] Active nav link shows `text-primary border-b-2 border-primary` underline
- [ ] `/jobs/:id` routes highlight the JOBS link (use `startsWith('/jobs')`)
- [ ] Search input present with `bg-surface-container` styling
- [ ] Notification + settings icon buttons present
- [ ] User avatar placeholder with `border-primary/30`
- [ ] Logout logic preserved from current file
- [ ] No breadcrumb logic remains
- [ ] No `farm-*` token references
- [ ] All class names are full static strings (Tailwind v4 JIT rule)
- [ ] Ghost border on bottom (`border-primary/15`) not solid line (No-Line Rule)
- [ ] `npm run web:build` exits 0

## Verification

- `npm run web:build` exits 0
- `grep -rn 'farm-' web/src/lib/components/layout/Header.svelte` → zero results
- `grep 'DEVICE_FARM' web/src/lib/components/layout/Header.svelte` → found
- `grep 'h-16' web/src/lib/components/layout/Header.svelte` → found
- `grep 'backdrop-blur' web/src/lib/components/layout/Header.svelte` → found
- `grep 'DASHBOARD' web/src/lib/components/layout/Header.svelte` → found
- `grep 'handleLogout' web/src/lib/components/layout/Header.svelte` → found
- `grep -c 'breadcrumb' web/src/lib/components/layout/Header.svelte` → zero

## Inputs

- `web/src/lib/components/layout/Header.svelte` — Current 78-line file with breadcrumb logic, `bg-farm-sidebar` background, `h-12` height, logout handler
- T01 completed: layout now uses `pt-16` offset matching the new `h-16` navbar height
- S01 tokens available: `bg-background`, `text-primary`, `text-on-surface`, `text-on-surface-variant`, `bg-surface-container`, `border-outline-variant`, `border-primary`, `font-headline` — all usable as Tailwind utilities with no config changes

## Observability Impact

- **Visual signal:** The top navbar is always visible at `h-16` fixed position — brand "DEVICE_FARM" in purple, 4 uppercase nav links, search input, icon buttons. Any rendering issue is immediately obvious.
- **Active link detection:** Navigate between routes and verify the current nav link shows `text-primary border-b-2 border-primary` underline. Visit `/jobs/<id>` and confirm JOBS link highlights.
- **Auth-gated avatar:** When auth is enabled and user is authenticated, a person icon avatar appears in the right section. Clicking it triggers logout (redirect to `/login`).
- **Failure visibility:** If Kinetic Console tokens are missing or misconfigured, the navbar renders with broken/invisible colors — inspectable via DevTools computed styles. Missing `font-headline` would show fallback system font.
- **Diagnostic commands:** `grep 'DEVICE_FARM' Header.svelte` confirms brand; `grep 'farm-' Header.svelte` confirms zero legacy tokens; `grep 'handleLogout' Header.svelte` confirms logout wiring.

## Expected Output

- `web/src/lib/components/layout/Header.svelte` — Complete rewrite: ~80 lines, top navbar with brand, 4 nav links with active detection, search input, icon buttons, avatar/logout, all Kinetic Console tokens, zero `farm-*` references
