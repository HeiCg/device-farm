# S04: Jobs — Build History Cards + Job Detail — Research

**Date:** 2026-03-18
**Depth:** Targeted — known patterns from S01/S02/S03, moderate structural change (list→card grid), clear reference designs

## Summary

S04 reskins 6 files across two pages (Build History, Job Detail) and three subcomponents (JobCard, StepList, MetricsPanel). The current code has 62 `farm-*` token occurrences split across these files. LogViewer already uses dark hardcoded hex colors and needs only minor alignment. All shared components this slice uses (StatusBadge, FlakeyBadge, Filters, Pagination) were already reskinned in S01 with Kinetic Console tokens.

The biggest structural change is Build History: transforming from a flat list (`<div>` wrapping `<JobCard>` rows) to a responsive 3-column card grid with status-colored left borders. The reference also replaces the `<select>` dropdown filters with segmented-control tab buttons (ALL_RUNS / SUCCESS / FAILURES + ANDROID / IOS toggle). The Job Detail page is a token-replacement reskin with no structural layout change — it already has the correct sidebar + log viewer grid from M001.

`statusStyle()` in `format.ts` was already updated by S01 to return Kinetic Console tokens. The `border-{color}` mapping for card left borders needs a new helper — a static lookup map returning complete border class strings per status (D016 pattern: no dynamic interpolation).

## Recommendation

Three tasks in dependency order:

1. **JobCard + Build History page** — Rewrite JobCard from list-row `<a>` to card component, rewrite `+page.svelte` with card grid layout and inline filter tabs replacing the `<select>`-based Filters component. This is the riskiest task (structural layout change + filter UX change) and should go first.
2. **Job Detail page** — Replace all 13 `farm-*` tokens in `[id]/+page.svelte` header, tabs, loading/error states. Pure token substitution with minor styling improvements (ghost borders, font-headline on header). No layout restructuring needed.
3. **StepList + MetricsPanel + LogViewer reskin** — Reskin the three subcomponents used by Job Detail. StepList becomes a dark cluster with left-border status cards. MetricsPanel gets dark tonal bars with glow. LogViewer gets minor token alignment and macOS-style terminal dots header.

## Implementation Landscape

### Key Files

