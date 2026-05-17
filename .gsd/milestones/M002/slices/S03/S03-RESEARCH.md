# S03: Dashboard — Bento Grid Fleet Overview — Research

**Date:** 2026-03-18

## Summary

S03 is a complete rewrite of the dashboard page template (`web/src/routes/+page.svelte`). The script logic (health/jobs API calls, derived state computations) is preserved almost verbatim — only the template changes from Jenkins-era light grid to a Kinetic Console dark bento grid layout.

The current file is ~260 lines with 23 `farm-*` token references and 33 hardcoded light-theme colors (`slate-`, `blue-`, `red-`, `yellow-`). All must be replaced with `@theme` tokens. The reference design shows 7 sections: system alert banners, Infrastructure Health glass card, Queue Android card, Queue iOS card, 2×2 quick actions grid, ACTIVE_FLEET_STATUS table (2-col span), and RECENT_BUILDS column (1-col span). All sections map directly to existing API data — no new endpoints needed.

One component becomes obsolete: `WeatherIcon` (only used on this page) — replaced by the health percentage number display. `AlertBanner` and `StatusBadge` are already reskinned by S01 and ready to use. The current `JobCard` component has `farm-*` tokens and a list-row layout, but the reference's Recent Builds column uses a different card pattern (status-colored left border, stacked layout). Dashboard should render its own inline job cards rather than reuse `JobCard.svelte` (which S04 will reskin for the Build History page).

## Recommendation

Rewrite `+page.svelte` as a single task. The file is one page component (~260 lines) with tightly coupled sections sharing derived state. Splitting into sub-tasks adds coordination overhead without reducing risk. The script section stays almost identical; the template is a full replacement following the reference HTML patterns translated to Tailwind v4 `@theme` tokens.

Remove the `WeatherIcon` import (dashboard is its only consumer). Keep the component file itself — deletion is a cleanup concern, not a correctness one.

Do NOT reuse `JobCard.svelte` for the Recent Builds column — the dashboard job card pattern (status-colored left border, stacked title/time/status) differs from the Jobs page list-row pattern. Render inline markup. This avoids coupling S03 to S04's JobCard reskin.

## Implementation Landscape

### Key Files

- `web/src/routes/+page.svelte` — **The entire scope.** Current dashboard page, ~260 lines. Script section has `onMount` fetching `getHealth()` + `listJobs()`, 7 `$derived` computations (`totalDevices`, `onlineCount`, `maintenanceCount`, `errorCount`, `healthPercent`, `errorDevices`, `queueDepth`), and a `deviceWeatherPercent()` helper. Template is all Jenkins-era markup. Full template rewrite, script stays ~95% identical.
- `web/src/lib/api/health.ts` — Returns `HealthResponse` with `devices[]` (id, name, platform, state, currentJobId) and `queue` ({android, ios}). Used as-is.
- `web/src/lib/api/jobs.ts` — `listJobs()` returns `PaginatedResponse<Job>`. Used as-is — `recentJobs = jobsData.data` provides the Recent Builds data.
- `web/src/lib/api/types.ts` — `HealthResponse`, `Job`, `DeviceState` enum, `Platform` type. No changes needed.
- `web/src/lib/utils/format.ts` — `formatRelativeTime()`, `formatDuration()`, `statusStyle()`, `platformLabel()`. All already reskinned by S01. Used as-is.
- `web/src/lib/components/shared/StatusBadge.svelte` — Already reskinned (S01). Use for fleet table status cells.
- `web/src/lib/components/shared/AlertBanner.svelte` — Already reskinned (S01). Use for system alert banners. API: `variant='critical'|'warning'|'info'`, `message` string, optional `href` for link.
- `web/src/lib/components/shared/WeatherIcon.svelte` — **Remove import from dashboard.** Still has hardcoded `yellow-500`, `slate-400`, `slate-300` but no other page uses it. Leave the file; just stop importing it.
- `web/src/app.css` — Provides `.glass-card` class, all `@theme` tokens. No changes needed.

### Script Section Changes

Minimal changes to the `<script>` block:
1. Remove `WeatherIcon` import
2. Remove `deviceWeatherPercent()` helper function (no longer used)
3. All `$state` and `$derived` declarations stay identical
4. `onMount` fetch logic stays identical
5. Add `statusStyle` import from format.ts for job card status colors (or use inline if/else maps per D016)

### Template Sections (Reference → Data Mapping)

