---
id: S04
parent: M002
milestone: M002
provides:
  - Dark responsive 3-column card grid for Build History with status-colored left borders
  - Inline segmented-control filter tabs replacing select dropdown (status + platform toggle)
  - Dark Job Detail header with font-headline, D016-compliant if/else tab buttons, ghost borders
  - Dark StepList with border-l-2 status borders and tinted icon circles
  - Dark MetricsPanel with semantic glow bars (real PSS/heap data only — no mocks)
  - LogViewer with macOS-style colored dots header and token-aligned borders
requires:
  - slice: S01
    provides: "@theme color tokens (51 tokens), .glass-card class, font-headline/font-body/font-label, StatusBadge, FlakeyBadge, Pagination, statusStyle()"
  - slice: S02
    provides: "Layout shell (+layout.svelte with md:pl-64 pt-16 offsets), Header nav with JOBS active state"
affects:
  - S05
key_files:
  - web/src/lib/components/jobs/JobCard.svelte
  - web/src/routes/jobs/+page.svelte
  - web/src/routes/jobs/[id]/+page.svelte
  - web/src/lib/components/jobs/StepList.svelte
  - web/src/lib/components/jobs/MetricsPanel.svelte
  - web/src/lib/components/jobs/LogViewer.svelte
key_decisions:
  - "D017: Use $derived instead of {@const} for reactive Record lookups — Svelte 5 restricts {@const} to block contexts"
  - "D016 applied: All status-dependent class strings use full static Records, never template-string interpolation"
  - "Tab active/inactive styling uses if/else blocks, not ternary class expressions (D016 compliance)"
patterns_established:
  - Segmented-control tab pattern with if/else blocks for active/inactive styling
  - Platform toggle with deselect behavior (clicking active tab clears filter)
  - Tinted icon circle pattern — wrap status icon in rounded-full with bg-{color}/10
  - macOS-style dots header — three w-2 h-2 rounded-full spans (tertiary/primary/secondary) before title
  - stepBorderStyles / borderStyles Records — D016-safe full static class strings for status→border mapping
observability_surfaces:
  - Filter state: active tab has bg-surface-container-high class; inspect in DevTools
  - Grid layout: grid-cols-1/md:grid-cols-2/lg:grid-cols-3 inspectable at responsive breakpoints
  - Tab active state: text-on-surface border-primary on active tab; text-on-surface-variant border-transparent on inactive
  - Error banner: navigate to /jobs/nonexistent-id for bg-tertiary/10 border-tertiary/20 text-tertiary banner
  - MetricsPanel glow bars: shadow-[0_0_8px_...] on bar fills
drill_down_paths:
  - .gsd/milestones/M002/slices/S04/tasks/T01-SUMMARY.md
  - .gsd/milestones/M002/slices/S04/tasks/T02-SUMMARY.md
  - .gsd/milestones/M002/slices/S04/tasks/T03-SUMMARY.md
duration: 28m
verification_result: passed
completed_at: 2026-03-18
---

# S04: Jobs — Build History Cards + Job Detail

**Reskinned Build History as responsive 3-column card grid with inline filter tabs and Job Detail with dark header, D016-compliant tabs, status-bordered StepList, glow-bar MetricsPanel, and macOS-dots LogViewer — all using Kinetic Console tokens, zero farm-* tokens remaining in jobs routes**

## What Happened

Three tasks reskinned the Jobs pages from Jenkins light theme to Kinetic Console dark aesthetic across 6 files, eliminating ~43 `farm-*` token usages and all M001 holdover colors.

