# S04: Jobs — Build History Cards + Job Detail — UAT

**Milestone:** M002
**Written:** 2026-03-18

## UAT Type

- UAT mode: mixed (artifact-driven verification + live-runtime visual checks)
- Why this mode is sufficient: Token replacement and structural changes are verified by grep and build. Visual fidelity and interactive behavior require live browser verification.

## Preconditions

- Server running: `DEVICE_FARM_CONFIG=config.dev.yaml npm run dev` (or with real device pools)
- Web dev server: `npm run web:dev` on port 5173 (or production build served by server)
- At least 2-3 jobs in the database (mix of passed, failed, running if possible) for Build History to have content
- Browser with DevTools available for responsive testing

## Smoke Test

Navigate to `/jobs` — you should see dark cards in a grid layout (not a flat list), with colored left borders (green for passed, red for failed, purple for running). If you see a white background or flat list, S04 did not apply.

## Test Cases

### 1. Build History Card Grid Layout

1. Navigate to `/jobs`
2. On a wide viewport (≥1024px), verify cards arrange in a 3-column grid
3. Resize browser to tablet width (~768-1023px), verify cards rearrange to 2 columns
4. Resize to mobile width (<768px), verify cards stack in a single column
5. **Expected:** Responsive 3→2→1 column grid. Each card has a dark background (`bg-surface-container-low`), rounded corners, and a colored left border (2px).

### 2. JobCard Status Borders

1. Navigate to `/jobs` with a mix of job statuses
2. Inspect a passed job card — left border should be green (secondary, `#00fd93`)
3. Inspect a failed job card — left border should be red (tertiary, `#ff7168`)
4. If a running job exists — left border should be purple (primary, `#c39bff`)
5. If a queued/cancelled job exists — left border should be gray (outline)
6. **Expected:** Each card's left border color matches its status. StatusBadge pill inside the card also matches.

### 3. Filter Tabs — Status Filtering

1. Navigate to `/jobs`
2. Verify three status tabs visible: "All Runs", "Success", "Failures"
3. Click "Success" — only passed jobs should appear
4. Click "Failures" — only failed/error/timeout jobs should appear
5. Click "All Runs" — all jobs should reappear
6. **Expected:** Tabs filter correctly. Active tab has visually distinct dark background (`bg-surface-container-high`), inactive tabs are dimmer.

### 4. Filter Tabs — Platform Toggle

1. Navigate to `/jobs`
2. Verify platform toggle buttons: "All", "Android", "iOS"
3. Click "Android" — only Android jobs should appear
4. Click "Android" again — filter should deselect (show all platforms)
5. Click "iOS" — only iOS jobs should appear
6. **Expected:** Platform toggle with deselect behavior. Clicking active platform button clears the filter.

### 5. Load More Pagination

1. Navigate to `/jobs` (with enough jobs to paginate)
2. Scroll to bottom of the card grid
3. Verify "Load More" button appears (if more jobs exist)
4. Click "Load More" — additional cards should appear in the grid
5. **Expected:** New cards append to the grid without losing existing cards. No page reload.

### 6. Job Detail Header

1. Click any job card to navigate to `/jobs/[id]`
2. Verify job ID heading uses monospace-like Space Grotesk font (`font-headline`)
3. Verify StatusBadge pill badge next to job ID
4. Verify metadata row with icons (platform, device, duration, timestamp) — icons should be purple (`text-primary`)
5. Verify faint divider line below header (ghost border, not solid)
6. **Expected:** Dark header with purple-accented metadata icons and ghost border divider.

### 7. Job Detail Tabs

1. On Job Detail page, verify three tabs: "Logs", "Steps", "Preview" (Preview only if applicable)
2. Verify active tab has purple underline (`border-primary`) and bright text
3. Click "Steps" tab — verify it activates with purple underline, "Logs" tab dims
4. Click "Logs" tab — verify it reactivates
5. **Expected:** Tab switching works. Active tab clearly distinguished by purple border-bottom. No ternary-style class flickering.

### 8. StepList Sidebar

1. On Job Detail page, click "Steps" tab (or verify sidebar if steps are visible)
2. Verify summary header shows pass/fail/running counters in green/red/purple text
3. Verify each step row has a dark background with a colored left border (green=passed, red=failed, purple=running)
4. Verify each step's status icon is inside a tinted circle (faint color background matching status)
5. If any step has a flaky badge, verify FlakeyBadge renders as a dark-themed pill
6. **Expected:** Dark step cards with clear status indication via left borders and tinted icon circles.

### 9. MetricsPanel Real Data Only

