# S02: Layout shell — UAT

## Prerequisites
- Device Farm web app running (`npm run web:dev`)
- Server running with at least the health endpoint available

## Visual Checks

### 1. Top Navbar
- Load any authenticated page (/, /jobs, /devices, /settings)
- Verify dark navy bar across the top with "Mobile Device Farm" title
- Verify breadcrumbs update per route:
  - `/` shows "Dashboard"
  - `/jobs` shows "Dashboard » Build History"
  - `/devices` shows "Dashboard » Runners"
  - `/settings` shows "Dashboard » Manage"
  - `/jobs/{id}` shows "Build History » {short-id}"
- If auth is enabled, verify user section with "log out" link on right side

### 2. Sidebar
- Verify sidebar sits below the header (no overlap)
- Check "Build Queue" section shows real queue count (or "No builds in the queue")
- Check "Build Executor Status" shows device slots with state indicators
- Check "Node Health" at bottom shows percentage and progress bar
- Verify refresh button on Build Queue section works

### 3. Layout
- Content area should not overlap with header or sidebar
- Scrolling main content should not affect header or sidebar position
