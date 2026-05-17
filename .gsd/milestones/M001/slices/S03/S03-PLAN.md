# S03: Dashboard reskin

**Goal:** Replace the current GitHub-style stat cards + JobCard list dashboard with a Jenkins-utilitarian dashboard matching the reference: infrastructure health widget with weather metaphor, alert banners from device/queue state, device table with status balls + weather, and quick action cards — all wired to real API data.
**Demo:** Dashboard shows a weather icon + health % derived from devices, metric counters (online/maintenance/error), alert banners for error devices or full queues, a jenkins-table of devices with status balls and weather icons, and quick-action cards linking to key routes.

## Must-Haves

- Infrastructure health widget with WeatherIcon, health %, and online/maintenance/error counts
- Alert banners generated from real device errors and queue overflow
- Jenkins-table of devices with status ball (S), weather icon (W), name, platform, state, current job
- Quick action cards linking to /jobs, /devices, /settings
- Zero `gh-*` references in `+page.svelte`
- Zero Lucide imports in `+page.svelte`
- `npm run web:build` passes

## Verification

- `grep -c 'gh-\|lucide-svelte' web/src/routes/+page.svelte` returns 0
- `npm run web:build` passes
- Dashboard file uses StatusBadge, WeatherIcon, AlertBanner from shared components

## Tasks

- [x] **T01: Rewrite dashboard with reference layout sections** `est:35m`
  - Why: The entire dashboard needs to be restructured from GitHub-style stat cards to Jenkins-style sections (health widget, alerts, device table, quick actions). This is a single-file rewrite that's most coherent done in one pass.
  - Files: `web/src/routes/+page.svelte`
  - Do: (1) Replace all Lucide imports with existing shared components (StatusBadge, WeatherIcon, AlertBanner). (2) Keep existing data fetching (getHealth + listJobs, onMount). (3) Add derived computations: healthPercent (idle+running+allocated / total), errorDevices (devices in error/offline state), onlineCount, maintenanceCount (booting+cleanup), errorCount. (4) Build sections in order: page header with CONFIGURE/BUILD NOW buttons, infrastructure health widget (WeatherIcon large + health % + metric grid cols-3), alert banners (AlertBanner for each error device, warning if queue > 3), device table (jenkins-table with S/W/Name/Platform/State/Current Job columns), recent jobs section with existing JobCard (note: JobCard still has gh-* — that's S04's job), quick action cards (4-col grid linking to /jobs, /devices, /settings, #). (5) Replace all gh-* classes with farm-* equivalents. (6) Add page footer with REST API text and timestamp.
  - Verify: `grep -c 'gh-\|lucide-svelte' web/src/routes/+page.svelte` returns 0. `npm run web:build` passes.
  - Done when: Dashboard renders all reference sections with real API data, zero gh-*/Lucide references

## Files Likely Touched

- `web/src/routes/+page.svelte`
