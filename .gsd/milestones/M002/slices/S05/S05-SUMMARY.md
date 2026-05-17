---
id: S05
parent: M002
milestone: M002
provides:
  - Cinematic dark login page with kinetic-gradient background, glass card, INITIALIZE_SESSION CTA
  - Fleet management Devices page with 5-state summary counters, platform-grouped card grid, state-specific DeviceCard content
  - Bento grid Settings page with 4 modular config sections (Server Parameters, Pool Orchestration, Job Execution Policy, Storage Subsystem)
  - .kinetic-gradient CSS class in app.css
  - Zero farm-* tokens remaining in entire web app — milestone token migration complete
requires:
  - slice: S01
    provides: Color tokens (@theme), font families, .glass-card class, StatusBadge component
  - slice: S02
    provides: Layout shell (+layout.svelte with offsets), login bypass via onLoginPage
key_files:
  - web/src/routes/login/+page.svelte
  - web/src/routes/devices/+page.svelte
  - web/src/routes/settings/+page.svelte
  - web/src/lib/components/devices/DeviceCard.svelte
  - web/src/app.css
key_decisions:
  - Used $derived instead of {@const} for DeviceCard state-dependent classes (D017 compliance)
patterns_established:
  - Login page renders outside app shell as full-screen kinetic-gradient with glass card
  - Summary counter bar with border-l-2 + Record lookup maps for state-specific colors (Devices)
  - Bento grid (grid-cols-12) with asymmetric column spans for config display (Settings)
  - Metric card pattern for numeric config values (text-2xl font-bold centered)
  - DeviceCard uses $derived for state-dependent border/wrapper classes; {@const} only inside blocks
  - Error states consistently use tertiary tokens (bg-tertiary/10 border-tertiary/20 text-tertiary)
observability_surfaces:
  - Login auth error: tertiary-styled banner visible in DOM with error message text
  - Device card borders: cardBorderStyles Record controls border color by state (primary/30 running, tertiary/30 error)
  - Summary counters: counterBorderStyles/counterTextStyles Records show count per device state
  - Offline devices: opacity-60 grayscale treatment from wrapperStyles Record
  - Settings config load: GET /api/config populates all 4 bento sections; animate-pulse skeleton during fetch
drill_down_paths:
  - .gsd/milestones/M002/slices/S05/tasks/T01-SUMMARY.md
  - .gsd/milestones/M002/slices/S05/tasks/T02-SUMMARY.md
  - .gsd/milestones/M002/slices/S05/tasks/T03-SUMMARY.md
duration: 22m
verification_result: passed
completed_at: 2026-03-18
---

# S05: Remaining Pages — Runners, Settings, Login

**Reskinned the final three routes (Login, Devices, Settings) to Kinetic Console dark theme — zero farm-* tokens remain in the entire web application, completing the M002 visual overhaul**

## What Happened

Three tasks executed in sequence, each reskinning one page.

**T01 (Login):** Added `.kinetic-gradient` CSS class to `app.css` (dual radial-gradient with primary/background). Rewrote the login template from 42 lines of `farm-*` styled markup to a cinematic full-screen auth screen: ambient blur orbs, backdrop-blur glass card, terminal icon, "DEVICE_FARM" headline in `font-headline text-primary`, "COMMAND CENTER AUTHORIZATION" subtitle, SYSTEM ACCESS KEY labeled password input, purple gradient INITIALIZE_SESSION button, and SYSTEM_ONLINE footer with animated green pulse dot. All auth logic preserved byte-for-byte. Error state uses tertiary tokens. 9 farm-* refs eliminated.

**T02 (Devices + DeviceCard):** Rewrote `DeviceCard.svelte` from a horizontal flex row into a vertical card with five state-specific content branches (idle→emulator info, running→job link, error→restart button, booting→pulse indicator, offline→opacity-60 grayscale + MAINTENANCE label). Added `cardBorderStyles` and `wrapperStyles` D016 Record lookup maps. Rewrote the Devices page with FLEET_MANAGEMENT header, 5-state summary counter bar (border-l-2 colored borders via Record maps), ANDROID_ECOSYSTEM and IOS_SUITE platform sections with Material Symbols icons, and responsive card grid (grid-cols-1 to xl:grid-cols-4). All script logic preserved — polling, restart, grouping, counting. 25 farm-* refs eliminated (18 page + 7 card). One build fix: converted `{@const}` to `$derived` per D017.

**T03 (Settings):** Rewrote the settings template from flat bordered `divide-y divide-farm-border` key-value stacks into a `grid grid-cols-12 gap-4` bento layout with 4 sections: SERVER_PARAMETERS (col-span-4), POOL_ORCHESTRATION (col-span-8 with Android+iOS side-by-side), JOB_EXECUTION_POLICY (col-span-7 with 3 metric cards), STORAGE_SUBSYSTEM (col-span-5). Header shows "DEVICE_FARM_CONFIG" + READ_ONLY badge. 69 farm-* refs and 10 divide-y occurrences eliminated.

## Verification

All slice-level checks pass:

