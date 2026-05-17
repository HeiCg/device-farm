---
id: S03
milestone: M001
provides:
  - Jenkins-style dashboard with infrastructure health widget (WeatherIcon + health % + metric counters)
  - Alert banners generated from real device error state and queue depth
  - Jenkins-table of devices with status balls, weather icons, platform badges
  - Quick action cards linking to /jobs, /devices, /settings
  - Queue status widget with per-platform breakdown
requires:
  - slice: S01
    provides: StatusBadge, WeatherIcon, AlertBanner, farm-* tokens
  - slice: S02
    provides: Layout shell (header + sidebar)
affects: [S04, S05]
key_files:
  - web/src/routes/+page.svelte
key_decisions:
  - "Device weather derived per-device: healthy states→100%, booting/cleanup→65%, error/offline→20%"
  - "Queue warning alert threshold: > 3 jobs"
  - "Queue status widget replaces reference's CI/CD performance chart (no historical data available)"
patterns_established:
  - "Jenkins-table with S/W columns for status ball + weather icon"
  - "Alert banners dynamically generated from API state, not hardcoded"
drill_down_paths:
  - .gsd/milestones/M001/slices/S03/tasks/T01-PLAN.md
duration: 10min
verification_result: pass
completed_at: 2026-03-16T01:35:00Z
---

# S03: Dashboard reskin

**Jenkins-utilitarian dashboard: health widget with weather metaphor, dynamic alert banners, device table with status balls + weather, queue status, quick actions — all wired to real /api/health + /api/jobs data**

## What Happened

Complete rewrite of +page.svelte from GitHub-style stat cards to Jenkins-utilitarian sections. Infrastructure health widget shows WeatherIcon (large) derived from fleet-wide health %, plus 3-column metric grid (online/maintenance/error). Queue status panel shows per-platform breakdown. Alert banners auto-generated from device error states and queue depth >3. Device table uses jenkins-table pattern with status ball (S) and weather icon (W) columns. Quick action cards link to real routes. Footer matches reference REST API style.

## Verification

- `grep -c 'gh-\|lucide-svelte' web/src/routes/+page.svelte` → 0
- Uses StatusBadge (2), WeatherIcon (3), AlertBanner (3) from shared components
- `npm run web:build` → passes

## Deviations

Replaced reference's CI/CD Performance chart with Queue Status widget — no historical performance data available in the API. The queue widget shows real per-platform queue depth which is more useful for the actual Device Farm use case.

## Files Created/Modified

- `web/src/routes/+page.svelte` — complete rewrite: Jenkins dashboard with health widget, alerts, device table, quick actions