1. On Job Detail page for a completed job with metrics data
2. Verify metrics panel shows bars for: Total PSS, Native Heap, Java Heap
3. Verify bar tracks are gray (`bg-surface-variant`), fills are colored (purple/green) with subtle glow
4. Verify panel has a purple left accent border (`border-l-2 border-primary`)
5. Verify NO labels reading "CPU Load", "RAM Usage", "Network Profiler", "Memory Heap", or "Leak Detection"
6. **Expected:** Only real memory metrics from WebSocket stream. No mock/placeholder data labels.

### 10. LogViewer Terminal Style

1. On Job Detail page, verify "Logs" tab is active
2. Verify log viewer header has three colored dots (red, purple, green) — macOS-style window controls
3. Verify "Output" label next to the dots
4. Verify terminal background is very dark (`#0d1117`)
5. Verify log lines have line numbers and syntax-colored log levels (ERROR in red, etc.)
6. Verify header/border uses ghost borders (faint outline), not solid 1px borders
7. **Expected:** Terminal-style log viewer with macOS dots header and dark theme.

### 11. Dark Theme Consistency — No Light Theme Leaks

1. Navigate through `/jobs` and `/jobs/[id]`
2. Verify no white/light gray backgrounds anywhere
3. Verify no bright blue links (should be purple or muted colors)
4. Verify loading states use dim text (`text-on-surface-variant`)
5. Verify error states use red-tinted dark banner (not white `bg-red-50`)
6. **Expected:** Fully dark obsidian theme. No Jenkins light-theme visual leaks.

## Edge Cases

### Empty Build History

1. Navigate to `/jobs` with no jobs in database
2. **Expected:** Empty state card appears with dimmed icon and "No jobs found" message in dark theme. No white/light backgrounds.

### Error State — Invalid Job ID

1. Navigate to `/jobs/nonexistent-id-12345`
2. **Expected:** Error banner renders with red-tinted dark background (`bg-tertiary/10 border-tertiary/20 text-tertiary`), not white `bg-red-50`.

### Loading State

1. Throttle network in DevTools to Slow 3G
2. Navigate to `/jobs`
3. **Expected:** 6 shimmer card skeletons appear in grid layout (dark animated placeholders).
4. Navigate to `/jobs/[id]`
5. **Expected:** "Loading..." text in dim color (`text-on-surface-variant`).

### Combined Filters

1. On Build History, select "Failures" status tab
2. Then select "Android" platform toggle
3. **Expected:** Only failed Android jobs appear. Both filters apply simultaneously.

## Failure Signals

- White or light gray backgrounds on any element in jobs pages
- Bright blue links instead of purple/muted colors
- Solid 1px borders used for sectioning (not for status indicators or inputs)
- Status borders not matching colors: green≠passed, red≠failed, purple≠running
- `bg-red-50` error banners (M001 holdover)
- Any "CPU", "RAM Usage", "Network Profiler", "Leak Detection" text in MetricsPanel
- Flat list layout instead of card grid on Build History
- `<select>` dropdowns instead of tab buttons for filters
- Ternary-style class flickering on tab buttons (D016 violation)

## Requirements Proved By This UAT

- R019 — Card grid layout, filter tabs, platform toggle, load-more pagination all verified
- R020 — Job Detail header, tabs, StepList, MetricsPanel, LogViewer all verified with dark theme
- R024 — Ghost borders replace solid borders in jobs pages (test cases 6, 7, 10)
- R025 — Status colors applied correctly via border-l-2 on cards and steps (test cases 2, 8)
- R026 — MetricsPanel shows only real data, no mock labels (test case 9)
- R014 — Surface-container tier tonal depth used in cards and panels (test cases 1, 8, 9)

## Not Proven By This UAT

- R012, R013 — Full token/font elimination across ALL pages (S05 pages still pending)
- R024, R025 — Full validation across Devices/Settings/Login (S05 scope)
- Exact pixel-perfect match to reference PNGs — automated checks confirm tokens and structure; visual fidelity requires side-by-side comparison
- WebSocket live streaming behavior during active job execution

## Notes for Tester

- If no jobs exist in the database, the Build History will show an empty state. Seed jobs by running test flows via the CLI or hitting the API directly.
- The MetricsPanel only shows data for jobs that had metrics streaming during execution. Older jobs or jobs run without metrics won't show bars — this is correct behavior (empty state: "No metrics data yet").
- LogViewer terminal background uses a hardcoded hex color (`#0d1117`) — this is intentional per R020 and is the standard GitHub-dark terminal color. It is NOT a leftover.
- Platform toggle has deselect behavior — clicking the already-active platform button clears the filter (shows all platforms). This is intentional UX.
- The three macOS-style dots in the LogViewer header are decorative — they don't perform close/minimize/maximize actions.
