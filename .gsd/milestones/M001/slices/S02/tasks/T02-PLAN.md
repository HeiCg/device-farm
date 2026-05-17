---
estimated_steps: 5
estimated_files: 1
---

# T02: Enhance sidebar with executor status and health bar

**Slice:** S02 — Layout shell (top navbar + sidebar)
**Milestone:** M001

## Description

Add real-time build executor status and node health bar to the sidebar, wired to the `/api/health` endpoint. Replace the static queue placeholder with real queue depth data.

## Steps

1. Add onMount + 5s interval to fetch health data from `/api/health`
2. Add "Build Executor Status" section: table with device slots showing idle/running/error states
3. Add "Node Health" footer: calculate health %, show progress bar with bg-blue-600 fill
4. Replace static "Monitoring active..." with real queue depth from health.queue
5. Verify no gh-* references remain and build passes

## Must-Haves

- [ ] Sidebar fetches real health data via `/api/health`
- [ ] "Build Executor Status" section shows device slots with state indicators
- [ ] "Node Health" progress bar shows real percentage
- [ ] Queue section shows real queue depth
- [ ] Zero `gh-*` references in Nav.svelte

## Verification

- `grep -c 'gh-' web/src/lib/components/layout/Nav.svelte` returns 0
- Nav.svelte has executor status table and health bar
- `npm run web:build` passes

## Inputs

- T01 output: layout shell with header
- S01: farm-* tokens, Material Symbols pattern
- `/api/health` response shape: `{ status, uptime, devices: Device[], queue: { android, ios } }`
- Device type: `{ id, name, platform, state, emulatorId, currentJobId }`

## Expected Output

- `web/src/lib/components/layout/Nav.svelte` — enhanced with executor status + health bar
