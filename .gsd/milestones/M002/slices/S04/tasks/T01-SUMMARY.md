---
id: T01
parent: S04
milestone: M002
provides:
  - Dark status-bordered JobCard component with responsive card grid layout
  - Inline segmented-control filter tabs replacing select dropdowns on Build History
key_files:
  - web/src/lib/components/jobs/JobCard.svelte
  - web/src/routes/jobs/+page.svelte
key_decisions:
  - Used $derived instead of {@const} for borderStyles lookup — Svelte 5 restricts {@const} to block contexts only
patterns_established:
  - Segmented-control tab pattern with if/else blocks for active/inactive styling (D016-safe)
  - Platform toggle with deselect behavior (clicking active tab clears filter)
observability_surfaces:
  - Filter state visible via bg-surface-container-high class on active tab button
  - Grid layout inspectable via DevTools — grid-cols-1/md:grid-cols-2/lg:grid-cols-3
duration: 12m
verification_result: passed
completed_at: 2026-03-18
blocker_discovered: false
---

# T01: Rewrite JobCard as dark status-bordered card and transform Build History into card grid with inline filter tabs

**Rewrote Build History from flat list to responsive 3-column card grid with dark status-bordered JobCards and inline segmented-control filter tabs replacing select dropdowns**

## What Happened

Rewrote `JobCard.svelte` from a flex-row `<a>` element to a card layout with `bg-surface-container-low`, `rounded-lg`, `border-l-2` status-colored left border, and three-row internal layout (StatusBadge + job ID, platform + duration, right-aligned timestamp). Added `borderStyles` Record with full static class strings (D016 compliance) using `$derived` for reactive lookup.

Rewrote `+page.svelte` header to use `font-headline text-on-surface` title with `text-on-surface-variant` subtitle. Replaced the `Filters` component import with two inline segmented-control tab groups: status tabs (All Runs / Success / Failures) and platform toggle (All / Android / iOS) with deselect behavior. Replaced the list wrapper with `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4`. Updated loading skeleton (6 card-shaped shimmer blocks in grid), empty state (dark card with dimmed icon), and error state (tertiary-tinted banner). All script logic (loadJobs, handleFilterChange, handleLoadMore, cursor pagination) preserved exactly.

## Verification

- `npm run web:build` exits 0
- Zero `farm-*` tokens in both files (grep returns exit 1 = no matches)
- Grid responsive classes present in +page.svelte
- border-l-2 present in JobCard.svelte
- font-headline present in +page.svelte header
- Filters import fully removed
- Pagination still imported and rendered
- borderStyles Record present with D016-safe static strings
- No RUN_NEW_JOB or BUILD_NOW buttons (R027)

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npm run web:build` | 0 | ✅ pass | 4.0s |
| 2 | `grep -rn 'farm-' web/src/routes/jobs/+page.svelte web/src/lib/components/jobs/JobCard.svelte` | 1 (no match) | ✅ pass | <1s |
| 3 | `grep -n 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3' web/src/routes/jobs/+page.svelte` | 0 | ✅ pass | <1s |
| 4 | `grep -n 'border-l-2' web/src/lib/components/jobs/JobCard.svelte` | 0 | ✅ pass | <1s |
| 5 | `grep -n 'font-headline' web/src/routes/jobs/+page.svelte` | 0 | ✅ pass | <1s |
| 6 | `grep -n 'Filters' web/src/routes/jobs/+page.svelte` | 1 (no match) | ✅ pass | <1s |
| 7 | `grep -n 'Pagination' web/src/routes/jobs/+page.svelte` | 0 | ✅ pass | <1s |
| 8 | `grep -n 'borderStyles' web/src/lib/components/jobs/JobCard.svelte` | 0 | ✅ pass | <1s |

### Slice-level checks (partial — T01 is 1 of 3 tasks)

| # | Check | Verdict | Notes |
|---|-------|---------|-------|
| 1 | `npm run web:build` exits 0 | ✅ pass | |
| 2 | Zero `farm-` in T01 files | ✅ pass | Remaining `farm-` hits in T02/T03 files (expected) |
| 3 | Zero M001 holdover colors in T01 files | ✅ pass | Remaining hits in T02/T03 files |
| 4 | Grid responsive classes | ✅ pass | |
| 5 | border-l-2 in JobCard | ✅ pass | |
| 6 | font-headline in +page.svelte | ✅ pass | Job Detail check pending T02 |
| 7 | bg-surface-container-low in JobCard | ✅ pass | StepList check pending T03 |
| 8 | Zero Filters import | ✅ pass | |
| 9 | No R026 mock labels | ⏳ pending | MetricsPanel in T03 |
| 10 | No border-farm-border | ⏳ pending | T02/T03 files still have them |

## Diagnostics

- **Filter state inspection:** Active tab has `bg-surface-container-high text-on-surface` class; inactive tabs have `text-on-surface-variant`. Toggle platform buttons to verify deselect behavior.
- **Grid layout:** Inspect `.grid` container in DevTools — verify responsive breakpoints at 768px (2 cols) and 1024px (3 cols).
- **Status borders:** Each JobCard `<a>` has `border-l-2` with status-colored class (border-secondary for passed, border-tertiary for failed/error/timeout, border-primary for running, border-outline for queued/cancelled).
- **Loading state:** Force loading by throttling network — 6 shimmer cards appear in grid layout.

## Deviations

- Used `$derived` instead of `{@const}` for the borderStyles lookup — Svelte 5 restricts `{@const}` to block contexts ({#if}, {#each}, etc.), not top-level template. The `$derived` reactive pattern achieves the same D016-safe result.

## Known Issues

None.

## Files Created/Modified

- `web/src/lib/components/jobs/JobCard.svelte` — Rewrote from flex-row to dark card with border-l-2 status border, StatusBadge + job ID + platform/duration/timestamp layout
- `web/src/routes/jobs/+page.svelte` — Replaced Filters dropdown with inline tab buttons, list with responsive card grid, updated all states to Kinetic Console tokens
- `.gsd/milestones/M002/slices/S04/tasks/T01-PLAN.md` — Added Observability Impact section (pre-flight fix)
