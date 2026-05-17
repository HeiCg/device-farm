---
id: T03
parent: S02
milestone: M002
provides:
  - Kinetic Console dark sidebar with COMMAND_CENTER header, restyled nav items with active right-border, dark-themed queue/executor/health sections
key_files:
  - web/src/lib/components/layout/Nav.svelte
key_decisions:
  - Used if/else blocks (not ternary) for active/inactive nav link styling, consistent with T01/T02 pattern for Tailwind v4 JIT static-string rule
patterns_established:
  - Sidebar data sections (queue, executor, health) use font-headline text-[10px] tracking-[0.2em] uppercase headers with text-on-surface-variant — consistent section header pattern for all sidebar widgets
observability_surfaces:
  - Health API polling (setInterval(fetchHealth, 5000)) preserved — /api/health calls visible in Network tab every 5s
  - Sidebar degrades gracefully on health API failure — silent catch shows stale/zero data
  - Executor state colors use semantic Kinetic Console tokens (text-secondary=running, text-tertiary=error, text-primary=transitional)
duration: 12m
verification_result: passed
completed_at: 2026-03-18
blocker_discovered: false
---

# T03: Rewrite Nav sidebar with COMMAND_CENTER header and restyled data sections

**Reskinned Nav.svelte from Jenkins light sidebar to Kinetic Console dark sidebar with COMMAND_CENTER header, w-64 width, active right-border nav items, and all data sections restyled to dark tonal palette — zero farm-* tokens remain.**

## What Happened

Complete visual rewrite of `Nav.svelte` (145→158 lines). All script logic preserved exactly: `fetchHealth`, `setInterval(fetchHealth, 5000)`, `onDestroy` cleanup, `queueDepth`/`executorDevices`/`healthPercent` derived values, `isActive()` function, all imports.

Changes made:
1. **Script section:** Updated `links` array labels (Build History→Jobs, Runners→Devices, Manage→Settings) and icons (history→terminal, devices→developer_board, manage_accounts→tune). Replaced all 8 `farm-*` token references in `deviceStateLabel()` with Kinetic Console tokens (`text-secondary` for Running, `text-on-surface-variant` for Idle, `text-primary` for Booting/Allocated, `text-primary/70` for Cleanup, `text-tertiary` for Error, `text-outline-variant` for Offline).
2. **Template rewrite:** Outer aside changed from `w-60 top-12 bg-farm-subtle` to `w-64 top-16 bg-background hidden md:flex`. Added COMMAND_CENTER header with green pulse dot (`bg-secondary animate-pulse`) and "DEVICE_FARM" brand. Nav items use if/else blocks for active state (`bg-primary/10 text-primary border-r-4 border-primary`) vs inactive (`text-on-surface-variant hover:bg-white/5 group`). Icon hover micro-interaction via `group-hover:translate-x-1`.
3. **Data sections restyled:** Build Queue uses `bg-surface-container-low` panel. Build Executor table uses `border-outline-variant/10` ghost borders. Node Health bar uses `bg-secondary` on `bg-surface-container-highest` track with `transition-all duration-500`.

## Verification

- `npm run web:build` exits 0 — confirmed
- Zero `farm-*` tokens in Nav.svelte — confirmed via grep (exit 1 = no matches)
- Zero old-theme tokens (`text-slate-*`, `bg-blue-600`, `border-slate`, `text-yellow-500`, `text-orange-500`) — confirmed
- All must-have patterns present: `hidden md:flex`, `w-64`, `COMMAND_CENTER`, `fetchHealth`, `setInterval`, `onDestroy`
- No excluded items: `RUN_NEW_JOB`, `DOCUMENTATION`, `SUPPORT` — all absent (grep count = 0)
- All 14 slice-level verification checks pass (this is the final task in S02)

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npm run web:build` | 0 | ✅ pass | 57.6s |
| 2 | `grep -rn 'farm-' web/src/routes/+layout.svelte web/src/lib/components/layout/` | 1 | ✅ pass (no matches) | <1s |
| 3 | `grep -l 'MobileNav' web/src/routes/+layout.svelte` | 0 | ✅ pass | <1s |
| 4 | `grep 'md:pl-64' web/src/routes/+layout.svelte` | 0 | ✅ pass | <1s |
| 5 | `grep 'pb-20' web/src/routes/+layout.svelte` | 0 | ✅ pass | <1s |
| 6 | `grep 'md:hidden' web/src/lib/components/layout/MobileNav.svelte` | 0 | ✅ pass | <1s |
| 7 | `grep 'hidden md:flex' web/src/lib/components/layout/Nav.svelte` | 0 | ✅ pass | <1s |
| 8 | `grep 'DEVICE_FARM' web/src/lib/components/layout/Header.svelte` | 0 | ✅ pass | <1s |
| 9 | `grep -rn 'RUN_NEW_JOB\|DOCUMENTATION\|SUPPORT\|Analytics\|Reports\|Test.Suites\|Logs' web/src/lib/components/layout/` | 1 | ✅ pass (no matches) | <1s |
| 10 | `grep 'h-16' web/src/lib/components/layout/Header.svelte` | 0 | ✅ pass | <1s |
| 11 | `grep 'w-64' web/src/lib/components/layout/Nav.svelte` | 0 | ✅ pass | <1s |
| 12 | `grep 'COMMAND_CENTER' web/src/lib/components/layout/Nav.svelte` | 0 | ✅ pass | <1s |
| 13 | `grep 'fetchHealth' web/src/lib/components/layout/Nav.svelte` | 0 | ✅ pass | <1s |
| 14 | `grep 'setInterval' web/src/lib/components/layout/Nav.svelte` | 0 | ✅ pass | <1s |

## Diagnostics

- **COMMAND_CENTER header:** Inspect sidebar top for green pulse dot (`bg-secondary animate-pulse`) and "DEVICE_FARM" brand text — if missing, check `text-primary` or `font-headline` token resolution
- **Active nav state:** Navigate routes and verify active link shows purple right border (`border-r-4 border-primary`) and tinted background (`bg-primary/10`); inactive links show `text-on-surface-variant`
- **Health API polling:** Network tab should show `/api/health` calls every 5s; sidebar sections (queue, executor, health bar) update from response data
- **Executor state colors:** Running=`text-secondary` (green), Error=`text-tertiary` (red), Booting/Allocated=`text-primary` (purple), Idle=`text-on-surface-variant` (muted)
- **Node Health bar:** `bg-secondary` fill on `bg-surface-container-highest` track — width animates via `transition-all duration-500`

## Deviations

- **`bg-white/5` grep false positive:** The plan's step 5 verification grep (`bg-white\b`) matches `bg-white/5` which the plan itself prescribes in step 2 for the dark sidebar hover state. This is a plan-internal contradiction — `hover:bg-white/5` is correct per design (5% white overlay on dark background), not the solid `bg-white` the grep was intended to catch. No code change needed; noted for plan accuracy.

## Known Issues

None.

## Files Created/Modified

- `web/src/lib/components/layout/Nav.svelte` — Complete reskin from Jenkins light sidebar to Kinetic Console dark sidebar (145→158 lines): COMMAND_CENTER header, restyled nav/queue/executor/health sections, all farm-* tokens replaced
- `.gsd/milestones/M002/slices/S02/tasks/T03-PLAN.md` — Added missing Observability Impact section (pre-flight fix)
