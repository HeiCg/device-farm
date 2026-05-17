---
estimated_steps: 6
estimated_files: 1
---

# T01: Rewrite dashboard page to Kinetic Console bento grid

**Slice:** S03 — Dashboard — Bento Grid Fleet Overview
**Milestone:** M002

## Description

Complete rewrite of `web/src/routes/+page.svelte` from Jenkins-era light grid to Kinetic Console dark bento layout. The script block stays nearly identical — only import changes and one helper removal. The template is a full replacement with 7 sections: system alert banners, Infrastructure Health glass card, Queue Android/iOS cards, 2×2 quick actions grid, ACTIVE_FLEET_STATUS dark table, and RECENT_BUILDS column with status-colored left-border cards. All data wiring is preserved. No new API calls or endpoints.

**Relevant skills:** `frontend-design` (Svelte/Tailwind dark theme component reskin)

## Steps

1. **Script block changes.** In the `<script lang="ts">` block:
   - Remove `WeatherIcon` import
   - Remove `JobCard` import
   - Add: `import { formatRelativeTime, platformLabel, statusStyle } from '$lib/utils/format.js';`
   - Remove the `deviceWeatherPercent()` function
   - Keep ALL `$state` and `$derived` declarations exactly as-is (`health`, `recentJobs`, `loading`, `error`, `totalDevices`, `onlineCount`, `maintenanceCount`, `errorCount`, `healthPercent`, `errorDevices`, `queueDepth`)
   - Keep the `onMount` fetch logic exactly as-is
   - Add a `jobBorderColor` function or `const` lookup map that returns full static border-left class strings per D016:
     ```typescript
     const jobBorderStyles: Record<string, string> = {
       passed: 'border-l-secondary',
       failed: 'border-l-tertiary',
       error: 'border-l-tertiary',
       timeout: 'border-l-tertiary',
       running: 'border-l-primary',
       queued: 'border-l-surface-variant',
       cancelled: 'border-l-surface-variant',
     };
     ```

2. **Template: outer wrapper + page header + error/loading states.** Replace the entire template. Outer wrapper: `<div>`. Page header section:
   ```svelte
   <!-- Page Header -->
   <div class="mb-8">
     <h2 class="text-2xl font-headline font-bold text-on-surface mb-1">Fleet Overview</h2>
     <p class="text-sm text-on-surface-variant">Real-time status of your device testing infrastructure.</p>
   </div>
   ```
   Error state: use `AlertBanner` with `variant="critical"` and `message={error}` (not children). Loading skeleton: replace `border-farm-border` → `border-white/5`, `bg-farm-subtle` → `bg-surface-container`. Show 4 skeleton cards in a `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6`.

3. **Template: alert banners + Infrastructure Health + queue cards.** After the loading guard (`{:else}`):
   - **Alert banners** (full width, above the grid): iterate `errorDevices` rendering `<AlertBanner variant="critical" message="..." href="/devices" />`. Queue overflow: `<AlertBanner variant="warning" message="Queue depth is {queueDepth} — consider scaling up." />`. Use the `message` prop — AlertBanner handles the "Critical:" / "Warning:" label and icon automatically.
   - **Bento grid container**: `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">`.
   - **Infrastructure Health** glass card (`lg:col-span-2`): Section header `INFRASTRUCTURE_HEALTH` in `text-on-surface-variant text-[10px] font-headline tracking-[0.2em] uppercase`. Large `healthPercent` number in `text-5xl font-headline font-bold text-secondary`. Segmented bar showing online/maintenance/error counts. Use `glass-card rounded-xl p-6`.
   - **Queue Android** glass card: Show `health?.queue.android ?? 0` as large number in `text-4xl font-headline font-bold text-on-surface`. Section header `QUEUE_ANDROID`. Glass card styling.
   - **Queue iOS** glass card: Same pattern. Add conditional red tint styling if queue > 3 via if/else block (not interpolation).

