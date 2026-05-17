---
id: S03
parent: M002
milestone: M002
provides:
  - Kinetic Console dark bento grid dashboard with 7 sections wired to live health/jobs API data
  - Bento grid layout pattern (3-column with col-span variants) for future page layouts
  - D016-safe {@const} + Record lookup pattern for dynamic Tailwind class application
requires:
  - slice: S01
    provides: "@theme color tokens, .glass-card class, font-headline/font-body/font-label families, StatusBadge.svelte, AlertBanner.svelte, statusStyle() from format.ts"
  - slice: S02
    provides: "Layout shell with md:pl-64 pt-16 offsets, top navbar, sidebar, mobile bottom nav"
affects:
  - S04
  - S05
key_files:
  - web/src/routes/+page.svelte
key_decisions:
  - jobBorderStyles uses Record<string, string> lookup with full static class strings (D016-safe)
  - Queue iOS card uses if/else block for red tint styling when overloaded (D016-safe)
  - Recent Builds cards are <a> links to /jobs/{id} for direct navigation
  - AlertBanner API uses message prop (not children) for system alerts
patterns_established:
  - Bento grid dashboard pattern — glass-card sections in a 3-column grid with lg:col-span-2 for wide sections
  - {@const} with static Record lookup for D016-safe dynamic Tailwind class application in Svelte templates
  - Conditional tonal tinting — surface shifts to tertiary tones under threshold conditions (queue overflow)
observability_surfaces:
  - GET /api/health and GET /api/jobs requests visible in Network tab on page load
  - Error state renders AlertBanner with error message at page top
  - Loading state shows 4 dark skeleton cards with bg-surface-container
drill_down_paths:
  - .gsd/milestones/M002/slices/S03/tasks/T01-SUMMARY.md
duration: 10m
verification_result: passed
completed_at: 2026-03-18
---

# S03: Dashboard — Bento Grid Fleet Overview

**Complete rewrite of the dashboard from Jenkins-era light grid to a Kinetic Console dark bento layout with 7 data-wired sections, zero legacy tokens, and full D016 compliance.**

## What Happened

Single task (T01) — full rewrite of `web/src/routes/+page.svelte`. The script block preserved all existing `$state`/`$derived` declarations and `onMount` fetch logic exactly. Removed `WeatherIcon` and `JobCard` imports, removed `deviceWeatherPercent()` helper, added `statusStyle` import and `jobBorderStyles` static Record lookup map.

Template replaced entirely with a 3-column bento grid containing 7 sections:

1. **System Alert Banners** — full-width AlertBanner components with `message` prop for error devices and queue overflow warnings
2. **Infrastructure Health** — glass card with large green `healthPercent` number and segmented status bar (online/maintenance/error counts)
3. **Queue Android** — glass card showing Android queue depth from health API
4. **Queue iOS** — glass card with conditional red tint when `queue.ios > 3` (overflow indicator)
5. **Quick Actions** — 2×2 grid linking to `/devices`, `/jobs`, `/settings` (no RUN_NEW_JOB, no BUILD NOW)
6. **Active Fleet Status** — dark table spanning 2 columns with StatusBadge for device state
7. **Recent Builds** — column of inline cards with status-colored left borders via `{@const}` + Record lookup

Loading skeleton uses dark tokens (`bg-surface-container`, `glass-card`). Error state uses AlertBanner with `variant="critical"`. All Tailwind classes are full static strings — no template interpolation for dynamic values.

## Verification

- `npm run web:build` exits 0 (5.3s, SSR + client bundles, static adapter)
- All 14 grep checks pass:
  - Zero: `farm-*`, `jenkins-table`, `slate-/blue-/red-/yellow-`, `WeatherIcon`, `BUILD NOW`, `RUN_NEW_JOB`, `CPU/RAM/Network Profiler/Memory Heap/Leak Detection`
  - Positive: `glass-card` (9), `font-headline` (18), `getHealth/listJobs` (3), `AlertBanner` (4), `StatusBadge` (2), `statusStyle` (2)

## Requirements Advanced

- R014 — glass-card used in 9 places on dashboard (Infrastructure Health, Queue cards, quick actions, fleet table, recent builds)
- R024 — dashboard uses ghost borders (border-white/5) and tonal surface-container tiers, zero 1px solid borders for sectioning
- R025 — StatusBadge pill badges in fleet table, statusStyle() for Recent Builds card borders

## Requirements Validated

- R018 — All 7 bento sections render with real health/jobs API data. Zero fake metrics. Infrastructure Health glass card with green percentage, Queue Android/iOS cards, quick actions grid, alert banners, fleet status table, recent builds column — all confirmed via build pass and grep verification.

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

None. All plan steps executed as specified.

## Known Limitations

- Dashboard relies on S01 tokens and S02 layout shell — standalone rendering outside the shell is not possible
- Queue iOS overflow threshold (`> 3`) is hardcoded, not configurable
- Recent Builds section doesn't show pagination (shows whatever `listJobs` returns in initial fetch)

## Follow-ups

- none

## Files Created/Modified

- `web/src/routes/+page.svelte` — Full rewrite from Jenkins-era light grid to Kinetic Console dark bento layout with 7 sections

## Forward Intelligence

### What the next slice should know
- The `{@const}` + `Record<string, string>` pattern for D016-safe dynamic class application works well in Svelte `{#each}` blocks — use it for job cards (S04) and device cards (S05). Example: `{@const borderClass = jobBorderStyles[job.status] ?? jobBorderStyles.default}`
- `statusStyle()` from `format.ts` returns token-based class names that work for both StatusBadge and direct class application on card borders
- AlertBanner now expects a `message` string prop (not children) — this is how all pages should use it going forward

### What's fragile
- The `glass-card` class depends on `backdrop-filter: blur(12px)` which may not be visible without a background that shows through — ensure parent containers have the correct `bg-background` or similar token
- The 3-column bento grid assumes `md:` breakpoint for 2-col and `lg:` for 3-col — verify new pages match this responsive pattern

### Authoritative diagnostics
- Network tab on `/` should show `GET /api/health` and `GET /api/jobs` completing with 200 — this confirms all dashboard data wiring is alive
- If AlertBanner renders at page top, either a device is in error state or the queue is overflowing — check health API response to verify

### What assumptions changed
- No assumptions changed — the single-file rewrite executed exactly as planned
