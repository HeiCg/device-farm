---
estimated_steps: 5
estimated_files: 2
---

# T01: Rewrite JobCard as dark status-bordered card and transform Build History into card grid with inline filter tabs

**Slice:** S04 — Jobs — Build History Cards + Job Detail
**Milestone:** M002

## Description

The Build History page currently renders jobs as a flat list of flex-row `<a>` elements with `<select>`-based dropdown filters. This task rewrites both the JobCard component and the Build History page to use a responsive 3-column card grid with status-colored left borders and inline segmented-control tab buttons for filtering.

This is the highest-risk structural change in S04 — it changes the layout model (list→grid), replaces the filter UX (dropdown→tabs), and touches the most user-visible page. All script logic (loadJobs, handleFilterChange, handleLoadMore, cursor pagination) stays intact — only the template and styling change.

**Relevant skill:** `frontend-design` — load if you need design pattern guidance for dark card layouts.

## Steps

1. **Rewrite `JobCard.svelte`** — Replace the single flex-row `<a>` with a card layout:
   - Outer `<a>` wrapper: `block bg-surface-container-low rounded-lg border-l-2 p-4 hover:bg-surface-container transition-colors` plus a status-colored border class from a local `borderStyles` Record lookup
   - Add a local `borderStyles` const at the top of the script (D016 — full static strings, never template interpolation):
     ```typescript
     const borderStyles: Record<string, string> = {
       passed: 'border-secondary',
       failed: 'border-tertiary',
       running: 'border-primary',
       queued: 'border-outline',
       cancelled: 'border-outline',
       timeout: 'border-tertiary',
       error: 'border-tertiary',
     };
     ```
   - Top row: `StatusBadge` (already imported) + job ID `{job.id.slice(0, 8)}` in `font-mono text-sm text-on-surface`
   - Middle: platform label in `text-on-surface-variant text-xs` with smartphone icon + duration with schedule icon
   - Bottom row: relative timestamp in `text-on-surface-variant text-xs` right-aligned
   - Use `borderStyles[job.status] ?? 'border-outline'` for the border class — applied in template via `{@const borderClass = borderStyles[job.status] ?? 'border-outline'}` pattern (D016-safe, proven in S03)
   - Remove all 4 `farm-*` token references

2. **Rewrite `+page.svelte` header section** — Replace `border-b border-farm-border` header with:
   - Title: `text-xl font-headline text-on-surface` "Build History"
   - Subtitle: `text-sm text-on-surface-variant` "Recent test executions"
   - Remove the `Filters` import entirely

3. **Add inline filter tabs** — Below the header, add two segmented control groups:
   - **Status tabs** (ALL_RUNS / SUCCESS / FAILURES): three buttons in a `flex gap-1 bg-surface-container rounded-lg p-1` container. Active button: `bg-surface-container-high text-on-surface` with `rounded-md px-3 py-1.5 text-xs font-medium`. Inactive: `text-on-surface-variant hover:text-on-surface`. Use if/else blocks for active/inactive styling.
   - **Platform toggle** (ANDROID / IOS): same pattern but with toggle behavior (clicking active deselects → clears platform filter). Add ALL as first option to show both platforms.
   - Wire button clicks to existing `handleFilterChange` function: status tabs call `handleFilterChange({ status: 'passed'|'failed'|'', platform: platformFilter })`, platform buttons call `handleFilterChange({ status: statusFilter, platform: 'android'|'ios'|'' })`.

4. **Replace list wrapper with card grid** — Change `<div class="rounded-md border border-farm-border overflow-hidden">` wrapping the `{#each}` to `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">`. Keep the `{#each jobs as job (job.id)}` loop with `<JobCard {job} />` inside.

5. **Update loading skeleton, empty state, and error state** with Kinetic Console tokens:
   - **Loading skeleton**: 6 card-shaped shimmer blocks in the same grid layout. Each: `bg-surface-container-low rounded-lg p-4 animate-pulse` with internal `bg-surface-container` placeholder bars
   - **Empty state**: `bg-surface-container-low rounded-lg` with `text-on-surface-variant` text, `text-primary/40` icon
   - **Error state**: `bg-tertiary/10 border border-tertiary/20 rounded-lg px-4 py-3 text-tertiary text-sm`
   - Keep `Pagination` import and `<Pagination {hasMore} loading={loadingMore} onloadmore={handleLoadMore} />` exactly as-is (already S01-reskinned)