4. **Template: quick actions grid.** 2×2 sub-grid within the bento layout (`lg:col-span-2`). Four glass card links:
   - Devices (`/devices`) — `devices_other` icon — "Fleet Devices" label
   - Build History (`/jobs`) — `history` icon — "Build History" label
   - System Logs (`/jobs`) — `terminal` icon — "System Logs" label
   - Fleet Config (`/settings`) — `settings` icon — "Fleet Config" label
   Each: `<a href="..." class="glass-card rounded-xl p-4 flex items-center gap-4 hover:bg-white/[0.02] transition-colors">` with icon + label. No RUN_NEW_JOB, no BUILD NOW.

5. **Template: ACTIVE_FLEET_STATUS table + RECENT_BUILDS column.** Both in the same grid or a new row:
   - **ACTIVE_FLEET_STATUS** (`lg:col-span-2`): Section header, then `<div class="bg-surface-container-low rounded-xl border border-white/5 overflow-hidden">`. Table header row: `bg-surface-container-high/50 border-b border-white/5` with columns Device_ID, Platform, Status, Current_Session, Actions. Table body rows: `border-b border-white/5 hover:bg-white/[0.02] transition-colors`. Device name displayed (not raw ID). Platform as small label. Status via `<StatusBadge status={device.state} />`. Current session: link to `/jobs/{id}` if present, `—` otherwise. Actions: `open_in_new` icon linking to `/devices`.
   - **RECENT_BUILDS** (`lg:col-span-1`): Section header, then iterate `recentJobs.slice(0, 5)`. Each card: `<div class="p-4 rounded-xl border-l-4 border-y border-r border-white/5 hover:bg-white/[0.02] transition-colors {jobBorderStyles[job.status] ?? 'border-l-surface-variant'}">`. Show job ID (truncated to 8 chars), relative time via `formatRelativeTime(job.createdAt)`, status text colored via `statusStyle(job.status).color`. **Important**: the border-l color comes from the `jobBorderStyles` lookup map, but must NOT use template interpolation in the class string itself — use an if/else chain producing a complete class string, or apply the lookup separately:
     ```svelte
     {#each recentJobs.slice(0, 5) as job (job.id)}
       {@const borderClass = jobBorderStyles[job.status] ?? 'border-l-surface-variant'}
       <div class="p-4 rounded-xl border-l-4 border-y border-r border-white/5 hover:bg-white/[0.02] transition-colors {borderClass}">
     ```
   Using `{@const}` with a lookup from a static Record is D016-safe — the full class strings exist in the source as scannable literals in the `jobBorderStyles` object.

6. **Verify.** Run `npm run web:build`. Run all 14 grep checks from the slice plan. Fix any issues.

## Must-Haves

- [ ] Zero `farm-*` tokens in the file
- [ ] Zero hardcoded light-theme colors (`slate-`, `blue-[0-9]`, `red-[0-9]`, `yellow-`)
- [ ] Zero `WeatherIcon` references
- [ ] Zero `JobCard` references
- [ ] Zero `jenkins-table` references
- [ ] Zero `BUILD NOW` or `RUN_NEW_JOB` text
- [ ] Zero fabricated metrics (CPU, RAM, EST_WAIT, test counts)
- [ ] `glass-card` class used on card sections
- [ ] `font-headline` used on section headers and big numbers
- [ ] `StatusBadge` used in fleet table
- [ ] `AlertBanner` used with `message` prop (not inline children)
- [ ] `statusStyle` imported and used for job card text colors
- [ ] `jobBorderStyles` lookup uses full static class strings (D016)
- [ ] All `$state`/`$derived` declarations preserved exactly
- [ ] `onMount` fetch logic preserved exactly
- [ ] Loading skeleton uses dark tokens (`bg-surface-container`, `border-white/5`)
- [ ] `npm run web:build` exits 0

## Verification

