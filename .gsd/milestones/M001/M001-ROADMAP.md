# M001: Jenkins Design System Reskin

**Vision:** Extract the Jenkins-utilitarian design system from the reference HTML and apply it uniformly across every page of the Device Farm web UI — tokens, icons, component patterns, layout shell, and page content.

## Success Criteria

- Every page visually matches the reference's Jenkins-utilitarian aesthetic
- Zero `gh-*` class references remain in the codebase
- Zero Lucide imports remain; `lucide-svelte` removed from dependencies
- Material Symbols Outlined used for all icons
- All pages functional with real API data — no regressions
- `npm run web:build` passes cleanly

## Key Risks / Unknowns

- Large token migration surface (16 files, ~220 `gh-*` references) — risk of missing references causing unstyled elements
- Dashboard restructuring requires mapping reference mock data patterns to real API data shapes

## Proof Strategy

- Token migration completeness → retire in S01 by proving `grep -r 'gh-' web/src/` returns zero hits after shared component conversion
- Dashboard data mapping → retire in S03 by proving health widget, device table, and alerts render with real API data

## Verification Classes

- Contract verification: `grep` for dead references, `npm run web:build`, import analysis
- Integration verification: pages load and render real API data correctly
- Operational verification: none
- UAT / human verification: visual comparison against reference screenshot

## Milestone Definition of Done

This milestone is complete only when all are true:

- All 5 slice deliverables are complete
- Every route renders in the Jenkins aesthetic with `farm-*` tokens
- `grep -r 'gh-' web/src/` returns zero results
- `grep -r 'lucide-svelte' web/src/` returns zero results
- `npm run web:build` succeeds
- Dashboard shows real device/job data in reference layout patterns

## Requirement Coverage

- Covers: R001, R002, R003, R004, R005, R006, R007, R008, R009, R010, R011
- Partially covers: none
- Leaves for later: none
- Orphan risks: none

## Slices

- [x] **S01: Design tokens + base components** `risk:high` `depends:[]`
  > After this: All `farm-*` tokens match reference palette, `gh-*` eliminated from shared components. StatusBadge uses status balls, new AlertBanner and WeatherIcon components exist. Material Symbols used in all shared components.

- [x] **S02: Layout shell (top navbar + sidebar)** `risk:medium` `depends:[S01]`
  > After this: Dark navy top bar with app title, breadcrumbs, and user section renders on every page. Sidebar has build queue, executor status, and health bar sections wired to API data.

- [x] **S03: Dashboard reskin** `risk:medium` `depends:[S01,S02]`
  > After this: Dashboard shows infrastructure health widget with weather metaphor, alert banners, device cluster table with status balls + weather, and quick action cards — all wired to real API data.

- [x] **S04: Jobs pages reskin** `risk:low` `depends:[S01,S02]`
  > After this: Jobs list uses Jenkins table with status balls. Job detail uses Jenkins breadcrumbs, tabs, and Material Symbols. All job sub-components (LogViewer, StepList, MetricsPanel) use `farm-*` tokens.

- [x] **S05: Devices, Settings, Login + final cleanup** `risk:low` `depends:[S01,S02]`
  > After this: Devices page uses Jenkins table with status balls/weather. Settings uses Jenkins section cards. Login uses farm tokens. `lucide-svelte` removed from `package.json`. Zero `gh-*` or Lucide references remain.

## Boundary Map

### S01 → S02

Produces:
- `app.css` → Complete `farm-*` token set aligned with reference palette (colors, borders, backgrounds)
- `StatusBadge.svelte` → Status ball component using `<div class="status-ball">` pattern
- `WeatherIcon.svelte` → New component: weather metaphor icon (sunny/cloudy/rainy) based on health percentage
- `AlertBanner.svelte` → New component: colored left-border alert (critical/warning/info variants)
- Jenkins table CSS classes → `.jenkins-table th/td` styles in `app.css`

Consumes:
- nothing (first slice)

### S01 → S03

Produces:
- All base components above
- `farm-*` token values for metric cards, section headers, quick action cards

Consumes:
- nothing (first slice)

### S01 → S04

Produces:
- `StatusBadge.svelte` → status ball pattern
- `farm-*` tokens for tables, borders, text colors
- `FlakeyBadge.svelte` → converted to Material Symbols + farm tokens
- `Filters.svelte`, `Pagination.svelte` → converted to farm tokens + Material Symbols

Consumes:
- nothing (first slice)

### S01 → S05

Produces:
- All tokens and shared components

Consumes:
- nothing (first slice)

### S02 → S03

Produces:
- `Header.svelte` → Top navbar component with breadcrumb slot/prop
- `Nav.svelte` → Enhanced sidebar with executor status + health bar
- `+layout.svelte` → Shell layout wrapping content with header + sidebar

Consumes from S01:
- `farm-*` tokens for sidebar/header colors

### S02 → S04

Produces:
- Layout shell (header breadcrumbs auto-update per route)

Consumes from S01:
- `farm-*` tokens

### S02 → S05

Produces:
- Layout shell

Consumes from S01:
- `farm-*` tokens