| # | Check | Result |
|---|-------|--------|
| 1 | `npm run web:build` exits 0 | ✅ pass |
| 2 | Zero `farm-*` in login, devices, settings, DeviceCard | ✅ pass (grep returns 1 / no matches) |
| 3 | Zero `bg-red-50\|border-farm\|text-farm\|bg-farm` in S05 files | ✅ pass |
| 4 | Zero `divide-y\|divide-farm` in S05 files | ✅ pass |
| 5 | Login markers: DEVICE_FARM, INITIALIZE_SESSION, COMMAND CENTER AUTHORIZATION, kinetic-gradient, bg-background | ✅ all 5 found |
| 6 | Devices markers: ANDROID_ECOSYSTEM, IOS_SUITE, grid-cols, border-l-2, StatusBadge | ✅ all 5 found |
| 7 | Settings markers: DEVICE_FARM_CONFIG, READ_ONLY, grid-cols-12, SERVER_PARAMETERS, POOL_ORCHESTRATION, JOB_EXECUTION, STORAGE_SUBSYSTEM, surface-container-low | ✅ 11 matches (≥6 required) |
| 8 | Milestone-wide: zero `farm-*` CSS tokens in web/src/ | ✅ pass (only `device-farm-api-key` localStorage key in auth-store) |
| 9 | Milestone-wide: zero `divide-y` in web/src/ | ✅ pass |
| 10 | Milestone-wide: zero `bg-red-50` in web/src/ | ✅ pass |

## Requirements Advanced

- R012 — Final page-level farm-* usages eliminated (103 refs across 4 files). Zero farm-* CSS tokens remain in entire web/src. Ready for validation.
- R013 — Login uses font-headline on DEVICE_FARM heading, Devices uses font-headline on FLEET_MANAGEMENT and platform headers, Settings uses font-headline on DEVICE_FARM_CONFIG. Fonts applied across all pages. Ready for validation.
- R014 — Settings sections use surface-container-low cards with border-white/5 ghost borders. DeviceCard uses surface-container-high with border-outline-variant/10. Login uses glass card pattern on auth form. All S05 surfaces comply. Ready for validation.
- R025 — DeviceCard uses StatusBadge for state display. Summary counter bar uses secondary/tertiary/primary/surface-variant colors via Record maps for state-specific border colors. All status indicators use pill badges. Ready for validation.

## Requirements Validated

- R021 — Devices page has 5-state summary counters (Idle/Running/Booting/Error/Offline), ANDROID_ECOSYSTEM + IOS_SUITE platform groups, responsive card grid (4-column on XL), state-specific DeviceCard content (idle→OS info, running→job link, error→restart button, booting→pulse, offline→grayscale+MAINTENANCE).
- R022 — Settings page has DEVICE_FARM_CONFIG headline + READ_ONLY badge, grid-cols-12 bento layout with 4 sections: Server Parameters, Pool Orchestration (Android+iOS side-by-side), Job Execution Policy (3 metric cards), Storage Subsystem. All from real /api/config data.
- R023 — Login has full-screen dark with terminal icon, DEVICE_FARM headline in Space Grotesk, COMMAND CENTER AUTHORIZATION subtitle, SYSTEM ACCESS KEY input with key icon, purple gradient INITIALIZE_SESSION button, SYSTEM_ONLINE footer with green pulse dot.
- R024 — Zero divide-y and zero border-farm-border across all S05 files. Boundaries via surface-container tiers, space-y spacing, and ghost borders (border-white/5, border-outline-variant/10). Combined with S01-S04 proofs, no-line rule fully validated across entire app.
- R025 — DeviceCard uses StatusBadge for pill badges. Summary counters use secondary (idle), tertiary (error), primary (running), surface-variant (offline/booting) via Record maps. Combined with S01-S04 proofs, status indicators fully validated across all pages.
- R012 — 51 tokens in @theme, zero farm-* CSS class usages in entire web/src (only `device-farm-api-key` localStorage key remains, which is not a CSS token).
- R013 — Google Fonts CDN loads Space Grotesk + Inter. font-headline used on all page headings (DEVICE_FARM, FLEET_MANAGEMENT, DEVICE_FARM_CONFIG, etc.). font-body/font-label used across body text and labels.
- R014 — glass-card class on login auth form, surface-container tiers across all pages, ghost borders at ≤15% opacity throughout. No 1px solid borders for sectioning.

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

Used `$derived` instead of `{@const}` for DeviceCard's `borderClass` and `wrapperClass` at component top level. The plan used `{@const}` outside block contexts, which Svelte 5 disallows. This is the established D017 pattern — not a design deviation, just a Svelte 5 syntax constraint.

## Known Limitations

- none — S05 is the final slice; all routes are reskinned

## Follow-ups

- none — M002 milestone is feature-complete after S05

## Files Created/Modified

- `web/src/app.css` — Added `.kinetic-gradient` CSS class (radial gradient background utility)
- `web/src/routes/login/+page.svelte` — Complete template reskin to cinematic dark auth screen
- `web/src/routes/devices/+page.svelte` — Complete template reskin with summary counters, platform groups, card grid
- `web/src/lib/components/devices/DeviceCard.svelte` — Reskinned from horizontal row to vertical card with state-specific content
- `web/src/routes/settings/+page.svelte` — Complete template reskin to bento grid with 4 config sections

## Forward Intelligence

### What the next slice should know
- There is no next slice — S05 is the final slice in M002. The milestone is feature-complete. All 6 routes render with the Kinetic Console dark theme, all data wiring is preserved, and `npm run web:build` succeeds.

### What's fragile
- The `kinetic-gradient` CSS class uses hardcoded color values (not tokens) for the radial gradient stops — if the primary color token changes, this class needs manual update.

### Authoritative diagnostics
- `grep -r 'farm-' web/src/ --include='*.svelte' --include='*.ts'` — the definitive check for legacy token contamination. Currently returns only `device-farm-api-key` (localStorage key, not CSS).
- `npm run web:build` — catches all Svelte compilation errors, missing imports, and type errors in one command.

### What assumptions changed
- The plan estimated 103 farm-* refs across S05 files. Actual count was similar (9+18+7+69=103). No surprises.
