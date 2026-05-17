# S03: Dashboard — Bento Grid Fleet Overview

**Goal:** Dashboard page renders as a Kinetic Console dark bento grid with all sections wired to real health/jobs API data, using glass cards, correct typography, and semantic color tokens — zero Jenkins-era styling remains.
**Demo:** Open `/` and see: system alert banners (if errors/queue overflow), Infrastructure Health glass card with green percentage + status bar, Queue Android card, Queue iOS card, 2×2 quick actions grid, ACTIVE_FLEET_STATUS dark table spanning 2 columns, RECENT_BUILDS column with status-colored left-border cards — all showing live data.

## Must-Haves

- All 7 dashboard sections render with Kinetic Console dark theme tokens
- Infrastructure Health card shows `healthPercent` as large green number with segmented online/maintenance/error counts
- Queue cards show per-platform queue depth from `health.queue.android` / `health.queue.ios`
- Alert banners use reskinned `AlertBanner` component with `message` prop (not children)
- Active Fleet Status table uses dark tonal styling with `StatusBadge` for device state
- Recent Builds uses inline cards with status-colored left border (not `JobCard.svelte`)
- Quick actions link to real routes only (`/devices`, `/jobs`, `/settings`) — no RUN_NEW_JOB, no BUILD NOW
- Zero `farm-*` tokens, zero hardcoded light-theme colors (`slate-`, `blue-[0-9]`, `red-[0-9]`, `yellow-`)
- No fabricated metrics (CPU, RAM, EST_WAIT, test counts)
- All Tailwind classes are full static strings (D016) — no template interpolation
- `WeatherIcon` import removed; `deviceWeatherPercent()` helper removed
- Loading skeleton uses dark theme tokens (`bg-surface-container`, `border-white/5`)
- Page header says "Fleet Overview" (D010)
- `npm run web:build` succeeds

## Verification

- `npm run web:build` exits 0
- `grep -c 'farm-' web/src/routes/+page.svelte` returns 0
- `grep -c 'jenkins-table' web/src/routes/+page.svelte` returns 0
- `grep -cE 'slate-|blue-[0-9]|red-[0-9]|yellow-' web/src/routes/+page.svelte` returns 0
- `grep -c 'WeatherIcon' web/src/routes/+page.svelte` returns 0
- `grep -c 'BUILD NOW' web/src/routes/+page.svelte` returns 0
- `grep -c 'RUN_NEW_JOB' web/src/routes/+page.svelte` returns 0
- `grep -c 'CPU\|RAM\|Network Profiler\|Memory Heap\|Leak Detection' web/src/routes/+page.svelte` returns 0
- `grep 'glass-card' web/src/routes/+page.svelte` returns matches
- `grep 'font-headline' web/src/routes/+page.svelte` returns matches
- `grep 'getHealth\|listJobs' web/src/routes/+page.svelte` returns matches (data wiring preserved)
- `grep 'AlertBanner' web/src/routes/+page.svelte` returns matches
- `grep 'StatusBadge' web/src/routes/+page.svelte` returns matches
- `grep 'statusStyle' web/src/routes/+page.svelte` returns matches

## Integration Closure

- Upstream surfaces consumed: S01 tokens (`@theme` colors, `.glass-card` class, `font-headline`/`font-body`/`font-label` families), S01 components (`StatusBadge.svelte`, `AlertBanner.svelte`), S01 utility (`statusStyle()` from `format.ts`), S02 layout shell (`md:pl-64 pt-16` offsets — page content renders inside the shell)
- New wiring introduced in this slice: none — all API calls (`getHealth`, `listJobs`) already exist in the current file
- What remains before the milestone is truly usable end-to-end: S04 (Jobs pages reskin), S05 (Runners, Settings, Login reskin)

## Tasks

- [x] **T01: Rewrite dashboard page to Kinetic Console bento grid** `est:30m`
  - Why: This is the entire scope of S03 — a single page component where the script logic stays nearly identical but the template is a full replacement from Jenkins-era light grid to dark bento layout with 7 sections.
  - Files: `web/src/routes/+page.svelte`
  - Do: (1) In script block: remove `WeatherIcon` import, remove `JobCard` import, remove `deviceWeatherPercent()` helper, add `statusStyle` import from `format.ts`. Keep all `$state`/`$derived` declarations and `onMount` fetch logic exactly as-is. (2) Rewrite template with 7 sections in a bento grid: system alert banners (full width, using AlertBanner with `message` prop), Infrastructure Health glass card (large green percentage + segmented counts), Queue Android card, Queue iOS card, 2×2 quick actions grid, ACTIVE_FLEET_STATUS dark table (2-col span with StatusBadge), RECENT_BUILDS column (inline cards with status-colored left border via static class lookup). (3) Replace loading skeleton with dark-themed version. (4) Remove footer. (5) All Tailwind classes must be full static strings per D016 — job card border colors use if/else blocks or a `Record<string, string>` lookup map. (6) AlertBanner API: pass `message` string prop + optional `href`, not inline children for device errors and queue warnings.
  - Verify: `npm run web:build` exits 0; `grep -c 'farm-' web/src/routes/+page.svelte` returns 0; `grep -cE 'slate-|blue-[0-9]|red-[0-9]|yellow-' web/src/routes/+page.svelte` returns 0; `grep -c 'WeatherIcon' web/src/routes/+page.svelte` returns 0; `grep 'glass-card' web/src/routes/+page.svelte` has matches; `grep 'StatusBadge' web/src/routes/+page.svelte` has matches
  - Done when: `npm run web:build` exits 0, all 14 slice-level verification checks pass, page renders all 7 bento sections with real data wiring preserved

## Observability / Diagnostics

- **Runtime signals:** Dashboard page fetches `GET /api/health` and `GET /api/jobs` on mount. Network tab shows both requests completing (200). Browser console should be clean — no JS errors.
- **Inspection surfaces:** Open `/` in browser. All 7 bento sections visible: alert banners (conditional), Infrastructure Health card, Queue Android/iOS cards, quick actions grid, Active Fleet Status table, Recent Builds column. Data wiring verified by checking device counts and job entries match API responses.
- **Failure visibility:** If health API fails, a critical AlertBanner renders with the error message at page top. Loading skeleton shows during fetch. Empty states render gracefully (0 devices = empty table, 0 jobs = no recent builds section).
- **Redaction constraints:** No secrets or PII on this page. Device IDs are truncated to 8 chars in display. Job IDs similarly truncated.

## Files Likely Touched

- `web/src/routes/+page.svelte`
