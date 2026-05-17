---
id: T03
parent: S04
milestone: M002
provides:
  - Dark-themed StepList with status-colored left borders and tinted icon circles
  - Dark-themed MetricsPanel with semantic glow bars and purple accent border
  - LogViewer with macOS-style colored dots header and token-aligned borders
key_files:
  - web/src/lib/components/jobs/StepList.svelte
  - web/src/lib/components/jobs/MetricsPanel.svelte
  - web/src/lib/components/jobs/LogViewer.svelte
key_decisions:
  - Used full static class strings in stepBorderStyles Record ('border-l-2 border-secondary') for D016 safety
  - Preserved LogViewer terminal bg (#0d1117) and line-number/stderr hex colors per R020 dark theme allowance
patterns_established:
  - Tinted icon circle pattern — wrap status icon in w-6 h-6 rounded-full with bg-{color}/10 background
  - macOS-style dots header — three w-2 h-2 rounded-full spans (tertiary/primary/secondary) before title
observability_surfaces:
  - StepList step borders visually indicate status via border-l-2 color classes
  - MetricsPanel bar fills use glow shadows for visual emphasis on memory usage
  - LogViewer macOS dots provide visual landmark in terminal header
duration: 8m
verification_result: passed
completed_at: 2026-03-18
blocker_discovered: false
---

# T03: Reskin StepList, MetricsPanel, and LogViewer subcomponents

**Reskinned StepList (17 farm-* tokens), MetricsPanel (13 farm-* tokens + M001 colors), and LogViewer (hex colors) to Kinetic Console dark theme with status borders, glow bars, and macOS dots header**

## What Happened

Replaced all `farm-*` tokens and M001 holdover colors across three independent Job Detail subcomponents:

**StepList** — Replaced 17 `farm-*` tokens. Summary header now uses `bg-surface-container-high` with `text-secondary`/`text-tertiary`/`text-primary` status counters. Step rows sit in `bg-surface-container-low` with `border-l-2` status-colored left borders via a D016-safe `stepBorderStyles` Record (full static strings like `'border-l-2 border-secondary'`). Each status icon is wrapped in a tinted circle (`w-6 h-6 rounded-full bg-{color}/10`) using if/else blocks — not ternaries. Container uses ghost border (`border-outline-variant/10`).

**MetricsPanel** — Replaced 13 `farm-*` tokens plus `bg-slate-200` (bar tracks) and `bg-purple-500` (Native Heap bar). Container now has `border-l-2 border-primary` purple accent with `bg-surface-container-low`. Bar tracks use `bg-surface-variant`. Fills use semantic colors with glow shadows: `bg-primary` (Total PSS), `bg-primary-dim` (Native Heap), `bg-secondary` (Java Heap). No R026-violating labels introduced — only real PSS/Native Heap/Java Heap labels remain.

**LogViewer** — Replaced hardcoded hex borders (`#30363d` → `border-outline-variant/20`) and header bg (`#161b22` → `bg-surface-container-high`). Added macOS-style colored dots (three `w-2 h-2 rounded-full` spans in `bg-tertiary`/`bg-primary`/`bg-secondary`) before the "Output" label. Terminal background `bg-[#0d1117]` preserved per R020. Line numbers, stderr red, stdout colors kept as acceptable near-dark hex values.

## Verification

- `npm run web:build` exits 0 — clean build, no warnings
- Zero `farm-*` tokens across all three files
- Zero `bg-slate-200`, `bg-purple-500`, or `bg-farm-success` in MetricsPanel
- Zero R026-violating labels (cpu/ram usage/network profiler/memory heap/leak detection)
- `bg-surface-variant` present in MetricsPanel bar tracks (3 occurrences)
- `bg-surface-container-high` present in LogViewer header
- `rounded-full` present in LogViewer for macOS dots (3 occurrences)
- FlakeyBadge import uses `$lib/components/FlakeyBadge.svelte` (not `shared/`)
- `bg-surface-container-low` present in StepList
- All 10 slice-level verification checks pass (this is the final task in S04)

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npm run web:build` | 0 | ✅ pass | 4.3s |
| 2 | `grep -rn 'farm-' ...StepList ...MetricsPanel ...LogViewer` | 1 (no match) | ✅ pass | <0.1s |
| 3 | `grep -rn 'bg-slate-200\|bg-purple-500' ...MetricsPanel` | 1 (no match) | ✅ pass | <0.1s |
| 4 | `grep -i 'cpu\|ram usage\|network profiler\|memory heap\|leak detection' ...MetricsPanel` | 1 (no match) | ✅ pass | <0.1s |
| 5 | `grep -n 'bg-surface-variant' ...MetricsPanel` | 0 (3 matches) | ✅ pass | <0.1s |
| 6 | `grep -n 'bg-surface-container-high' ...LogViewer` | 0 (2 matches) | ✅ pass | <0.1s |
| 7 | `grep -n 'rounded-full' ...LogViewer` | 0 (3 matches) | ✅ pass | <0.1s |
| 8 | `grep -n 'FlakeyBadge' ...StepList` | 0 (correct path) | ✅ pass | <0.1s |
| 9 | `grep -n 'bg-surface-container-low' ...StepList` | 0 (1 match) | ✅ pass | <0.1s |
| 10 | `grep -rn 'farm-' web/src/routes/jobs/ web/src/lib/components/jobs/` (slice-level) | 1 (no match) | ✅ pass | <0.1s |
| 11 | `grep -rn 'bg-red-50\|bg-slate-200\|bg-purple-500' web/src/routes/jobs/ ...` (slice-level) | 1 (no match) | ✅ pass | <0.1s |
| 12 | `grep -rn 'border-farm-border' web/src/routes/jobs/ ...` (slice-level) | 1 (no match) | ✅ pass | <0.1s |

## Diagnostics

- **StepList status borders:** Inspect step rows in DevTools — each has `border-l-2` with `border-secondary` (passed), `border-tertiary` (failed), `border-primary` (running), or `border-outline` (pending). Icon circles show `bg-secondary/10`, `bg-tertiary/10`, etc.
- **MetricsPanel glow bars:** Inspect bar fill `<div>` elements — look for `shadow-[0_0_8px_...]` computed styles. Bar tracks are `bg-surface-variant`. Left accent: `border-l-2 border-primary` on outer container.
- **LogViewer macOS dots:** Three `<span>` elements before "Output" label with classes `bg-tertiary`, `bg-primary`, `bg-secondary`. Terminal background preserved as `bg-[#0d1117]`.
- **Empty states:** All three components render gracefully with empty data — "No steps yet...", "No metrics data yet", "Waiting for output..." in `text-on-surface-variant`.

## Deviations

None — all steps executed as planned.

## Known Issues

None.

## Files Created/Modified

- `web/src/lib/components/jobs/StepList.svelte` — Replaced 17 farm-* tokens with dark theme; added stepBorderStyles Record, tinted icon circles, bg-surface-container-low/high tonal hierarchy
- `web/src/lib/components/jobs/MetricsPanel.svelte` — Replaced 13 farm-* tokens + M001 holdovers; added border-l-2 border-primary accent, bg-surface-variant tracks, semantic glow bar fills
- `web/src/lib/components/jobs/LogViewer.svelte` — Replaced hex borders/header colors with tokens; added macOS-style colored dots header; preserved terminal background
- `.gsd/milestones/M002/slices/S04/tasks/T03-PLAN.md` — Added missing Observability Impact section
