---
id: S01
milestone: M001
provides:
  - Complete farm-* token set in app.css aligned with reference palette
  - StatusBadge component using Jenkins status balls (colored circles)
  - WeatherIcon component (sunny/cloudy/rainy by health %)
  - AlertBanner component (critical/warning/info with colored left borders)
  - statusStyle() utility returning farm-* classes
  - Shared components (Pagination, Filters, FlakeyBadge) on farm-* tokens + Material Symbols
requires: []
affects: [S02, S03, S04, S05]
key_files:
  - web/src/app.css
  - web/src/lib/utils/format.ts
  - web/src/lib/components/shared/StatusBadge.svelte
  - web/src/lib/components/shared/WeatherIcon.svelte
  - web/src/lib/components/shared/AlertBanner.svelte
  - web/src/lib/components/shared/Pagination.svelte
  - web/src/lib/components/shared/Filters.svelte
  - web/src/lib/components/FlakeyBadge.svelte
key_decisions:
  - "StatusBadge uses div.status-ball with bg-farm-* colors, running state gets animate-pulse"
  - "WeatherIcon thresholds: >80% sunny, 50-80% cloudy, <50% rainy"
  - "AlertBanner supports children snippet for custom content"
patterns_established:
  - "Status ball pattern: <div class='status-ball bg-farm-{status}'> with size prop"
  - "Material Symbols inline: <span class='material-symbols-outlined text-sm'>icon_name</span>"
drill_down_paths:
  - .gsd/milestones/M001/slices/S01/tasks/T01-PLAN.md
  - .gsd/milestones/M001/slices/S01/tasks/T02-PLAN.md
  - .gsd/milestones/M001/slices/S01/tasks/T03-PLAN.md
duration: 15min
verification_result: pass
completed_at: 2026-03-16T00:58:00Z
---

# S01: Design tokens + base components

**Jenkins design foundation: farm-* tokens aligned, status balls + weather icons + alert banners built, all shared components on Material Symbols**

## What Happened

Audited app.css tokens against the reference HTML — all farm-* values already matched the reference palette exactly (success=#1e40af, danger=#ef4444, unstable=#fbbf24, aborted=#94a3b8). Migrated statusStyle() in format.ts from dead gh-* to farm-* classes. Converted StatusBadge from Lucide SVG icons to Jenkins status balls (colored div circles with animate-pulse for running). Converted Pagination, Filters, FlakeyBadge from Lucide to Material Symbols and farm-* tokens. Built WeatherIcon (health % → sunny/cloudy/rainy) and AlertBanner (critical/warning/info with colored left borders, snippet support).

## Verification

- `grep -r 'gh-' web/src/lib/components/shared/ web/src/lib/components/FlakeyBadge.svelte web/src/lib/utils/format.ts web/src/app.css` → zero hits
- `grep -r 'lucide-svelte' web/src/lib/components/shared/ web/src/lib/components/FlakeyBadge.svelte` → zero hits
- `npm run web:build` → passes clean
- WeatherIcon.svelte: 28 lines, AlertBanner.svelte: 58 lines

## Deviations

None. The app.css tokens were already aligned with the reference — no changes needed there beyond confirming the audit.

## Files Created/Modified

- `web/src/app.css` — verified, no changes needed (tokens already matched)
- `web/src/lib/utils/format.ts` — statusStyle() migrated gh-* → farm-*
- `web/src/lib/components/shared/StatusBadge.svelte` — rewritten: status balls with farm-* colors
- `web/src/lib/components/shared/Pagination.svelte` — Material Symbols spinner, farm-* tokens
- `web/src/lib/components/shared/Filters.svelte` — farm-* tokens on selects
- `web/src/lib/components/FlakeyBadge.svelte` — Material Symbols warning, farm-* tokens
- `web/src/lib/components/shared/WeatherIcon.svelte` — new: health % → weather metaphor
- `web/src/lib/components/shared/AlertBanner.svelte` — new: alert banner with variants
