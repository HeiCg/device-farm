# S05: Remaining Pages — Runners, Settings, Login — Research

**Date:** 2026-03-18
**Depth:** Light-to-targeted — three independent page reskins applying established patterns from S01–S04. No new technology, no ambiguous requirements. Reference PNGs and HTMLs are comprehensive.

## Summary

S05 reskins the final three routes: Devices (`/devices`), Settings (`/settings`), and Login (`/login`). All three currently use `farm-*` M001-era tokens (103 total occurrences across 4 files). The work is pattern application — replacing tokens and restructuring templates to match the reference designs — using the same Kinetic Console components and conventions proven in S01–S04.

The three pages are fully independent: Devices page reads from `/api/devices`, Settings reads from `/api/config`, Login uses the existing auth store. No cross-page data flows. The planner can decompose into parallel tasks if desired.

Key adaptation: the reference designs include mock data surfaces (AUTOMATED_CLEANUP_RULES, STORAGE_CAPACITY bar, IO throughput, CPU load, decorative counters) that must be excluded per D013. Settings must only display what the `/api/config` endpoint actually returns. Devices must only show fields present in the `Device` type (`id`, `name`, `platform`, `state`, `emulatorId`, `currentJobId`).

## Recommendation

Three independent tasks, one per page. No build-order dependency between them. Login is the simplest (no API data, purely visual). Settings is moderate (flat config object → bento grid layout). Devices is the most work (table rows → card grid with state-specific content + summary counters).

## Implementation Landscape

### Key Files