**T01 (Build History + JobCard)** — The highest-risk structural change. JobCard was rewritten from a flex-row `<a>` to a dark card with `bg-surface-container-low`, `rounded-lg`, and `border-l-2` status-colored left border using a `borderStyles` Record with full static class strings (D016-safe). Used `$derived` instead of `{@const}` for the reactive lookup after discovering Svelte 5 restricts `{@const}` to block contexts only. The Build History page replaced the `Filters` component import with two inline segmented-control tab groups: status tabs (All Runs / Success / Failures) and platform toggle (All / Android / iOS) with deselect behavior. The flat list wrapper became `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4`. Loading skeleton (6 shimmer cards in grid), empty state, and error state all updated to dark tokens. All script logic (loadJobs, handleFilterChange, handleLoadMore, cursor pagination) preserved exactly.

**T02 (Job Detail header + tabs + states)** — Replaced all 13 `farm-*` tokens in the Job Detail page. Job ID heading uses `font-headline text-on-surface`. Three tab buttons (Logs, Steps, Preview) converted from inline ternary class expressions to D016-compliant if/else blocks with full static class strings. Active tabs show `text-on-surface border-primary`, inactive show `text-on-surface-variant border-transparent`. Header and tab container dividers use ghost borders (`border-outline-variant/10`). Error state uses `bg-tertiary/10 border-tertiary/20 text-tertiary`. Sidebar grid layout preserved.

**T03 (StepList + MetricsPanel + LogViewer)** — Three independent subcomponents reskinned in parallel. StepList replaced 17 `farm-*` tokens with dark tonal hierarchy (`bg-surface-container-low` rows, `bg-surface-container-high` summary header) and added `border-l-2` status borders via `stepBorderStyles` Record plus tinted icon circles. MetricsPanel replaced 13 `farm-*` tokens plus M001 holdover colors (`bg-slate-200`, `bg-purple-500`) with semantic glow bars: `bg-primary` (Total PSS), `bg-primary-dim` (Native Heap), `bg-secondary` (Java Heap) on `bg-surface-variant` tracks with glow shadows. Only real data labels remain — no CPU/RAM/Network mock labels (R026). LogViewer replaced hardcoded hex borders with tokens (`border-outline-variant/20`, `bg-surface-container-high`) and added macOS-style colored dots header. Terminal background `bg-[#0d1117]` preserved per R020.

## Verification

All 10 slice-level verification checks pass:

| # | Check | Result |
|---|-------|--------|
| 1 | `npm run web:build` exits 0 | ✅ pass |
| 2 | Zero `farm-*` in `web/src/routes/jobs/` and `web/src/lib/components/jobs/` | ✅ pass |
| 3 | Zero `bg-red-50`, `bg-slate-200`, `bg-purple-500` M001 holdovers | ✅ pass |
| 4 | `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` in Build History | ✅ pass |
| 5 | `border-l-2` in JobCard | ✅ pass |
| 6 | `font-headline` in both Build History and Job Detail pages | ✅ pass |
| 7 | `bg-surface-container-low` in JobCard and StepList | ✅ pass |
| 8 | `bg-surface-variant` in MetricsPanel bar tracks | ✅ pass |
| 9 | Zero `Filters` import in Build History | ✅ pass |
| 10 | Zero R026-violating mock labels (CPU/RAM/leak) | ✅ pass |
| 11 | Zero `border-farm-border` in jobs files | ✅ pass |

## Requirements Advanced

- R012 — All `farm-*` tokens eliminated from jobs routes and components (~43 removed). Only S05 files (Devices, Settings, Login) remain.
- R013 — `font-headline` applied to Build History heading and Job Detail job ID heading.
- R014 — Surface-container tiers (low/high) used for tonal depth in JobCard, StepList, MetricsPanel, LogViewer. Ghost borders at ≤15% opacity.
- R024 — Ghost borders (`border-outline-variant/10`, `/20`) replace all solid `border-farm-border` dividers in jobs pages. `border-l-2` used only for status indicators (interactive elements, per spec).
- R025 — Status colors applied in JobCard borderStyles (secondary/tertiary/primary/outline) and StepList stepBorderStyles with matching tinted icon circles.

## Requirements Validated