## Must-Haves

- [ ] Zero `farm-*` tokens in `JobCard.svelte` and `+page.svelte`
- [ ] `borderStyles` uses full static class strings (D016 compliance)
- [ ] Card grid renders responsively: 1 col mobile, 2 col tablet, 3 col desktop
- [ ] Filter tabs replace `<select>` Filters component — no `Filters` import
- [ ] All script logic preserved exactly (loadJobs, handleFilterChange, handleLoadMore, cursor pagination)
- [ ] `Pagination` component still imported and rendered
- [ ] No RUN_NEW_JOB or BUILD_NOW button anywhere (R027)
- [ ] `npm run web:build` exits 0

## Verification

- `npm run web:build` exits 0
- `grep -rn 'farm-' web/src/routes/jobs/+page.svelte web/src/lib/components/jobs/JobCard.svelte` returns 0 matches
- `grep -n 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3' web/src/routes/jobs/+page.svelte` returns a match
- `grep -n 'border-l-2' web/src/lib/components/jobs/JobCard.svelte` returns a match
- `grep -n 'font-headline' web/src/routes/jobs/+page.svelte` returns a match
- `grep -n 'Filters' web/src/routes/jobs/+page.svelte` returns 0 matches (import removed)
- `grep -n 'Pagination' web/src/routes/jobs/+page.svelte` returns a match (still imported)
- `grep -n 'borderStyles' web/src/lib/components/jobs/JobCard.svelte` returns a match

## Inputs

- `web/src/lib/components/jobs/JobCard.svelte` — Current flex-row card with 4 `farm-*` tokens. Props: `{ job: Job }`. Imports: `StatusBadge`, `formatRelativeTime`, `formatDuration`, `platformLabel`.
- `web/src/routes/jobs/+page.svelte` — Current list page with 15 `farm-*` tokens. Script has: `loadJobs()`, `handleFilterChange()`, `handleLoadMore()`, state vars for `jobs`, `statusFilter`, `platformFilter`, `nextCursor`, `hasMore`, `loading`, `loadingMore`, `error`. Currently imports `Filters` and `Pagination`.
- `web/src/lib/utils/format.ts` — `statusStyle()` already returns Kinetic Console tokens. `formatRelativeTime()`, `formatDuration()`, `platformLabel()` available. Import path: `$lib/utils/format.js`.
- S01 shared components: `StatusBadge` at `$lib/components/shared/StatusBadge.svelte` (already reskinned), `Pagination` at `$lib/components/shared/Pagination.svelte` (already reskinned).
- `app.css` has 51 `@theme` tokens including all surface-container tiers, primary/secondary/tertiary, outline/outline-variant.
- **D016 pattern**: Use full static class strings in Record lookups. In templates, use `{@const borderClass = borderStyles[job.status] ?? 'border-outline'}` then reference `{borderClass}` in class attribute. Never use `border-${color}`.

## Observability Impact

- **Signals changed:** `/api/jobs` GET requests still visible in Network tab; no API surface changes. Filter state now encoded in button active classes instead of `<select>` value — inspect `bg-surface-container-high` class on active tab to verify filter state.
- **Inspection surface:** DevTools element inspector on `.grid` container to verify responsive columns (`grid-cols-1` → `md:grid-cols-2` → `lg:grid-cols-3`). Each `JobCard` `<a>` has `border-l-2` with status-colored class (`border-secondary`, `border-tertiary`, `border-primary`, `border-outline`).
- **Failure visibility:** Error state renders a `bg-tertiary/10 border-tertiary/20 text-tertiary` banner. Empty state shows `text-on-surface-variant` message with dimmed icon. Loading shows 6 shimmer cards in the grid.
- **What a future agent inspects:** `grep -n 'farm-'` on both files to confirm zero legacy tokens; `grep -n 'grid-cols-1'` to confirm grid layout; browser viewport resize to verify responsive breakpoints.

## Expected Output

- `web/src/lib/components/jobs/JobCard.svelte` — Dark card with `bg-surface-container-low`, `border-l-2` status border, StatusBadge + job ID + platform/duration/timestamp. Zero `farm-*` tokens.
- `web/src/routes/jobs/+page.svelte` — Card grid layout with inline filter tabs, responsive grid, dark loading/empty/error states, Pagination preserved. Zero `farm-*` tokens, no Filters import.
