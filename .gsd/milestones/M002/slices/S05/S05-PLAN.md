# S05: Remaining Pages — Runners, Settings, Login

**Goal:** Reskin the final three routes (Login, Devices, Settings) to Kinetic Console dark theme, eliminating all remaining `farm-*` tokens from page-level components.
**Demo:** Login shows cinematic full-screen dark auth with gradient CTA. Devices shows summary counters + platform-grouped card grid with state-specific content. Settings shows bento grid with modular config sections. All three use real API data (no mocks). `npm run web:build` succeeds.

## Must-Haves

- All `farm-*` token references removed from `login/+page.svelte`, `devices/+page.svelte`, `settings/+page.svelte`, `DeviceCard.svelte` (103 total)
- Login: full-screen dark with radial gradient, "DEVICE_FARM" headline (D010), "COMMAND CENTER AUTHORIZATION" subtitle, SYSTEM ACCESS KEY input, purple gradient INITIALIZE_SESSION button, system status footer with green pulse
- Devices: summary counter bar (Idle/Running/Booting/Error/Offline counts), ANDROID_ECOSYSTEM / IOS_SUITE platform sections, responsive card grid, state-specific card content (idle→emulator info, running→job link, error→restart button, booting→indicator, offline→maintenance label with opacity-60 grayscale)
- Settings: "DEVICE_FARM_CONFIG" headline + READ_ONLY badge, bento grid (grid-cols-12): Server Parameters, Pool Orchestration (Android + iOS side-by-side), Job Execution Policy, Storage Subsystem — all from real `/api/config` data only
- No-line rule (R024): zero `divide-y`, zero `border-farm-border`, zero 1px solid sectioning borders — tonal shifts and ghost borders only
- D016 compliance: all state-dependent styling via static Record lookup maps, never `bg-${color}`
- Auth logic, API wiring, polling intervals, event handlers preserved exactly

## Verification

- `npm run web:build` exits 0
- `grep -r 'farm-' web/src/routes/devices/ web/src/routes/settings/ web/src/routes/login/ web/src/lib/components/devices/DeviceCard.svelte` returns zero matches
- `grep -r 'bg-red-50\|border-farm\|text-farm\|bg-farm' web/src/routes/devices/ web/src/routes/settings/ web/src/routes/login/ web/src/lib/components/devices/DeviceCard.svelte` returns zero matches
- `grep -r 'divide-y\|divide-farm' web/src/routes/devices/ web/src/routes/settings/ web/src/routes/login/ web/src/lib/components/devices/DeviceCard.svelte` returns zero matches
- Login page: `grep -P 'DEVICE_FARM|INITIALIZE_SESSION|COMMAND CENTER AUTHORIZATION|kinetic-gradient|bg-background' web/src/routes/login/+page.svelte` matches all 5
- Devices page: `grep -P 'ANDROID_ECOSYSTEM|IOS_SUITE|grid-cols|border-l-2|StatusBadge' web/src/routes/devices/+page.svelte` matches all 5
- Settings page: `grep -P 'DEVICE_FARM_CONFIG|READ_ONLY|grid-cols-12|SERVER_PARAMETERS|POOL_ORCHESTRATION|JOB_EXECUTION|STORAGE_SUBSYSTEM|surface-container-low' web/src/routes/settings/+page.svelte` — at least 6 matches

## Integration Closure

- Upstream surfaces consumed: `app.css` (tokens, glass-card, font families from S01), `+layout.svelte` (shell offsets from S02, login bypass via `onLoginPage`), `StatusBadge.svelte` (S01), `$lib/api/client.js`, `$lib/api/devices.js`, `$lib/api/types.js`, `$lib/auth/auth-store.svelte.js`
- New wiring introduced in this slice: `.kinetic-gradient` CSS class in `app.css` (login background)
- What remains before the milestone is truly usable end-to-end: nothing — S05 is the final slice

## Tasks

- [x] **T01: Reskin Login page to cinematic dark auth screen** `est:20m`
  - Why: Closes R023. Login is the first impression and renders outside the app shell. Simplest of the three pages (74 lines, 9 farm-* refs, no API data wiring). Also adds `.kinetic-gradient` CSS class to app.css.
  - Files: `web/src/routes/login/+page.svelte`, `web/src/app.css`
  - Do: Add `.kinetic-gradient` class to app.css (radial-gradient with primary/background). Rewrite login template: full-screen `min-h-screen bg-background kinetic-gradient` container, ambient blur orbs (decorative divs with absolute positioning), centered glass-panel card, terminal icon (`settings_input_component`), "DEVICE_FARM" headline in `font-headline text-primary`, "COMMAND CENTER AUTHORIZATION" subtitle, SYSTEM ACCESS KEY label + input with key icon, purple gradient INITIALIZE_SESSION button (`bg-gradient-to-r from-primary to-primary/70`), system status footer with green pulse dot + "SYSTEM_ONLINE" text. Error state uses `bg-tertiary/10 border-tertiary/20 text-tertiary`. All 9 farm-* refs replaced. Auth logic (`handleSubmit`, `setApiKey`, `clearApiKey`, `apiFetch`) preserved exactly.
  - Verify: `npm run web:build` exits 0; zero `farm-*` matches in login page; grep confirms DEVICE_FARM, INITIALIZE_SESSION, COMMAND CENTER AUTHORIZATION, kinetic-gradient, bg-background all present
  - Done when: Login page has zero farm-* tokens, builds successfully, contains all R023 required elements

