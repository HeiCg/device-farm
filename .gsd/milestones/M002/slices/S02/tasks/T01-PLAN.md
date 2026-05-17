---
estimated_steps: 4
estimated_files: 2
---

# T01: Rewrite layout scaffold and create mobile bottom nav

**Slice:** S02 — App Shell — Top Navbar, Sidebar, Mobile Nav, Layout
**Milestone:** M002

## Description

Rewrite `+layout.svelte` to establish the new Kinetic Console shell dimensions and create the `MobileNav.svelte` component. This is the foundation task — T02 (Header) and T03 (Nav) render inside this scaffold, so it must land first.

The layout currently uses `bg-farm-canvas`, `ml-60`, and `pt-12`. It needs `bg-background`, `md:pl-64`, `pt-16`, and `pb-20 md:pb-0` for the new navbar height (h-16), wider sidebar (w-64), and mobile bottom nav clearance. The auth gating logic (`authChecked`, `onLoginPage`, `showDashboard`) must be preserved exactly — login page renders children directly without the shell.

MobileNav is a new component: fixed bottom bar, `md:hidden`, 4 nav items with Material Symbols icons, active state detection via `page.url.pathname`.

**Relevant skill:** `frontend-design` — load for Svelte 5 / Tailwind v4 component patterns.

## Steps

1. **Create `MobileNav.svelte`** at `web/src/lib/components/layout/MobileNav.svelte`:
   - Import `page` from `$app/state`
   - Define nav items array: `[{ href: '/', label: 'Dashboard', icon: 'dashboard' }, { href: '/jobs', label: 'Jobs', icon: 'terminal' }, { href: '/devices', label: 'Devices', icon: 'developer_board' }, { href: '/settings', label: 'Settings', icon: 'tune' }]`
   - Create `isActive(href, pathname)` function: for `/` use strict equality, for others use `pathname.startsWith(href)`
   - Render fixed bottom bar: `fixed bottom-0 left-0 w-full h-16 z-50 md:hidden bg-background/95 backdrop-blur-xl border-t border-primary/15`
   - Inside: `flex justify-around items-center h-full` container
   - Each nav item: `<a>` with column flex layout (`flex flex-col items-center gap-1`), Material Symbols icon + `text-[10px] font-label` label
   - Active state: full static class strings — active items get `text-primary font-bold`, inactive get `text-on-surface-variant`
   - No dynamic class construction (Tailwind v4 JIT rule — see KNOWLEDGE.md)

2. **Rewrite `+layout.svelte`**:
   - Add import: `import MobileNav from '$lib/components/layout/MobileNav.svelte';`
   - Keep ALL existing imports (Header, Nav, auth stores, page, onMount) and ALL script logic unchanged
   - In the `showDashboard` branch, change the outer div:
     - `bg-farm-canvas` → `bg-background`
     - Remove the `flex flex-1 pt-12` wrapper div — restructure to place Header and Nav as direct children
   - New structure (showDashboard branch):
     ```html
     <div class="min-h-screen bg-background">
       <Header />
       <Nav />
       <main class="md:pl-64 pt-16 pb-20 md:pb-0 min-h-screen">
         <div class="max-w-6xl mx-auto p-6">
           {@render children()}
         </div>
       </main>
       <MobileNav />
     </div>
     ```
   - Key offset details: `md:pl-64` (sidebar width, only on desktop), `pt-16` (navbar height h-16 = 4rem), `pb-20` (mobile bottom nav clearance, `md:pb-0` removes on desktop)
   - Preserve auth branches exactly: `!authChecked` → empty, `onLoginPage` → bare children, `showDashboard` → full shell

3. **Verify build**: Run `npm run web:build` and confirm exit code 0.

4. **Verify token migration**: Run `grep -rn 'farm-' web/src/routes/+layout.svelte` and confirm zero results.

## Must-Haves

- [ ] `+layout.svelte` uses `bg-background` instead of `bg-farm-canvas`
- [ ] Content area uses `md:pl-64 pt-16 pb-20 md:pb-0` offsets
- [ ] `MobileNav.svelte` exists with `md:hidden` visibility
- [ ] MobileNav has exactly 4 items: Dashboard, Jobs, Devices, Settings (R028)
- [ ] MobileNav uses `page.url.pathname` for active state detection
- [ ] MobileNav uses `text-primary` for active items (not `farm-*` tokens)
- [ ] Auth gating logic (`authChecked`, `onLoginPage`, `showDashboard`) preserved exactly
- [ ] Login page renders children without shell (no Header/Nav/MobileNav)
- [ ] All nav item class names are full static strings (Tailwind v4 JIT rule)
- [ ] `npm run web:build` exits 0

## Verification

- `npm run web:build` exits 0
- `grep -rn 'farm-' web/src/routes/+layout.svelte` → zero results
- `grep 'MobileNav' web/src/routes/+layout.svelte` → found
- `grep 'md:pl-64' web/src/routes/+layout.svelte` → found
- `grep 'pb-20' web/src/routes/+layout.svelte` → found
- `grep 'md:hidden' web/src/lib/components/layout/MobileNav.svelte` → found
- `grep 'text-primary' web/src/lib/components/layout/MobileNav.svelte` → found
- `grep -c 'Dashboard\|Jobs\|Devices\|Settings' web/src/lib/components/layout/MobileNav.svelte` → 4

## Observability Impact

- **Layout offsets visible in DevTools:** Inspect `<main>` element for `md:pl-64 pt-16 pb-20 md:pb-0` classes — confirms correct spacing for Header (h-16), Nav (w-64), and MobileNav (h-16) clearance.
- **MobileNav visibility:** Resize browser below `md` breakpoint (768px) → MobileNav appears fixed at bottom; above `md` → hidden. Use DevTools responsive mode to toggle.
- **Active state detection:** Navigate between routes and inspect MobileNav links — active item should have `text-primary` class, inactive should have `text-on-surface-variant`.
- **Auth gating preserved:** Visit `/login` path → no shell chrome (Header/Nav/MobileNav absent). Visit `/` while authenticated → full shell renders.
- **Failure state:** If MobileNav doesn't render, check that `MobileNav` import is present in `+layout.svelte` and component is placed inside the `showDashboard` branch.

## Inputs

- `web/src/routes/+layout.svelte` — Current 46-line layout with `bg-farm-canvas`, `ml-60 pt-12` offsets, auth gating via `authChecked`/`onLoginPage`/`showDashboard`
- `web/src/app.css` — S01 delivered 51 Kinetic Console color tokens including `background` (#0e0e0e), `primary` (#c39bff), `on-surface-variant`, `font-headline`/`font-body`/`font-label`
- S01 Forward Intelligence: All 51 tokens are live as Tailwind utilities (`bg-background`, `text-primary`, `border-primary/15`). No import or config changes needed.

## Expected Output

- `web/src/lib/components/layout/MobileNav.svelte` — New file: ~40-line fixed bottom nav with 4 items, Material Symbols icons, active state detection, dark theme tokens
- `web/src/routes/+layout.svelte` — Modified: new offsets, `bg-background`, MobileNav imported and placed after main, auth gating preserved
