---
estimated_steps: 6
estimated_files: 4
---

# T02: Convert shared components to Material Symbols + farm tokens

**Slice:** S01 — Design tokens + base components
**Milestone:** M001

## Description

Replace all Lucide icon imports and `gh-*` class references in StatusBadge, Pagination, Filters, and FlakeyBadge with Material Symbols Outlined and `farm-*` tokens. StatusBadge gets the Jenkins status ball pattern (colored circles).

## Steps

1. StatusBadge: remove Lucide imports, replace with `<div class="status-ball bg-farm-{status}">` pattern. Map each status to a ball color + optional animation for running state.
2. Pagination: replace Lucide `Loader2` with Material Symbols `progress_activity`. Replace `gh-*` → `farm-*`.
3. Filters: replace all `gh-*` → `farm-*` in select element styling.
4. FlakeyBadge: replace Lucide `AlertTriangle` with Material Symbols `warning`. Replace `gh-*` → `farm-*`.
5. Verify zero Lucide imports remain in these files
6. Verify zero `gh-*` references remain in these files

## Must-Haves

- [ ] StatusBadge uses `<div class="status-ball">` with colored backgrounds, not Lucide SVGs
- [ ] Running status has visual pulse/spin animation
- [ ] Pagination loading spinner uses Material Symbols
- [ ] FlakeyBadge warning icon uses Material Symbols
- [ ] Zero `lucide-svelte` imports in any of the 4 files
- [ ] Zero `gh-*` classes in any of the 4 files

## Verification

- `grep -r 'lucide-svelte' web/src/lib/components/shared/ web/src/lib/components/FlakeyBadge.svelte` returns nothing
- `grep -r 'gh-' web/src/lib/components/shared/ web/src/lib/components/FlakeyBadge.svelte` returns nothing

## Inputs

- T01 output: `app.css` with aligned `farm-*` tokens
- Current component files (StatusBadge, Pagination, Filters, FlakeyBadge)

## Expected Output

- `web/src/lib/components/shared/StatusBadge.svelte` — status balls with `farm-*` colors
- `web/src/lib/components/shared/Pagination.svelte` — Material Symbols spinner, `farm-*` tokens
- `web/src/lib/components/shared/Filters.svelte` — `farm-*` tokens
- `web/src/lib/components/FlakeyBadge.svelte` — Material Symbols warning, `farm-*` tokens
