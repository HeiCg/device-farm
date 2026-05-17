# S03: Dashboard — Bento Grid Fleet Overview — UAT

**Milestone:** M002
**Written:** 2026-03-18

## UAT Type

- UAT mode: mixed (artifact-driven verification + live-runtime visual inspection)
- Why this mode is sufficient: Build pass and grep checks confirm structural correctness (no legacy tokens, correct component usage). Visual inspection confirms layout, colors, and data wiring render correctly in the browser.

## Preconditions

- Server running (`npm run dev` or `DEVICE_FARM_CONFIG=config.dev.yaml npm run dev`)
- Web build passing (`npm run web:build` exits 0)
- At least one device and one job exist in the database (for fleet table and recent builds to have content)
- Browser open to `http://localhost:3000/` (or whichever port the server runs on)

## Smoke Test

Open `/` in a browser — the page should render with an obsidian dark background, glass-card surfaces, and Space Grotesk headlines. No white/light backgrounds, no Jenkins-era styling visible.

## Test Cases

### 1. Infrastructure Health Card

1. Open `/` in the browser
2. Locate the "Infrastructure Health" glass card in the top-left area
3. **Expected:** Large green percentage number showing `healthPercent` value. Below it, segmented counts for online/maintenance/error devices. Card has glass-card styling (semi-transparent dark background with blur). "INFRASTRUCTURE_HEALTH" label uses font-headline (Space Grotesk, uppercase tracking).

### 2. Queue Cards (Android + iOS)

1. On the dashboard, locate the two queue cards next to the health card
2. **Expected:** "QUEUE_ANDROID" card shows Android queue depth as a number. "QUEUE_IOS" card shows iOS queue depth.
3. If iOS queue depth > 3, the iOS card should have a red tint (tertiary color tonal shift)
4. Both cards use glass-card styling with ghost borders (no solid 1px borders)

### 3. System Alert Banners

1. If any devices are in Error or Offline state, alert banners should appear at the top of the page
2. If queue is overflowing, a queue warning banner should appear
3. **Expected:** Banners use the AlertBanner component with dark tinted background (tertiary-container tokens). Each banner shows a message string and optional link. If no errors/overflow exist, no banners render.

### 4. Quick Actions Grid

1. Locate the 2×2 quick actions grid on the dashboard
2. Click each action button
3. **Expected:** Actions link to real routes — `/devices`, `/jobs`, `/settings`. No "RUN_NEW_JOB", no "BUILD NOW", no broken links. Each action has an icon and label. Glass-card styling on each action tile.

### 5. Active Fleet Status Table

1. Locate the "ACTIVE_FLEET_STATUS" section (should span 2 columns on desktop)
2. **Expected:** Dark-themed table showing device rows with columns for device name/ID, platform, state, and current job (if allocated). Device state shown via StatusBadge pill component (green for idle/online, purple for running, red for error, gray for offline/maintenance). Table uses surface-container background tiers, not white backgrounds. No 1px solid borders for row separation — uses tonal shifts or ghost borders.

### 6. Recent Builds Column

1. Locate the "RECENT_BUILDS" column on the right side of the dashboard
2. **Expected:** Vertical list of job cards, each with a status-colored left border (green for passed, red for failed, purple for running, gray for queued/cancelled). Each card shows job ID (truncated), flow name, and timestamp. Cards are clickable links to `/jobs/{id}`. Cards are NOT the old JobCard.svelte component — they are inline card elements within the page.

### 7. Loading State

1. Open browser DevTools Network tab, set throttling to "Slow 3G"
2. Hard-refresh the page
3. **Expected:** 4 dark skeleton cards with `bg-surface-container` background appear while data loads. No white/light skeleton placeholders. Skeleton disappears when data arrives.

### 8. Error State

1. Stop the server or block `/api/health` endpoint
2. Refresh the dashboard
3. **Expected:** A critical AlertBanner appears at the top with the error message. No blank page, no unhandled exception. The page degrades gracefully.

### 9. Typography Verification

1. Inspect any section heading (e.g., "INFRASTRUCTURE_HEALTH", "ACTIVE_FLEET_STATUS")
2. **Expected:** Font is Space Grotesk (font-headline). Body text and data values use Inter (font-body). Uppercase tracking on section labels.

### 10. Dark Theme Token Compliance

1. Open DevTools, inspect computed styles on various dashboard elements
2. **Expected:** Background colors derive from `--color-background` (#0e0e0e) and surface-container tiers. No white (#fff), no light grays, no slate-100/200/300 colors. Accent colors are purple (#c39bff), green (#00fd93), red (#ff7168) from the token system.

## Edge Cases

### Empty Fleet (No Devices)

1. Start server with no devices configured
2. Open `/`
3. **Expected:** Infrastructure Health shows 0% or empty state. Fleet table is empty or shows "no devices" message. No JavaScript errors in console.

### Empty Jobs (No Builds)

1. Clear all jobs from the database
2. Open `/`
3. **Expected:** Recent Builds section either doesn't render or shows an empty state. No JavaScript errors.

### Mobile Viewport

1. Resize browser to < 768px width (or use DevTools mobile emulation)
2. **Expected:** Bento grid collapses to single-column layout. All 7 sections stack vertically. Bottom nav from S02 is visible. Sidebar is hidden. Content is readable without horizontal scrolling.

## Failure Signals

- Any white/light background visible on the page
- `farm-*` CSS classes in computed styles
- "WeatherIcon" or weather-related UI elements visible
- "BUILD NOW" or "RUN_NEW_JOB" buttons present
- CPU, RAM, Network Profiler, Memory Heap, or Leak Detection sections visible
- JavaScript errors in browser console on page load
- Network tab shows failed API requests (non-200) under normal operation
- StatusBadge rendering as solid colored circles instead of tinted pill badges
- Hardcoded color values visible in inspect (raw hex not from CSS custom properties)

## Requirements Proved By This UAT

- R018 — All 7 dashboard sections with real API data wiring confirmed via test cases 1-6
- R026 — No fake metrics (CPU/RAM/etc.) confirmed via test case 10 and absence checks
- R014 — Glass-card usage confirmed via visual inspection in test cases 1-6 (supporting evidence; full validation in S04/S05)
- R024 — No-Line Rule adherence confirmed via test case 5 and 10 (supporting evidence; full validation in S04/S05)
- R025 — Status badge pill styling confirmed via test cases 5-6 (supporting evidence; full validation in S04/S05)

## Not Proven By This UAT

- R012 — Full token migration (farm-* tokens remain in S04/S05 page files, not dashboard)
- R013 — Font application across all pages (only dashboard confirmed here)
- R014, R024, R025 — Full validation deferred until S04/S05 pages reskinned
- Visual pixel-fidelity comparison against reference PNGs (human judgment required)

## Notes for Tester

- If running without real devices (`config.dev.yaml`), the fleet table and health card will show zeroed data — this is expected behavior, not a bug
- Queue overflow red tint on iOS card only triggers when `queue.ios > 3` — you may need to submit multiple jobs to see it
- The loading skeleton is very brief on fast connections — use Network throttling to observe it
- Recent Builds cards link to `/jobs/{id}` — clicking them navigates to the job detail page which is not yet reskinned (S04 scope)
