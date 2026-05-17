# S02: App Shell — Top Navbar, Sidebar, Mobile Nav, Layout — UAT

**Milestone:** M002
**Written:** 2026-03-18

## UAT Type

- UAT mode: mixed (artifact-driven + live-runtime)
- Why this mode is sufficient: Layout structure and token usage verified by build + grep (artifact-driven). Health API polling, responsive behavior, and active state detection require live runtime.

## Preconditions

- Server running (`npm run dev` or `DEVICE_FARM_CONFIG=config.dev.yaml npm run dev`)
- Web app accessible at configured URL (default http://localhost:3000)
- Auth enabled or disabled — test both paths if auth is configured
- Browser DevTools available for responsive testing

## Smoke Test

Navigate to http://localhost:3000 — you should see an obsidian dark page with a fixed top navbar showing "DEVICE_FARM" in purple, a left sidebar with "COMMAND_CENTER" header and green pulse dot, and page content offset correctly to the right of the sidebar and below the navbar.

## Test Cases

### 1. Top Navbar Renders Correctly

1. Navigate to http://localhost:3000
2. Inspect the top navbar (fixed, full-width bar at the top)
3. **Expected:** Height is `h-16` (64px). Background is semi-transparent dark with blur effect. "DEVICE_FARM" text appears in purple (text-primary) on the left. Four nav links visible on desktop: DASHBOARD, JOBS, DEVICES, SETTINGS. Search input visible. Notification and settings icon buttons visible. User avatar/logout button at far right.

### 2. Nav Link Active State Detection

1. Navigate to http://localhost:3000 (Dashboard)
2. Observe which nav link has a bottom underline
3. **Expected:** DASHBOARD has `border-b-2 border-primary` underline, other links are muted gray
4. Click JOBS link
5. **Expected:** URL changes to /jobs, JOBS now has the underline, DASHBOARD does not
6. Navigate to a job detail page (e.g., /jobs/some-id)
7. **Expected:** JOBS still shows active (startsWith matching)
8. Click DEVICES, then SETTINGS
9. **Expected:** Each link shows active state when on its route

### 3. Left Sidebar Structure

1. Navigate to any page on desktop viewport (>768px)
2. Inspect the left sidebar
3. **Expected:** Fixed sidebar, width `w-64` (256px), positioned below the navbar (`top-16`). Shows:
   - "COMMAND_CENTER v1.0" header with a green pulsing dot (animate-pulse)
   - "DEVICE_FARM" brand text
   - Nav items: Dashboard, Jobs, Devices, Settings
   - Active nav item has purple tinted background + right border (`border-r-4 border-primary`)
   - Build Queue section with queue depth count
   - Build Executor Status table
   - Node Health bar at bottom

### 4. Sidebar Health API Polling

1. Open DevTools Network tab, filter to XHR/Fetch
2. Navigate to http://localhost:3000
3. Wait 15 seconds
4. **Expected:** At least 3 requests to `/api/health` visible (one immediate, then every 5 seconds)
5. Sidebar sections should show data from health response: queue depth numbers, executor device names/states, health percentage bar

### 5. Sidebar Health Degradation

1. Stop the backend server
2. Wait for next health poll cycle (5 seconds)
3. **Expected:** Sidebar shows stale data or zeros — no crash, no error modal, no blank sections. Console may show fetch errors but sidebar remains visually intact.

### 6. Mobile Bottom Nav Appears

1. Resize browser to <768px width (or use DevTools mobile emulation)
2. **Expected:** Left sidebar disappears. Fixed bottom nav bar appears at the bottom of the screen with 4 items: Dashboard, Jobs, Devices, Settings — each with a Material Symbols icon and text label. Background is semi-transparent dark with blur.
3. Resize back to >768px
4. **Expected:** Bottom nav disappears. Sidebar reappears.

### 7. Mobile Nav Active State

1. At mobile viewport (<768px), navigate to /jobs
2. **Expected:** Jobs item in bottom nav shows `text-primary` (purple) and bold font. Other items show muted gray (`text-on-surface-variant`).
3. Tap Dashboard
4. **Expected:** Dashboard now shows active purple state, Jobs reverts to muted.

### 8. Content Area Offset

1. At desktop viewport (>768px), navigate to any page
2. Inspect the `<main>` element in DevTools
3. **Expected:** Has classes `md:pl-64 pt-16 pb-20 md:pb-0 min-h-screen`. Content does not overlap with the navbar or sidebar. No horizontal scrollbar.
4. At mobile viewport (<768px):
5. **Expected:** No left padding (pl-64 only applies at md+). Bottom padding `pb-20` provides clearance above the mobile nav bar.

### 9. Login Page Renders Outside Shell

1. Navigate to /login (or logout if auth is enabled)
2. **Expected:** Login page renders full-screen with NO top navbar, NO sidebar, NO mobile bottom nav. Just the login page content on obsidian background.

### 10. No Excluded Items

1. Inspect all three nav surfaces (top navbar links, sidebar nav items, mobile bottom nav)
2. **Expected:** Zero occurrences of: RUN_NEW_JOB button, DOCUMENTATION link, SUPPORT link, Analytics, Reports, Test Suites, Logs. Only Dashboard, Jobs, Devices, Settings.

### 11. Logout Function Preserved

1. With auth enabled, click the user avatar icon in the top-right of the navbar
2. **Expected:** Redirects to /login page. Auth state cleared.

## Edge Cases

### Sub-route Active State

1. Navigate to /jobs/some-random-id
2. **Expected:** JOBS is highlighted in top navbar (startsWith match). Dashboard is NOT highlighted.
3. Navigate to /
4. **Expected:** Only DASHBOARD is highlighted — not DEVICES or JOBS.

### Rapid Viewport Resize

1. Rapidly resize between mobile and desktop widths
2. **Expected:** Sidebar and mobile nav toggle visibility cleanly — no flicker, no overlapping nav elements, no layout shift in content area.

### Browser Back/Forward Navigation

1. Navigate Dashboard → Jobs → Devices → Settings using nav links
2. Press browser Back button twice
3. **Expected:** Active states in all three nav surfaces update correctly to match the current URL.

## Failure Signals

- Any `farm-*` colored background or text visible (indicates old tokens leaked through)
- Content overlapping with navbar or sidebar (offset classes missing or wrong)
- Sidebar visible on mobile viewport (<768px)
- Mobile bottom nav visible on desktop viewport (>768px)
- No green pulse dot next to COMMAND_CENTER (animation or token issue)
- Navbar appears transparent with no blur (backdrop-filter not working)
- Nav links don't highlight on active route
- Health API calls not appearing in Network tab
- Any nav item showing a route other than /, /jobs, /devices, /settings

## Requirements Proved By This UAT

- R015 — Top navbar spec fully testable: h-16, glass effect, brand, nav links, search, icons, avatar
- R016 — Sidebar spec fully testable: w-64, COMMAND_CENTER, active state, queue/executor/health API wiring
- R017 — Mobile bottom nav spec fully testable: md:hidden, 4 items, icons, active state
- R027 — Absence of RUN_NEW_JOB confirmed by inspection
- R028 — Only real routes in navigation confirmed by inspection

## Not Proven By This UAT

- Visual pixel-fidelity match against reference PNGs (deferred to final milestone UAT)
- Glass card usage in sidebar sections (glass-card class is available but sidebar uses bg-background + tonal sections, not glass-card)
- Search functionality (input is visual-only placeholder — no search API exists)
- Notification functionality (icon is visual-only — no notification system exists)

## Notes for Tester

- The search input and notification icon are intentionally non-functional — they match the reference design's visual structure but have no backend wiring. Don't report these as bugs.
- The sidebar health bar may show 0% if no devices are configured — this is correct behavior when running with `config.dev.yaml` (no device pools).
- The green pulse dot uses `animate-pulse` CSS animation — it should gently fade in/out continuously. If it appears static green, check if Tailwind's animation utilities loaded correctly.
- Ghost borders (`border-primary/15`, `border-primary/10`) are intentionally very subtle at 10-15% opacity. They may be nearly invisible on some monitors — inspect in DevTools computed styles to confirm they exist.