- `web/src/routes/devices/+page.svelte` — **18 farm-* refs.** Currently a flat list with table-row DeviceCards inside bordered containers. Must become: summary counter bento at top (5 state counters with large numbers + colored bars), platform-grouped sections (ANDROID_ECOSYSTEM / IOS_SUITE headers with icon + gradient line), responsive card grid (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`). All script logic intact (fetchDevices, handleRestart, getDevicesByPlatform, countByState, stateIndicators, polling).
- `web/src/lib/components/devices/DeviceCard.svelte` — **7 farm-* refs.** Currently a horizontal flex row. Must become a full card (`bg-surface-container-high p-4 rounded-lg border`) with state-specific content sections: idle→emulator info, running→job ID + link, error→restart button, booting→progress indicator, offline→maintenance label. StatusBadge already works (pill style from S01). State-specific border colors (running→`border-primary/30`, error→`border-tertiary/30`, others→`border-outline-variant/10`).
- `web/src/routes/settings/+page.svelte` — **69 farm-* refs.** Currently a vertical stack of bordered key-value sections. Must become: headline ("DEVICE_FARM_CONFIG" + READ_ONLY badge), bento grid layout (`grid-cols-12`): Server Parameters (col-4 with host/port/uptime), Pool Orchestration (col-8 with Android + iOS stacks side-by-side + max_devices bar), Job Execution Policy (col-7 with timeout/queue/cleanup as large metric cards), Storage Subsystem (col-5 with log path/retention/compression). Each section uses `bg-surface-container-low rounded-xl p-6 border border-white/5` with icon + title header pattern.
- `web/src/routes/login/+page.svelte` — **9 farm-* refs.** Currently a simple centered form with `bg-farm-subtle`. Must become: full-screen dark with radial gradient background (`kinetic-gradient` CSS class), ambient blur orbs, centered card with glass-panel styling, terminal icon, "DEVICE_FARM" headline (D010 — not KINETIC_CONSOLE), "COMMAND CENTER AUTHORIZATION" subtitle, SYSTEM ACCESS KEY input with key icon, purple gradient INITIALIZE_SESSION button, system status footer with green pulse dot. Auth logic (`handleSubmit`, `setApiKey`, `clearApiKey`, `apiFetch('/admin/keys')`) stays identical.

### Patterns to Apply (established in S01–S04)

- **D016 static class strings:** All state-dependent styling via Record lookup maps (e.g., `borderStyles`, `cardStyles`). Never `bg-${color}`. Already used in StatusBadge, JobCard, StepList.
- **D017 `$derived` for reactive lookups:** Use `$derived` at component top level, `{@const}` only inside `{#each}` / `{#if}` blocks.
- **Glass card class:** `glass-card` from `app.css` for Settings sections. Surface-container tiers for tonal depth.
- **R024 no-line rule:** Boundaries via background color shifts (`surface-container-low` → `surface-container-high`), ghost borders (`border-white/5`, `border-outline-variant/10`). No `1px solid` sectioning borders.
- **Section header pattern:** Icon in `p-2 bg-primary/10 rounded-lg` + `font-headline font-bold text-sm tracking-widest` (from reference settings HTML).
- **Summary counter pattern:** `bg-surface-container-low p-5 rounded-lg border-l-2 border-{status}/40` with label, large number, progress bar (from reference runners HTML).
- **Nav sidebar device state colors** (from S02): `text-secondary` (Running), `text-on-surface-variant` (Idle), `text-primary` (Booting), `text-tertiary` (Error), `text-outline-variant` (Offline).

### Data Available from APIs

**`/api/config` returns (for Settings):**
```
server: { host, port }
pool: { max_devices, android: { enabled, max_instances, headless, api_level, device_profile, ram_mb }, ios: { enabled, max_instances, runtime, device_type } }
storage: { artifacts: { path, retention_days, compress_after_days, format, max_storage_gb }, logs: { path, retention_days } }
jobs: { timeout_minutes, max_queue_size, cleanup_completed_after_days }
auth: { enabled }
```

**`Device` type (for Devices):** `id, name, platform, state, emulatorId, currentJobId`

Note: Device type does NOT have OS version, host, hardware info, or error codes shown in the reference. State-specific card content must adapt to available fields only.

### Reference Elements to EXCLUDE (per D013, D011, D012)

- Settings: AUTOMATED_CLEANUP_RULES section (mock), STORAGE_CAPACITY gradient bar (mock), bottom console stats (IO_Throughput, CPU_Load, Network_Latency — mock), footer metadata, EXPORT_JSON button (no endpoint), EDIT_MODE button
- Devices: CONNECT button (no functionality), FAB (+) button (D012), decorative counters with fake numbers
- Login: LOC coordinates, ENV metadata, CID identifier, spinning circle decoration (optional decorative — include if planner deems worthwhile, exclude if scope-trimming)
- All pages: RUN_NEW_JOB (D012), TEST_SUITES/REPORTS/ANALYTICS/LOGS nav items (D011), DOCUMENTATION/SUPPORT links

### Build Order

All three pages are independent — no cross-dependencies. Suggested order for verification clarity:

1. **Login page** — Simplest to verify (no API dependencies, purely visual). Proves the full-screen-outside-shell pattern works with new design.
2. **Devices page** — Most complex (summary counters + state-specific cards). Highest value — validates R021 which is the most detailed requirement.
3. **Settings page** — Moderate complexity (bento grid + config data mapping). Validates R022.

### Verification Approach

1. `npm run web:build` exits 0
2. `grep -r 'farm-' web/src/routes/devices/ web/src/routes/settings/ web/src/routes/login/ web/src/lib/components/devices/DeviceCard.svelte` returns zero matches
3. `grep -r 'bg-red-50\|bg-farm\|border-farm\|text-farm' web/src/routes/devices/ web/src/routes/settings/ web/src/routes/login/ web/src/lib/components/devices/DeviceCard.svelte` returns zero matches (catches light-theme remnants)
4. `grep -r 'border-b border-\|divide-y\|border-farm-border' web/src/routes/devices/ web/src/routes/settings/ web/src/routes/login/ web/src/lib/components/devices/DeviceCard.svelte` returns zero matches (R024 — no 1px solid sectioning borders)
5. Login page: grep for `DEVICE_FARM` (D010), `INITIALIZE_SESSION`, `COMMAND CENTER AUTHORIZATION`, `bg-background`, `glass-panel` or glass-card usage
6. Devices page: grep for `ANDROID_ECOSYSTEM\|IOS_SUITE` section headers (or "Android"/"iOS" with headline font), `grid-cols` responsive grid, `StatusBadge` import, `border-l-2` summary counters
7. Settings page: grep for `DEVICE_FARM_CONFIG\|READ_ONLY`, `grid-cols-12`, `SERVER_PARAMETERS\|POOL_ORCHESTRATION\|JOB_EXECUTION`, `surface-container-low`

## Constraints

- **Device type is limited:** Only 6 fields available (`id, name, platform, state, emulatorId, currentJobId`). Reference shows OS version, host, error codes, progress percentage — these don't exist. Card content must adapt: idle shows name/emulatorId/platform, running shows name + job link, error shows name + restart button, booting shows name + "Booting..." indicator.
- **Login renders outside shell:** `+layout.svelte` already handles this with `onLoginPage` check — login page gets bare `{@render children()}` without Header/Nav/MobileNav. The login page must provide its own `min-h-screen bg-background` container.
- **Config API is flat:** No uptime data, no storage capacity used/total. Reference mock elements like "99.98% uptime" and "1.76 TB / 2.00 TB" capacity bars cannot be shown.

## Common Pitfalls

- **Settings `divide-y` must go:** Current settings template uses `divide-y divide-farm-border` extensively for key-value rows. These are 1px solid borders and violate R024. Replace with spacing (`space-y-3`) and tonal background shifts.
- **Login gradient CSS class:** The reference uses a custom `.kinetic-gradient` CSS class with `radial-gradient`. This needs to be added to `app.css` (or as a `<style>` block in login page) — it's not a Tailwind utility.
- **Offline card opacity:** Reference shows offline devices with `opacity-60 grayscale`. This is a visual treatment applied at the card wrapper level, not via StatusBadge. Use if/else block for offline state to add these classes (D016 compliance).