- **`web/src/routes/jobs/+page.svelte`** — Build History page. 15 `farm-*` tokens. Currently renders a bordered list of JobCard rows with Filters + Pagination. Must become: card grid (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4`), inline filter tabs instead of Filters component, page header with `font-headline` title + subtitle. Script logic (loadJobs, handleFilterChange, handleLoadMore, cursor pagination) stays intact. The Filters import can be removed — filter tabs are inlined.
- **`web/src/lib/components/jobs/JobCard.svelte`** — 4 `farm-*` tokens. Currently a single `<a>` flex row. Must become a card: `bg-surface-container-low border-l-2 border-{status}` with StatusBadge, job ID (mono), test name (font-headline), device+duration row, timestamp+link footer. Needs `statusStyle()` import for border-color lookup. The card links to `/jobs/{job.id}` like the current row.
- **`web/src/routes/jobs/[id]/+page.svelte`** — Job Detail page. 13 `farm-*` tokens. Header, tabs, loading/error states all need token replacement. Header: StatusBadge + job ID in `font-headline` + metadata row with `text-primary` icons. Tabs: `border-primary` active state with `text-primary`, inactive `text-on-surface-variant`. Error state: `bg-tertiary/10 border-tertiary/20 text-tertiary`. The sidebar + LogViewer grid layout (`grid-cols-1 xl:grid-cols-[320px_1fr]`) is already correct and stays.
- **`web/src/lib/components/jobs/StepList.svelte`** — 17 `farm-*` tokens — the most of any file. Complete reskin. Summary header: `bg-surface-container-high` with `text-secondary` passed / `text-tertiary` failed / `text-primary` running counters. Step rows: dark background, left-border colored by status, icon in colored background circle. Import path for FlakeyBadge: `$lib/components/FlakeyBadge.svelte` (note: not in `shared/`).
- **`web/src/lib/components/jobs/MetricsPanel.svelte`** — 13 `farm-*` tokens. Three memory bars (Total PSS, Native Heap, Java Heap). Replace `bg-slate-200` bar tracks with `bg-surface-variant`. Replace `bg-farm-accent`/`bg-purple-500`/`bg-farm-success` fills with `bg-primary`/`bg-primary-dim`/`bg-secondary` plus glow shadows. Container: `bg-surface-container-low` with left border. Per R026: only show real API data (PSS, native heap, java heap from MetricsData) — no CPU Load or RAM Usage labels.
- **`web/src/lib/components/jobs/LogViewer.svelte`** — 0 `farm-*` tokens. Already dark with hardcoded hex. Minor changes: replace `border-[#30363d]` → `border-outline-variant/20`, `bg-[#161b22]` → `bg-surface-container-high`, add macOS-style colored dots to header (tertiary/primary/secondary circles). The `bg-[#0d1117]` terminal background can stay per R020 ("keeps existing dark theme") or shift to `bg-surface-container-lowest` (#000000) — both are near-black. Add optional syntax-colored log levels if time permits (regex [INFO]→text-secondary, [ERROR]→text-tertiary, [DEBUG]→text-primary).

### Supporting Files (no changes needed)

- **`web/src/lib/utils/format.ts`** — `statusStyle()` already returns Kinetic Console tokens (`text-secondary`/`bg-secondary` for passed, `text-tertiary`/`bg-tertiary` for failed, etc.). Used by JobCard for border color mapping.
- **`web/src/lib/api/jobs.ts`** — API client. No changes.
- **`web/src/lib/api/types.ts`** — Type definitions. No changes.
- **`web/src/lib/ws/job-stream.svelte.ts`** — WebSocket stream. No changes.
- **`web/src/lib/components/shared/StatusBadge.svelte`** — Already S01-reskinned pill badges. No changes.
- **`web/src/lib/components/FlakeyBadge.svelte`** — Already S01-reskinned. No changes.
- **`web/src/lib/components/shared/Pagination.svelte`** — Already S01-reskinned load-more button. No changes.
- **`web/src/lib/components/shared/Filters.svelte`** — Already S01-reskinned, but the Build History page will stop using it (replaced by inline filter tabs per reference design). The component itself stays untouched — it may be used elsewhere in the future.

### Build Order

**Task 1: JobCard + Build History page.** This is the riskiest piece — the list→card structural change plus replacing `<select>` filters with tab buttons. Build this first because:
- It's the highest-risk layout change (card grid responsive behavior)
- Verifiable immediately: load `/jobs`, see card grid with correct borders, test filter tabs, test load-more
- Unblocks visual integration checking of the entire page

**Task 2: Job Detail page.** Pure token substitution in `[id]/+page.svelte`. Lower risk because the layout structure (sidebar + main content grid) is already correct. Depends on Task 1 existing (to navigate from cards to detail) but not on its specific implementation.

**Task 3: StepList + MetricsPanel + LogViewer.** Three subcomponents, all independent. Can be done together because:
- They're only rendered inside Job Detail (already reskinned in T2)
- No cross-dependencies between the three
- Verification: open any job detail and confirm steps cluster, metrics bars, and terminal viewer all render with dark tokens

### Border Color Mapping for JobCard

The JobCard needs a status→border-class lookup. Following D016 (full static strings), add to `format.ts` or inline in JobCard:

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

`statusStyle()` already has a `bg` field with the right color. But border classes need the raw color name without `bg-` prefix. Easiest to add a `border` field to `statusStyle()` return type, or use a local map in JobCard. Local map is simpler and avoids changing the shared utility.

### Filter Tabs Pattern

The reference design shows two segmented controls:
1. Status: `ALL_RUNS | SUCCESS | FAILURES` — maps to `statusFilter = '' | 'passed' | 'failed'`
2. Platform: `ANDROID | IOS` — maps to `platformFilter = '' | 'android' | 'ios'` (toggle, not exclusive — clicking active deselects)

Implementation: inline in `+page.svelte` using button groups with `bg-surface-container` background, `border-outline-variant/20` border, active state `bg-surface-container-high text-primary`. The existing `handleFilterChange` logic stays — just called from button clicks instead of `<select>` changes.

### Verification Approach

**Build check:**
```bash
npm run web:build  # must exit 0
```

**Token elimination:**
```bash
grep -rn 'farm-' web/src/routes/jobs/ web/src/lib/components/jobs/
# must return 0 lines
```

**Structural checks (grep):**
- `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` in `+page.svelte` (card grid)
- `border-l-2` in `JobCard.svelte` (status left border)
- `font-headline` in both pages (headline font usage)
- `bg-surface-container-low` in JobCard and StepList (dark card backgrounds)
- `bg-surface-variant` in MetricsPanel (bar track background)
- Zero occurrences of `bg-red-50`, `bg-slate-200`, `bg-purple-500` (M001 holdover colors)
- Zero occurrences of `Filters` import in `+page.svelte` (replaced by inline tabs)

**R026 compliance:**
```bash
grep -i 'cpu\|ram usage\|network profiler\|memory heap\|leak detection' web/src/routes/jobs/[id]/+page.svelte web/src/lib/components/jobs/MetricsPanel.svelte
# must return 0 lines
```

**No-Line Rule (R024):**
```bash
grep -n 'border-b border-farm\|border border-farm\|border-t border-farm' web/src/routes/jobs/ web/src/lib/components/jobs/
# must return 0 lines (all borders should use ghost borders or outline-variant)
```

## Constraints

- **D016 — Full static class strings:** All status-to-class mappings must use complete string literals in lookup objects. Never `border-${color}`. Critical for border-left colors on JobCard.
- **Tailwind v4 `@theme` tokens:** All new classes must reference tokens defined in `app.css` `@theme` block. The 51 tokens from S01 are the source of truth.
- **R024 — No-Line Rule:** No `1px solid` sectioning borders. Use `border-outline-variant/10` ghost borders or tonal surface shifts for visual separation.
- **R026 — No mock data:** MetricsPanel shows only PSS/native heap/java heap from real WebSocket data. No CPU Load, RAM Usage labels.
- **R027 — No RUN_NEW_JOB:** Must not appear on any job page.
- **Job data model:** The `Job` type has: `id`, `status`, `platform`, `deviceId`, `metadata`, `createdAt`, `startedAt`, `finishedAt`, `resultSummary`, `errorMessage`. There is no `testSuiteName` or `flowName` field on Job — the reference shows test suite names on cards but our data model uses job ID. Cards should show `job.id.slice(0, 8)` as the primary identifier (matching current behavior) plus the platform label as the card title context.

## Common Pitfalls

- **FlakeyBadge import path:** The import is `$lib/components/FlakeyBadge.svelte` (root of components dir, NOT `shared/`). StepList already has this import — don't change it.
- **Tab active styling with if/else:** The job detail tabs currently use ternary-in-template for active/inactive classes. These must convert to if/else blocks per the D016 pattern established in S01/S02 (Tailwind JIT needs full static strings scannable in source).
- **Pagination component stays:** The reference shows "LOAD_MORE_RECORDS" as a styled button. The existing Pagination component is already S01-reskinned. Keep using it — don't rebuild.
- **`bg-background/80` opacity on hex:** Tailwind v4 supports opacity modifiers on `@theme` custom colors. The pattern `bg-background/80` works (proven in Header.svelte by S02). Safe to use for similar glass effects.
