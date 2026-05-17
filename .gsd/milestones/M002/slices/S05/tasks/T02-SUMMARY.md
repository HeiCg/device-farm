---
id: T02
parent: S05
milestone: M002
provides:
  - Reskinned Devices page with summary state counters, platform-grouped sections, responsive card grid
  - Reskinned DeviceCard with state-specific content and D016 Record lookup maps for border colors
key_files:
  - web/src/routes/devices/+page.svelte
  - web/src/lib/components/devices/DeviceCard.svelte
key_decisions:
  - Used $derived instead of {@const} at component top level per D017 Svelte 5 constraint
patterns_established:
  - DeviceCard uses $derived for state-dependent border/wrapper classes at component top level; {@const} only inside {#each}/{#if} blocks
  - Summary counter bar pattern with border-l-2 + Record lookup for state-specific colors
observability_surfaces:
  - Device card border color changes by state via cardBorderStyles Record (border-primary/30 running, border-tertiary/30 error)
  - Summary counters show count per state with counterBorderStyles/counterTextStyles Records
  - Offline cards visually distinct with opacity-60 grayscale from wrapperStyles Record
  - Error cards show RESTART button styled with bg-tertiary/10 text-tertiary border-tertiary/20
duration: 8m
verification_result: passed
completed_at: 2026-03-18
blocker_discovered: false
---

# T02: Reskin Devices page and DeviceCard with summary counters and platform-grouped card grid

**Reskinned Devices page from flat bordered table-row layout to fleet management view with 5-state summary counters, ANDROID_ECOSYSTEM/IOS_SUITE platform sections, responsive card grid, and state-specific DeviceCard content — zero farm-* tokens remain**

## What Happened

Rewrote `DeviceCard.svelte` from a horizontal flex row with 7 `farm-*` refs into a vertical card with state-specific content branches (running→job link, error→restart button, booting→pulse indicator, offline→maintenance label with opacity-60 grayscale, idle→emulator info). Added `cardBorderStyles` and `wrapperStyles` D016 Record lookup maps for state-dependent styling.

Rewrote `devices/+page.svelte` template from flat bordered lists with 18 `farm-*` refs into: (a) FLEET_MANAGEMENT header with device count, (b) 5-state summary counter bar with `border-l-2` colored borders via `counterBorderStyles`/`counterTextStyles` Records, (c) ANDROID_ECOSYSTEM and IOS_SUITE platform sections with Material Symbols icons, (d) responsive card grid (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`). All script logic preserved exactly — `fetchDevices` polling, `handleRestart`, `getDevicesByPlatform`, `countByState`, `stateIndicators`, `onMount`/`onDestroy` lifecycle.

Initial build failed because `{@const}` was placed at the Svelte component top level. Fixed by converting to `$derived` in the script block per D017 — `{@const}` is only valid inside `{#each}`, `{#if}`, and similar blocks.

## Verification

- `npm run web:build` exits 0
- Zero `farm-*` in devices page and DeviceCard (grep -c returns 0 for both)
- Zero `bg-red-50` or `divide-y` in devices page
- ANDROID_ECOSYSTEM, IOS_SUITE, grid-cols, border-l-2, StatusBadge all present in devices page
- StatusBadge and opacity-60 present in DeviceCard
- Settings page still has farm-* tokens (expected — T03 scope)

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npm run web:build` | 0 | ✅ pass | 6.4s |
| 2 | `grep -c 'farm-' web/src/routes/devices/+page.svelte` | 1 (no match) | ✅ pass | 0s |
| 3 | `grep -c 'farm-' web/src/lib/components/devices/DeviceCard.svelte` | 1 (no match) | ✅ pass | 0s |
| 4 | `grep -c 'bg-red-50\|divide-y' web/src/routes/devices/+page.svelte` | 1 (no match) | ✅ pass | 0s |
| 5 | `grep 'ANDROID_ECOSYSTEM' web/src/routes/devices/+page.svelte` | 0 | ✅ pass | 0s |
| 6 | `grep 'IOS_SUITE' web/src/routes/devices/+page.svelte` | 0 | ✅ pass | 0s |
| 7 | `grep 'grid-cols' web/src/routes/devices/+page.svelte` | 0 | ✅ pass | 0s |
| 8 | `grep 'border-l-2' web/src/routes/devices/+page.svelte` | 0 | ✅ pass | 0s |
| 9 | `grep 'StatusBadge' web/src/routes/devices/+page.svelte` | 0 | ✅ pass | 0s |
| 10 | `grep 'StatusBadge' DeviceCard.svelte` | 0 | ✅ pass | 0s |
| 11 | `grep 'opacity-60' DeviceCard.svelte` | 0 | ✅ pass | 0s |
| 12 | `grep -r 'farm-' web/src/routes/devices/ DeviceCard.svelte` | 1 (no match) | ✅ pass | 0s |

### Slice-level checks (partial — T02 is task 2 of 3):

| # | Check | Status |
|---|-------|--------|
| 1 | `npm run web:build` exits 0 | ✅ pass |
| 2 | Zero farm-* in devices + DeviceCard | ✅ pass |
| 3 | Zero farm-* in login | ✅ pass (T01) |
| 4 | Zero farm-* in settings | ❌ expected (T03) |
| 5 | Zero divide-y in devices + login | ✅ pass |
| 6 | Devices page content markers | ✅ pass |
| 7 | Login page content markers | ✅ pass (T01) |

## Diagnostics

- **Device card borders:** Inspect any DeviceCard's outer `<div>` class list for state-specific border class from `cardBorderStyles` Record (e.g., `border-primary/30` for running state).
- **Summary counters:** 5 counter cards in a responsive grid, each with `border-l-2` + state-specific color. Counter value is the count of devices in that state.
- **Platform sections:** ANDROID_ECOSYSTEM and IOS_SUITE sections render conditionally based on device platform data. Each has a Material Symbols icon and device count.
- **Offline treatment:** Cards for offline devices get `opacity-60 grayscale` from `wrapperStyles` Record — visually distinguishable.
- **Error restart:** Error-state cards show RESTART button. Click triggers `handleRestart(id)` → API call → data refresh.

## Deviations

Used `$derived` instead of `{@const}` for DeviceCard's `borderClass` and `wrapperClass` at component top level. The plan's template used `{@const}` outside any block, which Svelte 5 disallows — `{@const}` must be the immediate child of `{#if}`, `{#each}`, etc. This is the D017 pattern documented in decisions.

## Known Issues

None.

## Files Created/Modified

- `web/src/routes/devices/+page.svelte` — Reskinned with FLEET_MANAGEMENT header, 5-state summary counters, ANDROID_ECOSYSTEM/IOS_SUITE platform sections, responsive card grid, zero farm-* tokens
- `web/src/lib/components/devices/DeviceCard.svelte` — Reskinned from horizontal row to vertical card with state-specific content, D016 Record lookup maps, zero farm-* tokens
- `.gsd/milestones/M002/slices/S05/tasks/T02-PLAN.md` — Added Observability Impact section (pre-flight fix)