- R019 — Build History renders as responsive 3-column card grid with status-colored left borders, filter tabs (All/Success/Failures + Android/iOS toggle), and LOAD_MORE pagination. All card data fields present (status badge, job ID, test suite, device, duration, timestamp).
- R020 — Job Detail fully reskinned: header with StatusBadge + font-headline job ID + metadata icons, D016-compliant tabs, sidebar with StepList (status borders + flaky badges) and MetricsPanel (real PSS/heap data with glow bars), terminal-style LogViewer with macOS dots header.
- R026 — MetricsPanel shows only Total PSS, Native Heap, and Java Heap from real WebSocket stream data. Zero CPU/RAM/Network Profiler/Memory Heap/Leak Detection strings in any jobs file. Combined with S03 dashboard proof, all data surfaces validated.

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

- T01 used `$derived` instead of `{@const}` for the borderStyles Record lookup. Svelte 5 restricts `{@const}` to block contexts ({#if}, {#each}), so a reactive `$derived` expression was used instead. This achieves identical D016 safety. Recorded as D017.

## Known Limitations

- Visual fidelity against reference PNGs requires human UAT — automated checks confirm tokens and structure but not exact visual match.
- LogViewer preserves some hardcoded hex values (`bg-[#0d1117]` terminal background, line-number and stderr colors) per R020 allowance — these are not tokenized.

## Follow-ups

- none — all work scoped for S04 is complete. S05 (Devices, Settings, Login) is the final slice.

## Files Created/Modified

- `web/src/lib/components/jobs/JobCard.svelte` — Rewrote from flex-row to dark card with border-l-2 status border, borderStyles $derived lookup, StatusBadge + job ID + platform/duration/timestamp layout
- `web/src/routes/jobs/+page.svelte` — Replaced Filters with inline segmented-control tabs, list with responsive card grid, dark loading/empty/error states
- `web/src/routes/jobs/[id]/+page.svelte` — Replaced 13 farm-* tokens, converted 3 tab buttons to if/else blocks, ghost borders on header/tabs, dark error/loading states
- `web/src/lib/components/jobs/StepList.svelte` — Replaced 17 farm-* tokens, added stepBorderStyles Record, tinted icon circles, bg-surface-container-low/high tonal hierarchy
- `web/src/lib/components/jobs/MetricsPanel.svelte` — Replaced 13 farm-* tokens + M001 holdovers, semantic glow bars, border-l-2 border-primary accent, bg-surface-variant tracks
- `web/src/lib/components/jobs/LogViewer.svelte` — Replaced hex borders/header with tokens, added macOS-style colored dots header, preserved terminal background

## Forward Intelligence

### What the next slice should know
- The segmented-control tab pattern (if/else blocks with full static class strings) and borderStyles Record pattern are now established in two places (Build History page and StepList). S05's Devices page will likely need a similar pattern for device state-dependent cards.
- All jobs files are fully clean of `farm-*` tokens. The remaining `farm-*` usages are exclusively in S05 scope: `web/src/routes/devices/`, `web/src/routes/settings/`, `web/src/routes/login/`.

### What's fragile
- The `$derived` reactive lookup for borderStyles depends on the `job.status` value matching exact Record keys. If the server adds new status values, the fallback to `border-outline` handles it gracefully, but the tinted icon circles in StepList only handle known statuses.

### Authoritative diagnostics
- `grep -rn 'farm-' web/src/routes/ web/src/lib/components/` — Run this to see exactly which files still have M001 tokens. After S04, only S05-scope files should match.
- DevTools element inspector on any JobCard `<a>` tag — verify `border-l-2` and status-colored border class.
- Navigate to `/jobs/nonexistent-id` — error banner renders with tertiary tokens.

### What assumptions changed
- Original plan assumed `{@const}` would work for Record lookups in Svelte 5 templates — it doesn't at top-level scope. `$derived` is the correct pattern (D017).