| Reference Section | Grid Position | Data Source | Notes |
|---|---|---|---|
| System Alert Banners | Full width, above grid | `errorDevices` + `queueDepth > 3` | Use `AlertBanner` component. Critical for error devices, warning for queue overflow. |
| Infrastructure Health | `md:col-span-2 lg:col-span-2` | `healthPercent`, `onlineCount`, `errorCount`, `maintenanceCount` | Glass card. Large green percentage number. Segmented status bar. No WeatherIcon. |
| Queue Android | 1 col | `health.queue.android` | Glass card. Platform icon. No EST_WAIT (R026 — don't fabricate). |
| Queue iOS | 1 col | `health.queue.ios` | Glass card. Red tint if queue high. No EST_WAIT. |
| Quick Actions | `md:col-span-2 lg:col-span-2`, 2×2 sub-grid | Static links to `/devices`, `/jobs`, `/jobs`, `/settings` | Glass cards with icon + label. Adapt reference labels: Maintenance→Devices, Build History→Jobs, System Logs→Jobs, Fleet Config→Settings. |
| ACTIVE_FLEET_STATUS | `lg:col-span-2` | `health.devices` | Dark table with ghost borders. Columns: Device_ID (name + id), Platform, Status (StatusBadge), Current_Session (job link or N/A), Actions (open_in_new icon). |
| RECENT_BUILDS | `lg:col-span-1` | `recentJobs.slice(0, 5)` | Inline cards with status-colored left border. Show: job ID (truncated), relative time, status text with status color. No fabricated test counts (R026). |

### Tailwind Class Patterns (from reference HTML, translated to v4 @theme)

These static class strings follow D016:

- **Section headers**: `text-on-surface-variant text-[10px] font-headline tracking-[0.2em] uppercase`
- **Glass cards**: `glass-card rounded-xl p-6 border border-white/5`
- **Table container**: `bg-surface-container-low rounded-xl border border-white/5`
- **Table header**: `bg-surface-container-high/50 border-b border-white/5 text-[10px] font-headline tracking-widest text-on-surface-variant uppercase`
- **Table rows**: `border-b border-white/5 hover:bg-white/[0.02] transition-colors`
- **Recent build cards**: `p-4 rounded-xl border-l-4 border-y border-r border-white/5 hover:bg-white/[0.02]` with status-specific `border-l` color via if/else blocks
- **Big numbers**: `text-5xl font-headline font-bold text-secondary` (health) / `text-4xl font-headline font-bold text-on-surface` (queue)
- **Loading skeleton**: Replace `border-farm-border` / `bg-farm-subtle` with `border-white/5` / `bg-surface-container`

### Build Order

Single task: rewrite `+page.svelte`. No dependencies between sections — they all share the same derived state computed in the script block.

1. Rewrite script imports (remove WeatherIcon, remove deviceWeatherPercent helper)
2. Rewrite template top-to-bottom following reference structure
3. Verify build + verify zero `farm-*` tokens remain

### Verification Approach

1. `npm run web:build` exits 0
2. `grep -c 'farm-' web/src/routes/+page.svelte` returns 0
3. `grep -c 'jenkins-table' web/src/routes/+page.svelte` returns 0
4. `grep -c 'slate-\|blue-[0-9]\|red-[0-9]\|yellow-' web/src/routes/+page.svelte` returns 0
5. `grep -c 'WeatherIcon' web/src/routes/+page.svelte` returns 0
6. `grep 'glass-card' web/src/routes/+page.svelte` returns matches (confirms glass cards used)
7. `grep 'font-headline' web/src/routes/+page.svelte` returns matches (confirms typography)
8. `grep 'getHealth\|listJobs' web/src/routes/+page.svelte` confirms data wiring preserved
9. `grep 'AlertBanner' web/src/routes/+page.svelte` confirms alert integration
10. `grep 'StatusBadge' web/src/routes/+page.svelte` confirms badge integration
11. No `RUN_NEW_JOB` or `BUILD NOW` text (D012)
12. No `CPU\|RAM\|Network Profiler\|Memory Heap\|Leak Detection` (R026)

## Constraints

- **D016**: All Tailwind classes must be full static strings — no template interpolation. Job card border colors (secondary/tertiary/primary/surface-variant) must use if/else blocks or lookup maps with complete class strings.
- **R026**: No EST_WAIT times, no test counts, no CPU/RAM/Network metrics. Only data from `HealthResponse` and `Job[]`.
- **D010**: Page title/header should say "Fleet Overview" (not "KINETIC_CONSOLE" or "FLEET").
- **D011/D012**: Quick action buttons link to real routes only. No RUN_NEW_JOB, no BUILD NOW button.
- **R024**: No `1px solid` sectioning borders. Use `border-white/5` ghost borders and `surface-container` tonal shifts.

## Common Pitfalls

- **Job card left-border color via interpolation** — The recent builds cards need per-status border-left colors (secondary for passed, tertiary for failed, primary for running, surface-variant for queued). Must use if/else blocks producing complete class strings like `border-l-secondary`, not `border-l-${color}`. This is the D016 pattern.
- **AlertBanner API mismatch** — S01 reskinned AlertBanner to use `message` prop (string) + optional `children` snippet. Current dashboard passes children inline. Must use the `message` prop or `children` snippet — check the component interface. AlertBanner expects: `variant`, `message`, optional `href`, optional `children`.
- **Loading skeleton colors** — Current skeletons use `border-farm-border` and `bg-farm-subtle`. Easy to miss since they only render briefly. Replace with `border-white/5` and `bg-surface-container`.
