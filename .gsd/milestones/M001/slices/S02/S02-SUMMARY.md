---
id: S02
milestone: M001
provides:
  - Header.svelte — dark navy top bar with breadcrumbs, user section, search icon
  - Route-aware breadcrumbs (Dashboard, Build History, Runners, Manage, Job detail)
  - Nav.svelte — enhanced sidebar with real-time executor status and node health bar
  - Layout shell wrapping all authenticated pages with header + sidebar
  - Build queue section wired to real queue depth from /api/health
requires:
  - slice: S01
    provides: farm-* tokens in app.css, Material Symbols pattern
affects: [S03, S04, S05]
key_files:
  - web/src/lib/components/layout/Header.svelte
  - web/src/lib/components/layout/Nav.svelte
  - web/src/routes/+layout.svelte
key_decisions:
  - "Header fixed top-0 z-50, sidebar fixed top-12 z-40 — header always on top"
  - "Breadcrumbs derived from page.url.pathname with route label map"
  - "Sidebar polls /api/health every 5s, shows first 5 devices as executor slots"
  - "Health % = (idle+running+allocated) / total devices"
patterns_established:
  - "Route-aware breadcrumbs via routeLabels map + $derived.by in Header.svelte"
  - "Sidebar health polling pattern: onMount + setInterval + onDestroy cleanup"
drill_down_paths:
  - .gsd/milestones/M001/slices/S02/tasks/T01-PLAN.md
  - .gsd/milestones/M001/slices/S02/tasks/T02-PLAN.md
duration: 15min
verification_result: pass
completed_at: 2026-03-16T01:10:00Z
---

# S02: Layout shell (top navbar + sidebar)

**Dark navy top bar with route-aware breadcrumbs + sidebar enhanced with real-time executor status and node health bar from /api/health**

## What Happened

Created Header.svelte matching the reference: fixed top bar (#1e293b), "Mobile Device Farm" title with Material Symbol icon, route-aware breadcrumbs (handles job detail as "Build History » {id}"), auth-aware user section with logout. Updated +layout.svelte to render header above sidebar+content, replaced the single `gh-*` reference with `farm-canvas`. Enhanced Nav.svelte with real-time health data: "Build Executor Status" table showing device slots with state-colored labels (running devices link to their job), "Node Health" progress bar with percentage, and real queue depth. Sidebar polls `/api/health` every 5s with cleanup on destroy.

## Verification

- `grep -r 'gh-' web/src/lib/components/layout/ web/src/routes/+layout.svelte` → zero hits
- Header.svelte: 78 lines, Nav.svelte: 131 lines
- `npm run web:build` → passes clean

## Deviations

None.

## Files Created/Modified

- `web/src/lib/components/layout/Header.svelte` — new: dark navy top bar with breadcrumbs
- `web/src/routes/+layout.svelte` — header integrated, gh-* eliminated, layout adjusted for header height
- `web/src/lib/components/layout/Nav.svelte` — rewritten: executor status, health bar, real queue depth