- `npm run web:build` exits 0
- `grep -c 'farm-' web/src/routes/+page.svelte` returns 0
- `grep -c 'jenkins-table' web/src/routes/+page.svelte` returns 0
- `grep -cE 'slate-|blue-[0-9]|red-[0-9]|yellow-' web/src/routes/+page.svelte` returns 0
- `grep -c 'WeatherIcon' web/src/routes/+page.svelte` returns 0
- `grep -c 'BUILD NOW' web/src/routes/+page.svelte` returns 0
- `grep -c 'RUN_NEW_JOB' web/src/routes/+page.svelte` returns 0
- `grep -cE 'CPU|RAM|Network Profiler|Memory Heap|Leak Detection' web/src/routes/+page.svelte` returns 0
- `grep 'glass-card' web/src/routes/+page.svelte` returns matches
- `grep 'font-headline' web/src/routes/+page.svelte` returns matches
- `grep 'getHealth\|listJobs' web/src/routes/+page.svelte` returns matches
- `grep 'AlertBanner' web/src/routes/+page.svelte` returns matches
- `grep 'StatusBadge' web/src/routes/+page.svelte` returns matches
- `grep 'statusStyle' web/src/routes/+page.svelte` returns matches

## Inputs

- `web/src/routes/+page.svelte` — current Jenkins-era dashboard (~260 lines). Script block has `onMount` fetching `getHealth()` + `listJobs()`, 7 `$derived` computations. Template is all Jenkins markup to be replaced.
- `web/src/lib/components/shared/AlertBanner.svelte` — S01-reskinned. API: `variant: 'critical'|'warning'|'info'`, `message: string`, optional `href: string`, optional `children: Snippet`. The component renders its own label ("Critical:", "Warning:") and icon automatically.
- `web/src/lib/components/shared/StatusBadge.svelte` — S01-reskinned. API: `status: string`, optional `size: number`. Renders tinted pill badge with uppercase status text.
- `web/src/lib/utils/format.ts` — provides `formatRelativeTime(date: string)`, `formatDuration(start, end)`, `statusStyle(status: string): {color, bg, label}`, `platformLabel(platform: string)`. All already use Kinetic Console tokens.
- `web/src/lib/api/types.ts` — `HealthResponse` has `devices[]` (id, name, platform, state, currentJobId) and `queue` ({android, ios}). `Job` has id, status, platform, createdAt, startedAt, finishedAt, deviceId, metadata, resultSummary, errorMessage.
- `web/src/app.css` — `.glass-card` class defined with `rgba(25,25,25,0.6)` bg + `backdrop-filter: blur(12px)`.
- S02 layout provides `md:pl-64 pt-16 pb-20 md:pb-0` offsets — this page renders inside that shell. No additional spacing needed for navbar/sidebar.

**Key decisions:**
- D010: Page title "Fleet Overview" — not "KINETIC_CONSOLE"
- D011/D012: Quick action links go to real routes only. No RUN_NEW_JOB, no BUILD NOW.
- D016: All Tailwind classes must be full static strings. Job card border colors use a `Record<string, string>` lookup map where every value is a complete class name visible to JIT scanning.
- R024: No 1px solid borders. Use `border-white/5` ghost borders and `surface-container` tonal shifts.
- R026: No EST_WAIT, no test counts, no CPU/RAM/Network metrics. Only data from `HealthResponse` and `Job[]`.

## Observability Impact

- **Signals changed:** No new API calls or endpoints. The same `getHealth()` and `listJobs()` calls fire on mount. The page now renders their data in a dark bento grid instead of a Jenkins-era light grid.
- **Inspection:** Open `/` → verify 7 sections render. Check Network tab for `GET /api/health` (200) and `GET /api/jobs` (200). Console should be clean. AlertBanner appears only when `errorDevices.length > 0` or `queueDepth > 3`.
- **Failure state visibility:** Error state shows a single critical AlertBanner with the error message string. Loading state shows 4 dark skeleton cards. Both are visible at page top.

## Expected Output

- `web/src/routes/+page.svelte` — Fully rewritten dashboard page with Kinetic Console dark bento grid layout, 7 sections, all data wiring preserved, zero Jenkins-era tokens, builds successfully.
