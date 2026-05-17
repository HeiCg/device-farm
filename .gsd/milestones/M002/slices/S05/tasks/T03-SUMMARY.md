---
id: T03
parent: S05
milestone: M002
provides:
  - Reskinned Settings page with bento grid layout, 4 modular config sections, zero farm-* tokens, zero divide-y borders
key_files:
  - web/src/routes/settings/+page.svelte
key_decisions: []
patterns_established:
  - Bento grid (grid-cols-12) for config display with asymmetric column spans (4+8 top row, 7+5 bottom row)
  - Metric card pattern for numeric config values (text-2xl font-bold centered in bg-surface-container)
  - Side-by-side platform sub-cards within a parent section (Android + iOS in Pool Orchestration)
observability_surfaces:
  - "GET /api/config request in network tab populates all 4 bento sections"
  - "Error banner with bg-tertiary/10 border-tertiary/20 on config fetch failure"
  - "grep -c 'farm-' returns 0 confirming complete token migration"
duration: 8m
verification_result: passed
completed_at: 2026-03-18
blocker_discovered: false
---

# T03: Reskin Settings page with bento grid config sections

**Reskinned Settings page from Jenkins-era vertical key-value stacks (69 farm-* refs, 10 divide-y occurrences) to Kinetic Console bento grid with 4 modular config sections — zero farm-* tokens and zero divide-y borders remain**

## What Happened

Rewrote the entire template of `settings/+page.svelte` (preserved script block exactly) from a flat vertical stack of bordered sections using `divide-y divide-farm-border` separators into a `grid grid-cols-12 gap-4` bento layout with 4 sections:

1. **SERVER_PARAMETERS** (col-span-4) — host, port, auth_enabled key-value pairs with `space-y-3` spacing
2. **POOL_ORCHESTRATION** (col-span-8) — max_devices accent number, Android + iOS platform sub-cards side-by-side in `grid-cols-2`
3. **JOB_EXECUTION_POLICY** (col-span-7) — 3 large metric cards for timeout, queue depth, cleanup days
4. **STORAGE_SUBSYSTEM** (col-span-5) — artifacts and logs key-value rows with a `border-white/5` separator

Header replaced with "DEVICE_FARM_CONFIG" headline + READ_ONLY badge. Loading/error states updated to dark theme tokens. All 69 `farm-*` token references eliminated. All `divide-y` occurrences eliminated (R024 compliance).

## Verification

- `npm run web:build` exits 0 — Svelte compiles cleanly, no type errors
- `grep -c 'farm-' settings/+page.svelte` = 0 (was 69)
- `grep -c 'divide-y' settings/+page.svelte` = 0 (was ~10)
- `grep -c 'bg-red-50' settings/+page.svelte` = 0
- All 8 required keywords found: DEVICE_FARM_CONFIG, READ_ONLY, grid-cols-12, SERVER_PARAMETERS, POOL_ORCHESTRATION, JOB_EXECUTION_POLICY, STORAGE_SUBSYSTEM, surface-container-low (11 total matches)
- Cross-file slice verification: zero `farm-*`, zero `divide-y`, zero `bg-red-50` across all 4 S05 files

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npm run web:build` | 0 | ✅ pass | 20.1s |
| 2 | `grep -c 'farm-' web/src/routes/settings/+page.svelte` | 0 | ✅ pass (count=0) | <1s |
| 3 | `grep -c 'divide-y' web/src/routes/settings/+page.svelte` | 1 | ✅ pass (count=0) | <1s |
| 4 | `grep -c 'bg-red-50' web/src/routes/settings/+page.svelte` | 1 | ✅ pass (count=0) | <1s |
| 5 | `grep 'DEVICE_FARM_CONFIG' web/src/routes/settings/+page.svelte` | 0 | ✅ pass | <1s |
| 6 | `grep 'READ_ONLY' web/src/routes/settings/+page.svelte` | 0 | ✅ pass | <1s |
| 7 | `grep 'grid-cols-12' web/src/routes/settings/+page.svelte` | 0 | ✅ pass | <1s |
| 8 | `grep 'SERVER_PARAMETERS' web/src/routes/settings/+page.svelte` | 0 | ✅ pass | <1s |
| 9 | `grep 'POOL_ORCHESTRATION' web/src/routes/settings/+page.svelte` | 0 | ✅ pass | <1s |
| 10 | `grep 'JOB_EXECUTION_POLICY' web/src/routes/settings/+page.svelte` | 0 | ✅ pass | <1s |
| 11 | `grep 'STORAGE_SUBSYSTEM' web/src/routes/settings/+page.svelte` | 0 | ✅ pass | <1s |
| 12 | `grep 'surface-container-low' web/src/routes/settings/+page.svelte` | 0 | ✅ pass | <1s |
| 13 | `grep -r 'farm-' (all S05 files)` | 1 | ✅ pass (count=0) | <1s |
| 14 | `grep -r 'divide-y\|divide-farm' (all S05 files)` | 1 | ✅ pass (count=0) | <1s |
| 15 | Settings keywords count (≥6 required) | 0 | ✅ pass (11 matches) | <1s |

## Diagnostics

- **Config load inspection:** `GET /api/config` in browser network tab — populates all 4 bento sections. Error banner (`bg-tertiary/10`) appears on fetch failure.
- **Section headings:** `browser_find` for text "SERVER_PARAMETERS", "POOL_ORCHESTRATION", "JOB_EXECUTION_POLICY", "STORAGE_SUBSYSTEM" confirms all sections rendered.
- **Token migration:** `grep -c 'farm-' web/src/routes/settings/+page.svelte` = 0 confirms zero legacy tokens.
- **R024 compliance:** `grep -c 'divide-y' web/src/routes/settings/+page.svelte` = 0 confirms no sectioning borders.

## Deviations

None — followed plan exactly.

## Known Issues

None.

## Files Created/Modified

- `web/src/routes/settings/+page.svelte` — Complete template reskin: bento grid layout with 4 config sections, zero farm-* tokens, zero divide-y borders
- `.gsd/milestones/M002/slices/S05/tasks/T03-PLAN.md` — Added missing Observability Impact section (pre-flight fix)
