---
id: T01
parent: S03
milestone: M002
provides:
  - Kinetic Console dark bento grid dashboard with 7 sections wired to live health/jobs API data
key_files:
  - web/src/routes/+page.svelte
key_decisions:
  - jobBorderStyles uses Record<string, string> lookup with full static class strings (D016-safe)
  - Queue iOS card uses if/else block for red tint styling when overloaded (D016-safe, no interpolation)
  - Recent Builds cards are <a> links to /jobs/{id} for direct navigation
patterns_established:
  - Bento grid dashboard pattern: glass-card sections in a 3-column grid with lg:col-span-2 for wide sections
  - {@const} with static Record lookup for D016-safe dynamic Tailwind class application
observability_surfaces:
  - GET /api/health and GET /api/jobs requests visible in Network tab on page load
  - Error state renders AlertBanner with error message at page top
  - Loading state shows 4 dark skeleton cards
duration: 10m
verification_result: passed
completed_at: 2026-03-18
blocker_discovered: false
---

# T01: Rewrite dashboard page to Kinetic Console bento grid

**Rewrote +page.svelte from Jenkins-era light grid to Kinetic Console dark bento layout with 7 data-wired sections, zero legacy tokens, and full D016 compliance.**

## What Happened

Complete rewrite of `web/src/routes/+page.svelte`. Script block preserved all `$state`/`$derived` declarations and `onMount` fetch logic exactly. Removed `WeatherIcon` and `JobCard` imports, removed `deviceWeatherPercent()` helper, added `statusStyle` import and `jobBorderStyles` static lookup map.

Template replaced entirely with 7 bento grid sections: system alert banners (AlertBanner with `message` prop), Infrastructure Health glass card with large green healthPercent and segmented status bar, Queue Android/iOS cards with conditional red tint on iOS overflow, 2×2 quick actions grid linking to real routes, Active Fleet Status dark table with StatusBadge, and Recent Builds column with status-colored left-border cards using `{@const}` for D016-safe border class application.

Loading skeleton uses dark tokens (`bg-surface-container`, `glass-card`). Error state uses AlertBanner with `variant="critical"`. All Tailwind classes are full static strings — no template interpolation for dynamic values.

## Verification

- `npm run web:build` exits 0 — SSR + client bundles built successfully
- All 14 grep checks pass: zero farm-*, jenkins-table, slate/blue/red/yellow, WeatherIcon, BUILD NOW, RUN_NEW_JOB, CPU/RAM tokens; positive matches for glass-card (9), font-headline (18), getHealth/listJobs (3), AlertBanner (4), StatusBadge (2), statusStyle (2)

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npm run web:build` | 0 | ✅ pass | 17.6s |
| 2 | `grep -c 'farm-' web/src/routes/+page.svelte` | 0 (result: 0) | ✅ pass | <1s |
| 3 | `grep -c 'jenkins-table' web/src/routes/+page.svelte` | 0 (result: 0) | ✅ pass | <1s |
| 4 | `grep -cE 'slate-\|blue-[0-9]\|red-[0-9]\|yellow-' web/src/routes/+page.svelte` | 0 (result: 0) | ✅ pass | <1s |
| 5 | `grep -c 'WeatherIcon' web/src/routes/+page.svelte` | 0 (result: 0) | ✅ pass | <1s |
| 6 | `grep -c 'BUILD NOW' web/src/routes/+page.svelte` | 0 (result: 0) | ✅ pass | <1s |
| 7 | `grep -c 'RUN_NEW_JOB' web/src/routes/+page.svelte` | 0 (result: 0) | ✅ pass | <1s |
| 8 | `grep -cE 'CPU\|RAM\|Network Profiler\|Memory Heap\|Leak Detection' web/src/routes/+page.svelte` | 0 (result: 0) | ✅ pass | <1s |
| 9 | `grep 'glass-card' web/src/routes/+page.svelte` | 0 (result: 9) | ✅ pass | <1s |
| 10 | `grep 'font-headline' web/src/routes/+page.svelte` | 0 (result: 18) | ✅ pass | <1s |
| 11 | `grep 'getHealth\|listJobs' web/src/routes/+page.svelte` | 0 (result: 3) | ✅ pass | <1s |
| 12 | `grep 'AlertBanner' web/src/routes/+page.svelte` | 0 (result: 4) | ✅ pass | <1s |
| 13 | `grep 'StatusBadge' web/src/routes/+page.svelte` | 0 (result: 2) | ✅ pass | <1s |
| 14 | `grep 'statusStyle' web/src/routes/+page.svelte` | 0 (result: 2) | ✅ pass | <1s |

## Diagnostics

- Open `/` in browser to see the bento grid dashboard with all 7 sections
- Network tab shows `GET /api/health` and `GET /api/jobs` on mount
- If health API fails, a critical AlertBanner appears with the error message
- Queue iOS card turns red-tinted when `queue.ios > 3`
- Alert banners for error devices appear only when devices are in Error/Offline state

## Deviations

None. All plan steps executed as specified.

## Known Issues

None.

## Files Created/Modified

- `web/src/routes/+page.svelte` — Full rewrite from Jenkins-era light grid to Kinetic Console dark bento layout with 7 sections
- `.gsd/milestones/M002/slices/S03/S03-PLAN.md` — Added Observability / Diagnostics section (pre-flight fix)
- `.gsd/milestones/M002/slices/S03/tasks/T01-PLAN.md` — Added Observability Impact section (pre-flight fix)
