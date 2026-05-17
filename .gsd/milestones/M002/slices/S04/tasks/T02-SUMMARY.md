---
id: T02
parent: S04
milestone: M002
provides:
  - Dark-themed Job Detail header with font-headline job ID and text-primary metadata icons
  - D016-compliant tab buttons using if/else blocks with purple active indicators
  - Dark error/loading states with tertiary/on-surface-variant tokens
  - Ghost borders replacing solid border-farm-border dividers
key_files:
  - web/src/routes/jobs/[id]/+page.svelte
key_decisions:
  - Preview tab if/else block nests inside the existing visibility guard ({#if (isRunning && job.deviceId) || (isTerminal && videoArtifact)}) — inner if/else for active/inactive styling, outer if for conditional rendering
patterns_established:
  - Tab if/else pattern with full static class strings on each branch (D016-safe for Tailwind v4 JIT)
observability_surfaces:
  - Active tab has text-on-surface border-primary classes; inactive has text-on-surface-variant border-transparent — inspect in DevTools Elements panel
  - Error banner uses bg-tertiary/10 border-tertiary/20 text-tertiary — force error by navigating to /jobs/nonexistent-id
  - Loading state uses text-on-surface-variant — throttle network in DevTools to observe
duration: 8m
verification_result: passed
completed_at: 2026-03-18
blocker_discovered: false
---

# T02: Reskin Job Detail page header, tabs, and states with Kinetic Console tokens

**Replaced all 13 farm-* tokens in Job Detail page with Kinetic Console dark theme tokens and converted tab buttons from ternary to D016-compliant if/else blocks**

## What Happened

Applied four changes to `web/src/routes/jobs/[id]/+page.svelte`:

1. **Loading state** — `text-farm-accent` → `text-on-surface-variant`
2. **Error state** — `border-farm-danger/30 bg-red-50 text-farm-danger rounded-md` → `border-tertiary/20 bg-tertiary/10 text-tertiary rounded-lg`
3. **Header** — Job ID `<h1>` gets `text-on-surface font-headline`; status label gets `text-on-surface-variant`; metadata row icons get `text-primary` for colored icons and `text-on-surface-variant` for text; header border uses `border-outline-variant/10` ghost border
4. **Tabs** — All three tab buttons (Logs, Steps, Preview) converted from inline ternary class expressions to Svelte if/else blocks with complete static class strings. Active state: `text-on-surface border-primary`; inactive: `text-on-surface-variant border-transparent hover:text-on-surface hover:border-outline-variant/20`. Tab container border uses `border-outline-variant/10`.

All script logic (fetchJob, fetchArtifacts, fetchLogs, fetchFlaky, stream, onMount, $effect) and the sidebar grid layout (`grid-cols-1 xl:grid-cols-[320px_1fr]`) were preserved exactly.

## Verification

- `npm run web:build` exits 0
- Zero `farm-*` tokens in `[id]/+page.svelte`
- Zero `bg-red-50` occurrences
- `font-headline` present on job ID heading
- 3 tab button if/else blocks confirmed (lines 163, 170, 178; line 189 is pre-existing tab content switcher)
- `border-primary` present on all active tab states
- Grid layout `grid-cols-1 xl:grid-cols-[320px_1fr]` preserved

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npm run web:build` | 0 | ✅ pass | 13.7s |
| 2 | `grep -rn 'farm-' web/src/routes/jobs/[id]/+page.svelte` | 1 (no match) | ✅ pass | <1s |
| 3 | `grep -n 'bg-red-50' web/src/routes/jobs/[id]/+page.svelte` | 1 (no match) | ✅ pass | <1s |
| 4 | `grep -n 'font-headline' web/src/routes/jobs/[id]/+page.svelte` | 0 | ✅ pass | <1s |
| 5 | `grep -c '{#if activeTab' web/src/routes/jobs/[id]/+page.svelte` → 4 | 0 | ✅ pass (3 tab + 1 content) | <1s |
| 6 | `grep -n 'border-primary' web/src/routes/jobs/[id]/+page.svelte` | 0 (3 matches) | ✅ pass | <1s |
| 7 | `grep -n 'grid-cols-1 xl:grid-cols-[320px_1fr]' web/src/routes/jobs/[id]/+page.svelte` | 0 | ✅ pass | <1s |

### Slice-Level Checks (partial — T03 pending)

| # | Check | Verdict | Notes |
|---|-------|---------|-------|
| 1 | Zero `farm-*` in jobs routes/components | ❌ expected | StepList (17 tokens) and MetricsPanel (13 tokens) still pending T03 |
| 2 | Zero `bg-red-50\|bg-slate-200\|bg-purple-500` | ❌ expected | MetricsPanel still uses `bg-slate-200` and `bg-purple-500` — T03 |
| 3 | Card grid `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` | ✅ pass | T01 established |
| 4 | `border-l-2` in JobCard | ✅ pass | T01 established |
| 5 | `font-headline` in both pages | ✅ pass | +page.svelte (T01) + [id]/+page.svelte (this task) |
| 6 | `bg-surface-container-low` in JobCard | ✅ pass | T01; StepList pending T03 |
| 7 | `bg-surface-variant` in MetricsPanel | ❌ expected | T03 |
| 8 | Zero `Filters` import in +page.svelte | ✅ pass | T01 |
| 9 | Zero CPU/RAM/leak labels | ✅ pass | Already clean |
| 10 | No solid `border-farm-border` in [id]/+page.svelte | ✅ pass | All replaced with ghost borders |

## Diagnostics

- **Tab active state:** Inspect any tab button in DevTools — active has `text-on-surface border-primary`, inactive has `text-on-surface-variant border-transparent`. Click tabs to verify switching.
- **Ghost borders:** Header and tab container borders use `border-outline-variant/10` — visible as faint dividers. Inspect computed `border-color` to confirm 10% opacity.
- **Error banner:** Navigate to `/jobs/nonexistent-id` — banner should show `bg-tertiary/10 border-tertiary/20 text-tertiary` styling (red on dark).
- **Loading state:** Throttle network in DevTools Network tab — "Loading..." text renders in `text-on-surface-variant`.

## Deviations

- Plan expected `grep -c '{#if activeTab'` to return 3, but it returns 4 because the pre-existing tab content switcher (`{#if activeTab === 'logs'}`) also matches. All 3 tab buttons correctly use if/else blocks; the 4th match is the original content rendering logic which was already if/else.

## Known Issues

None.

## Files Created/Modified

- `web/src/routes/jobs/[id]/+page.svelte` — Replaced all 13 farm-* tokens with Kinetic Console dark theme tokens; converted 3 tab buttons from ternary to if/else blocks; added font-headline to job ID heading; ghost borders on header and tab container; dark error/loading states
- `.gsd/milestones/M002/slices/S04/tasks/T02-PLAN.md` — Added Observability Impact section (pre-flight fix)
