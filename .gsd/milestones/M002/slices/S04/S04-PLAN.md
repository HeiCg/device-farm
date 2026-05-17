# S04: Jobs — Build History Cards + Job Detail

**Goal:** Reskin the Build History and Job Detail pages from Jenkins light theme to Kinetic Console dark aesthetic. Transform Build History from a flat list into a responsive card grid with status-colored left borders and inline filter tabs. Reskin all Job Detail subcomponents (StepList, MetricsPanel, LogViewer) with dark tonal palette.
**Demo:** Navigate to `/jobs` — see a 3-column card grid with dark cards, purple/green/red left borders per status, tab-style filter buttons (ALL_RUNS / SUCCESS / FAILURES + ANDROID / IOS toggle), and LOAD_MORE pagination. Click any card → Job Detail shows dark header with StatusBadge, dark tabs with purple active indicator, sidebar with dark step cluster and memory metrics bars, and terminal-style log viewer with macOS-style dots header.

## Must-Haves

- Build History renders as responsive card grid (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3`)
- Each JobCard has `border-l-2` with status-colored border (secondary for passed, tertiary for failed, primary for running)
- Filter tabs replace `<select>` dropdown: ALL_RUNS / SUCCESS / FAILURES status tabs + ANDROID / IOS platform toggle
- Job Detail header, tabs, loading/error states use Kinetic Console tokens exclusively
- Job Detail tabs use if/else blocks (not ternary) for active/inactive styling (D016 compliance)
- StepList uses dark cards with left-border status colors and icon circles
- MetricsPanel uses dark tonal bars (`bg-surface-variant` tracks, semantic color fills) — no CPU/RAM/Network mock labels
- LogViewer uses macOS-style colored dots header and `outline-variant` ghost borders
- Zero `farm-*` tokens remain in `web/src/routes/jobs/` and `web/src/lib/components/jobs/`
- Zero occurrences of `bg-red-50`, `bg-slate-200`, `bg-purple-500` (M001 holdover colors)
- `npm run web:build` exits 0

## Proof Level

- This slice proves: integration — card grid + filters + pagination + detail navigation all work together with real job data
- Real runtime required: yes (visual verification against reference)
- Human/UAT required: yes (visual fidelity check)

## Verification

- `npm run web:build` exits 0
- `grep -rn 'farm-' web/src/routes/jobs/ web/src/lib/components/jobs/` returns 0 matches
- `grep -rn 'bg-red-50\|bg-slate-200\|bg-purple-500' web/src/routes/jobs/ web/src/lib/components/jobs/` returns 0 matches
- `grep -n 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3' web/src/routes/jobs/+page.svelte` returns a match
- `grep -n 'border-l-2' web/src/lib/components/jobs/JobCard.svelte` returns a match
- `grep -n 'font-headline' web/src/routes/jobs/+page.svelte web/src/routes/jobs/\[id\]/+page.svelte` returns matches in both files
- `grep -n 'bg-surface-container-low' web/src/lib/components/jobs/JobCard.svelte web/src/lib/components/jobs/StepList.svelte` returns matches
- `grep -n 'bg-surface-variant' web/src/lib/components/jobs/MetricsPanel.svelte` returns a match
- Zero occurrences of `Filters` import in `web/src/routes/jobs/+page.svelte`
- `grep -i 'cpu\|ram usage\|network profiler\|memory heap\|leak detection' web/src/routes/jobs/\[id\]/+page.svelte web/src/lib/components/jobs/MetricsPanel.svelte` returns 0 matches (R026)
- No solid `border-farm-border` sectioning borders remain (R024)

## Observability / Diagnostics

- Runtime signals: `/api/jobs` requests visible in Network tab on Build History load; WebSocket stream for running jobs on Job Detail
- Inspection surfaces: DevTools element inspector on card grid to verify responsive breakpoints; tab active states toggle visually
- Failure visibility: error state renders with `bg-tertiary/10 border-tertiary/20 text-tertiary` banner on both pages
- Redaction constraints: none

## Integration Closure

- Upstream surfaces consumed: S01 tokens in `app.css` (`@theme` block with 51 color tokens, `.glass-card` class, font families); S01 shared components (`StatusBadge`, `FlakeyBadge`, `Pagination`); S01 `statusStyle()` in `format.ts`; S02 layout shell (`+layout.svelte` with `md:pl-64 pt-16` offsets, Header nav with JOBS active state)
- New wiring introduced in this slice: none — all API/WebSocket connections already exist
- What remains before the milestone is truly usable end-to-end: S05 (Runners, Settings, Login pages)

## Tasks

- [x] **T01: Rewrite JobCard as dark status-bordered card and transform Build History into card grid with inline filter tabs** `est:30m`
  - Why: The highest-risk structural change — flat list→card grid plus replacing `<select>` filters with segmented-control tabs. Closes R019 (card grid, filter tabs, load-more pagination) and advances R014 (glass card surfaces), R024 (no-line rule), R025 (status border colors).
  - Files: `web/src/lib/components/jobs/JobCard.svelte`, `web/src/routes/jobs/+page.svelte`
  - Do: Rewrite JobCard from flex-row `<a>` to card component with `bg-surface-container-low border-l-2` and status-colored border via local `borderStyles` Record lookup (D016). Rewrite Build History page: replace `Filters` import with inline tab buttons (ALL_RUNS/SUCCESS/FAILURES + ANDROID/IOS toggle), replace list wrapper with `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4`, update header/loading/empty/error states with Kinetic Console tokens. Keep all script logic (loadJobs, handleFilterChange, handleLoadMore, cursor pagination) intact.
  - Verify: `npm run web:build` exits 0; `grep -rn 'farm-' web/src/routes/jobs/+page.svelte web/src/lib/components/jobs/JobCard.svelte` returns 0 matches; `grep -n 'grid-cols-1' web/src/routes/jobs/+page.svelte` matches; `grep -n 'border-l-2' web/src/lib/components/jobs/JobCard.svelte` matches
  - Done when: Build History shows responsive card grid with status-colored left borders, filter tabs work, load-more pagination works, zero `farm-*` tokens in both files

- [x] **T02: Reskin Job Detail page header, tabs, and states with Kinetic Console tokens** `est:20m`
  - Why: Token substitution across the Job Detail page. Closes the header/tabs/states portion of R020. Advances R024 (ghost borders replace solid borders), R025 (status colors on header). Must convert tab ternary expressions to if/else blocks for D016 compliance.
  - Files: `web/src/routes/jobs/[id]/+page.svelte`
  - Do: Replace all 13 `farm-*` token references. Header: `font-headline` on job ID, `text-primary` on metadata icons, ghost border-bottom (`border-outline-variant/10`). Tabs: if/else blocks for active/inactive (active = `text-on-surface border-primary`, inactive = `text-on-surface-variant border-transparent hover:text-on-surface hover:border-outline-variant/20`). Error state: `bg-tertiary/10 border-tertiary/20 text-tertiary`. Loading: `text-on-surface-variant`. All script logic and sidebar/log grid layout (`grid-cols-1 xl:grid-cols-[320px_1fr]`) preserved exactly.
  - Verify: `npm run web:build` exits 0; `grep -rn 'farm-' web/src/routes/jobs/\[id\]/+page.svelte` returns 0 matches; `grep -n 'font-headline' web/src/routes/jobs/\[id\]/+page.svelte` matches; no ternary class expressions for tab active states
  - Done when: Job Detail renders with dark header, purple-active tabs via if/else blocks, dark error/loading states, zero `farm-*` tokens

- [x] **T03: Reskin StepList, MetricsPanel, and LogViewer subcomponents** `est:25m`
  - Why: Three independent subcomponents rendered inside Job Detail — all still use M001 tokens. Completes R020 (sidebar steps cluster, metrics, terminal log viewer) and validates R026 (metrics shows only real data — no CPU/RAM mock labels).
  - Files: `web/src/lib/components/jobs/StepList.svelte`, `web/src/lib/components/jobs/MetricsPanel.svelte`, `web/src/lib/components/jobs/LogViewer.svelte`
  - Do: **StepList** (17 `farm-*` tokens): summary header `bg-surface-container-high` with `text-secondary` passed / `text-tertiary` failed / `text-primary` running counters; step rows with `bg-surface-container-low` background, `border-l-2` status-colored left border, icon in tinted circle; container uses ghost borders. **MetricsPanel** (13 tokens): container `bg-surface-container-low` with `border-l-2 border-primary`; bar tracks `bg-surface-variant`; fills `bg-primary` (PSS), `bg-primary-dim` (Native Heap), `bg-secondary` (Java Heap) with glow shadows; header `bg-surface-container-high`. **LogViewer** (0 `farm-*` but hardcoded hex): replace `border-[#30363d]` → `border-outline-variant/20`, `bg-[#161b22]` → `bg-surface-container-high`; add macOS-style dots to header (three 8px circles in tertiary/primary/secondary); keep `bg-[#0d1117]` terminal background (per R020 dark theme).
  - Verify: `npm run web:build` exits 0; `grep -rn 'farm-' web/src/lib/components/jobs/StepList.svelte web/src/lib/components/jobs/MetricsPanel.svelte web/src/lib/components/jobs/LogViewer.svelte` returns 0 matches; `grep -rn 'bg-slate-200\|bg-purple-500\|bg-farm-success' web/src/lib/components/jobs/MetricsPanel.svelte` returns 0 matches; `grep -i 'cpu\|ram usage' web/src/lib/components/jobs/MetricsPanel.svelte` returns 0 matches
  - Done when: StepList shows dark step cards with status left borders, MetricsPanel shows dark tonal bars with glow, LogViewer has macOS dots header and token-aligned borders, zero `farm-*` tokens in all three files

## Files Likely Touched

- `web/src/lib/components/jobs/JobCard.svelte`
- `web/src/routes/jobs/+page.svelte`
- `web/src/routes/jobs/[id]/+page.svelte`
- `web/src/lib/components/jobs/StepList.svelte`
- `web/src/lib/components/jobs/MetricsPanel.svelte`
- `web/src/lib/components/jobs/LogViewer.svelte`
