# S02: Layout shell (top navbar + sidebar)

**Goal:** Add the dark navy top navbar with breadcrumbs and user section, enhance the sidebar with build executor status and node health bar, and wire the layout so all pages render inside the new shell.
**Demo:** Every authenticated page shows a dark navy top bar (#1e293b) with "Mobile Device Farm" title, breadcrumb navigation reflecting the current route, user section with logout. Sidebar shows build executor status (devices running/idle) and a node health progress bar — both wired to the real `/api/health` endpoint.

## Must-Haves

- Header.svelte renders dark navy top bar matching reference (h-12, #1e293b bg)
- Breadcrumbs update per-route: Dashboard, Build History, Runners, Manage, and Job detail shows `Build History » {id}`
- User section shows username + logout link (when auth enabled)
- Sidebar has "Build Executor Status" section showing device states from API
- Sidebar has "Node Health" progress bar with percentage from API
- Layout wraps content below header and right of sidebar — no overlap
- `+layout.svelte` uses `farm-*` tokens (zero `gh-*` references)
- `npm run web:build` passes

## Verification

- `grep -r 'gh-' web/src/routes/+layout.svelte web/src/lib/components/layout/` returns zero hits
- `ls web/src/lib/components/layout/Header.svelte` exists with >30 lines
- `npm run web:build` passes

## Tasks

- [x] **T01: Build Header component and update layout shell** `est:30m`
  - Why: The app has no top navbar — this is the primary navigation landmark that sets the Jenkins tone. Layout also has `gh-*` references that need migrating.
  - Files: `web/src/lib/components/layout/Header.svelte` (new), `web/src/routes/+layout.svelte`
  - Do: (1) Create Header.svelte matching reference: bg-farm-sidebar (#1e293b), h-12, fixed top-0. Left side: Material Symbol `settings_input_component` + "Mobile Device Farm" bold title + breadcrumb separator + per-route breadcrumb. Right side: if auth enabled, person icon + "User" + "log out" link that calls clearApiKey() and redirects; search icon in slate-700 rounded bg. (2) Update +layout.svelte: import Header, render above Nav+content. Replace `bg-gh-canvas` → `bg-farm-canvas`. Adjust main padding for header height (top padding or mt-12). Sidebar already has top-12 offset.
  - Verify: `grep -c 'gh-' web/src/routes/+layout.svelte` returns 0. Header.svelte exists with >30 lines. `npm run web:build` passes.
  - Done when: Dark navy header visible on all authenticated pages, breadcrumbs reflect current route, layout has zero `gh-*` references

- [x] **T02: Enhance sidebar with executor status and health bar** `est:25m`
  - Why: Reference sidebar has build executor status and node health sections that the current sidebar lacks. These surface real fleet health in the navigation.
  - Files: `web/src/lib/components/layout/Nav.svelte`
  - Do: (1) Add `onMount` to fetch health data from `/api/health`. (2) Add "Build Executor Status" section: table showing device slots with idle/running/error states from health.devices. Map each device to a row: slot number + state text (idle → italic text-slate-400, running → text-farm-accent with job link, error → text-farm-danger). (3) Add "Node Health" footer: calculate healthy % from devices (idle+running+allocated vs total), show as text + progress bar (bg-blue-600 fill). (4) Replace static "Monitoring active..." queue text with real queue depth from health.queue. (5) Keep 5-second polling interval matching the existing devices page pattern.
  - Verify: `grep -c 'gh-' web/src/lib/components/layout/Nav.svelte` returns 0. Nav.svelte has executor status section and health bar. `npm run web:build` passes.
  - Done when: Sidebar shows real device executor states and node health percentage from API

## Files Likely Touched

- `web/src/lib/components/layout/Header.svelte` (new)
- `web/src/routes/+layout.svelte`
- `web/src/lib/components/layout/Nav.svelte`
