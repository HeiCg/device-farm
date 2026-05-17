---
estimated_steps: 6
estimated_files: 1
---

# T01: Rewrite dashboard with reference layout sections

**Slice:** S03 — Dashboard reskin
**Milestone:** M001

## Description

Complete rewrite of the dashboard page from GitHub-style stat cards to Jenkins-utilitarian sections matching the reference: infrastructure health widget with WeatherIcon, alert banners from device state, jenkins-table of devices, quick action cards.

## Steps

1. Replace Lucide imports with shared components (StatusBadge, WeatherIcon, AlertBanner)
2. Add derived state: healthPercent, onlineCount, maintenanceCount, errorCount, errorDevices
3. Build infrastructure health widget — WeatherIcon (large) + health % + 3-col metric grid
4. Build alert banners section — AlertBanner for error devices, warning for queue depth
5. Build device table — jenkins-table with status ball, weather, name, platform, state columns
6. Build quick action cards + footer, remove all gh-* references

## Must-Haves

- [ ] Infrastructure health widget with WeatherIcon and metric counters
- [ ] Alert banners generated from real device/queue state
- [ ] Jenkins-table of devices with status balls and weather icons
- [ ] Quick action cards linking to real routes
- [ ] Zero gh-* and Lucide references
- [ ] npm run web:build passes

## Verification

- `grep -c 'gh-\|lucide-svelte' web/src/routes/+page.svelte` returns 0
- Dashboard uses StatusBadge, WeatherIcon, AlertBanner components
- `npm run web:build` passes

## Inputs

- S01: StatusBadge (status balls), WeatherIcon (health→weather), AlertBanner (critical/warning/info)
- S02: Layout shell already provides header + sidebar — dashboard is just the content area
- Current +page.svelte: existing data fetch pattern (getHealth + listJobs on mount)
- Reference HTML: section structure for health widget, alerts, device table, quick actions

## Expected Output

- `web/src/routes/+page.svelte` — fully rewritten Jenkins-style dashboard