- [x] **T02: Reskin Devices page and DeviceCard with summary counters and platform-grouped card grid** `est:30m`
  - Why: Closes R021. Most complex of the three pages — transforms flat table rows into summary counter bento + responsive card grid with state-specific content. Also advances R024 (no-line rule) and R025 (status indicators on device cards).
  - Files: `web/src/routes/devices/+page.svelte`, `web/src/lib/components/devices/DeviceCard.svelte`
  - Do: **Devices page**: Replace header with "FLEET_MANAGEMENT" headline + device count subtitle. Add summary counter bar — 5 counters in `flex gap-3` row, each `bg-surface-container-low p-4 rounded-lg border-l-2` with state-specific border color (D016 Record map), large count number, state label. Replace platform sections with ANDROID_ECOSYSTEM / IOS_SUITE headers (icon in `p-2 bg-primary/10 rounded-lg` + `font-headline font-bold text-sm tracking-widest`). Replace bordered list containers with responsive card grid (`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4`). Loading skeleton uses `bg-surface-container-high animate-pulse`. Error/empty states use dark tokens. All 18 farm-* refs replaced. **DeviceCard**: Transform from horizontal flex row to vertical card (`bg-surface-container-high p-4 rounded-lg border border-outline-variant/10`). State-specific border color via Record map (running→`border-primary/30`, error→`border-tertiary/30`, idle→`border-outline-variant/10`). State-specific content sections: idle→name/emulatorId/platform badge, running→name + job ID link in `text-primary`, error→name + restart button (`bg-tertiary/10 text-tertiary border-tertiary/20`), booting→name + "Booting..." pulse indicator, offline→full card `opacity-60 grayscale` + "MAINTENANCE" label. StatusBadge kept. Platform badge uses `bg-surface-container-low text-on-surface-variant`. All 7 farm-* refs replaced. All script logic preserved exactly (fetchDevices, handleRestart, getDevicesByPlatform, countByState, polling).
  - Verify: `npm run web:build` exits 0; zero `farm-*` in both files; grep confirms ANDROID_ECOSYSTEM, IOS_SUITE, grid-cols, border-l-2, StatusBadge in devices page
  - Done when: Devices page + DeviceCard have zero farm-* tokens, builds successfully, contains all R021 required elements (summary counters, platform groups, state-specific cards, responsive grid)

- [x] **T03: Reskin Settings page with bento grid config sections** `est:25m`
  - Why: Closes R022. Highest token count (69 farm-* refs) but structurally repetitive — all `divide-y divide-farm-border` key-value sections become tonal bento grid cards. Final page to reskin — completing this means zero farm-* tokens remain in the entire web app.
  - Files: `web/src/routes/settings/+page.svelte`
  - Do: Replace header with "DEVICE_FARM_CONFIG" headline in `font-headline` + READ_ONLY badge (`bg-primary/10 text-primary text-xs px-2 py-0.5 rounded`). Restructure body into `grid grid-cols-12 gap-4` bento layout. **Server Parameters** (col-span-4): `bg-surface-container-low rounded-xl p-6 border border-white/5`, section header icon (`dns` in `p-2 bg-primary/10 rounded-lg`) + "SERVER_PARAMETERS" in `font-headline text-sm tracking-widest`, key-value pairs with `text-on-surface-variant` labels and `text-on-surface font-mono` values, spaced with `space-y-3` (no divide-y). **Pool Orchestration** (col-span-8): same card pattern, "POOL_ORCHESTRATION" header, Android + iOS stacks side-by-side in `grid grid-cols-2 gap-4`, each with platform sub-header, enabled badge, config values. Max devices shown as accent number. **Job Execution Policy** (col-span-7): "JOB_EXECUTION_POLICY" header, timeout/queue/cleanup as large metric cards (`text-2xl font-bold text-on-surface` number + `text-on-surface-variant text-xs` label) in a `grid grid-cols-3 gap-3`. **Storage Subsystem** (col-span-5): "STORAGE_SUBSYSTEM" header, artifacts path/retention/compression + logs path/retention as spaced key-value rows. All 69 farm-* refs replaced. All `divide-y` eliminated (R024). Loading/error states use dark tokens. Config data mapping preserved exactly.
  - Verify: `npm run web:build` exits 0; zero `farm-*` in settings page; zero `divide-y` matches; grep confirms DEVICE_FARM_CONFIG, READ_ONLY, grid-cols-12, SERVER_PARAMETERS, POOL_ORCHESTRATION, JOB_EXECUTION, STORAGE_SUBSYSTEM, surface-container-low
  - Done when: Settings page has zero farm-* tokens, zero divide-y borders, builds successfully, contains all R022 required elements (bento grid, 4 modular sections, READ_ONLY badge)

## Observability / Diagnostics

- **Login page auth failure:** Error state renders a `bg-tertiary/10` banner with the error message text — visible in the DOM as a `<div>` with tertiary border. Browser console shows no JS errors on auth failure (only the UI error banner).
- **Device card state transitions:** Each device card's border color changes via static Record lookup maps (D016). Current state is inspectable via the `StatusBadge` component text and the card's `border-l-2` color class.
- **Settings config load:** The `/api/config` fetch populates all bento sections. A loading skeleton (`animate-pulse`) is shown during fetch; an error banner appears on failure. Network tab shows the `GET /api/config` request status.
- **Build verification:** `npm run web:build` is the primary gate — any Svelte compilation error, missing import, or type error surfaces here. Zero `farm-*` grep matches confirm complete token migration.
- **Redaction:** No secrets are rendered. The login page's API key input is `type="password"`. The settings page shows server config (ports, paths, timeouts) which are non-sensitive operational parameters.

## Files Likely Touched

- `web/src/routes/login/+page.svelte`
- `web/src/routes/devices/+page.svelte`
- `web/src/routes/settings/+page.svelte`
- `web/src/lib/components/devices/DeviceCard.svelte`
- `web/src/app.css`
