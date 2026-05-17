---
estimated_steps: 5
estimated_files: 2
---

# T01: Build Header component and update layout shell

**Slice:** S02 — Layout shell (top navbar + sidebar)
**Milestone:** M001

## Description

Create the dark navy top navbar (Header.svelte) matching the reference design and update the root layout to render it above the sidebar+content area. Migrate all `gh-*` references in the layout.

## Steps

1. Create Header.svelte with fixed top bar: bg-farm-sidebar (#1e293b), h-12, z-50
2. Left side: Material Symbol icon + "Mobile Device Farm" title + breadcrumb divider + route-aware breadcrumb
3. Right side: auth-aware user section (person icon + username + logout) + search icon
4. Update +layout.svelte: import Header, render above content, replace gh-canvas → farm-canvas, ensure main has top offset
5. Verify build passes and no gh-* remains in layout files

## Must-Haves

- [ ] Header renders with bg-farm-sidebar (#1e293b), h-12, fixed top-0
- [ ] Breadcrumbs update for each route (Dashboard, Build History, Runners, Manage, and job detail)
- [ ] User section with logout link when auth is enabled
- [ ] Layout has zero `gh-*` references
- [ ] No content overlap between header, sidebar, and main content area

## Verification

- `grep -c 'gh-' web/src/routes/+layout.svelte` returns 0
- `wc -l web/src/lib/components/layout/Header.svelte` shows >30 lines
- `npm run web:build` passes

## Inputs

- Reference HTML header structure
- S01: `farm-*` tokens in app.css
- Current `+layout.svelte` and `Nav.svelte` (sidebar already offset to top-12)
- `auth-store.svelte.ts` for auth state

## Expected Output

- `web/src/lib/components/layout/Header.svelte` — new top navbar component
- `web/src/routes/+layout.svelte` — updated layout with header, zero gh-* refs
