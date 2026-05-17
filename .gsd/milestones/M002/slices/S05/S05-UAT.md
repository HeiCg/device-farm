# S05: Remaining Pages — Runners, Settings, Login — UAT

**Milestone:** M002
**Written:** 2026-03-18

## UAT Type

- UAT mode: mixed (artifact-driven + live-runtime)
- Why this mode is sufficient: Build verification confirms zero compilation errors and zero legacy tokens. Live-runtime checks confirm pages render with correct structure and data wiring. Visual fidelity is best confirmed by a human comparing against reference designs.

## Preconditions

- `npm run web:build` passes (already verified — exits 0)
- Server running: `npm run dev` from project root (needs PostgreSQL and config.yaml or config.dev.yaml)
- At least one device configured (or `DEVICE_FARM_CONFIG=config.dev.yaml` for empty device pool)
- Browser at `http://localhost:3000`

## Smoke Test

Navigate to `http://localhost:3000/login` (or clear your API key to trigger redirect). Confirm: dark background with purple/green gradient glow, "DEVICE_FARM" heading, and "INITIALIZE_SESSION" purple button visible. If this renders, the S05 foundation is working.

## Test Cases

### 1. Login — Visual Elements

1. Navigate to `/login` (clear localStorage `device-farm-api-key` if needed)
2. Confirm full-screen dark background with radial gradient glow (purple top, green bottom-right)
3. Confirm "DEVICE_FARM" heading text in Space Grotesk font
4. Confirm "COMMAND CENTER AUTHORIZATION" subtitle
5. Confirm "SYSTEM ACCESS KEY" label above the password input with a key icon
6. Confirm purple gradient "INITIALIZE_SESSION" button
7. Confirm "SYSTEM_ONLINE" footer text with animated green pulse dot
8. **Expected:** All 7 elements present. No white/light backgrounds. No `farm-*` era styling visible.

### 2. Login — Auth Flow Preserved

1. On `/login`, leave the API key field empty and click INITIALIZE_SESSION
2. **Expected:** Error banner appears with "Please enter an API key" in red/tertiary styling (tinted background, not bright red)
3. Enter an invalid API key and click INITIALIZE_SESSION
4. **Expected:** Error banner appears with "Invalid API key" or similar message, same tertiary styling
5. Enter a valid API key and click INITIALIZE_SESSION
6. **Expected:** Redirect to Dashboard. No navbar/sidebar visible on login page itself.

### 3. Login — No App Shell

1. On `/login`, confirm there is NO top navbar and NO left sidebar
2. **Expected:** Login renders as a standalone full-screen experience, not inside the app shell

### 4. Devices — Summary Counters

1. Log in and navigate to `/devices`
2. Confirm "FLEET_MANAGEMENT" heading at top with device count subtitle
3. Confirm 5 summary counter cards in a row: Idle, Running, Booting, Error, Offline
4. Each counter should have a colored left border (green for idle, purple for running, red for error, etc.)
5. **Expected:** Counter numbers match actual device states. Colors use tinted tokens, not bright raw colors.

### 5. Devices — Platform Groups

1. On `/devices`, scroll down past counters
2. Confirm "ANDROID_ECOSYSTEM" section header with Android icon
3. Confirm "IOS_SUITE" section header with iOS icon (if iOS devices exist)
4. Each section shows a responsive card grid of devices
5. **Expected:** Device cards are grouped by platform, not mixed. Grid is responsive (1 col on mobile, up to 4 on XL).

### 6. Devices — State-Specific Card Content

1. On `/devices`, inspect device cards in different states:
   - **Idle device:** Shows device name, emulator ID, platform badge
   - **Running device:** Shows device name + job ID as a clickable link (text-primary color)
   - **Error device:** Shows device name + "RESTART" button in tertiary styling
   - **Booting device:** Shows device name + "Booting..." text with pulse animation
   - **Offline device:** Entire card has reduced opacity (grayscale) with "MAINTENANCE" label
2. **Expected:** Each state renders different content. StatusBadge pill shows in all cards.

### 7. Devices — Restart Action

1. If an error-state device is present, click the "RESTART" button on its card
2. **Expected:** API call fires, device list refreshes. Button is styled with `bg-tertiary/10 text-tertiary`.

### 8. Settings — Page Header

1. Navigate to `/settings`
2. Confirm "DEVICE_FARM_CONFIG" heading in Space Grotesk font
3. Confirm "READ_ONLY" badge next to heading (purple tinted pill)
4. **Expected:** Header clearly signals this is a read-only config view.

### 9. Settings — Bento Grid Layout

1. On `/settings`, confirm 4 distinct sections in a grid layout:
   - **SERVER_PARAMETERS** (narrower, left column): host, port, auth_enabled
   - **POOL_ORCHESTRATION** (wider, right column): max_devices number, Android + iOS stacks side by side
   - **JOB_EXECUTION_POLICY** (bottom left, wider): 3 large metric cards (timeout, queue depth, cleanup days)
   - **STORAGE_SUBSYSTEM** (bottom right, narrower): artifacts path, retention, logs path
2. **Expected:** 4 sections visible in a 2×2-ish bento grid (not a flat vertical stack). Each section has its own card background.

### 10. Settings — Real Config Data

1. On `/settings`, verify that displayed values match actual server config (compare with `config.yaml` or `config.dev.yaml`)
2. Check that host, port, timeout values, artifact paths are real — not "localhost:3000" placeholders
3. **Expected:** All values come from the real `/api/config` endpoint. No hardcoded mock data.

### 11. Settings — No Divider Lines

1. On `/settings`, inspect all section boundaries
2. **Expected:** No horizontal rules, no `border-bottom` dividers between key-value pairs. Spacing uses `space-y-3` or tonal background shifts only.

## Edge Cases

### Login with JavaScript Disabled
1. Navigate to `/login` with JS disabled
2. **Expected:** Page may not function (SPA), but should not show a flash of white/light theme

### Devices with Empty Fleet
1. Navigate to `/devices` with no devices configured (use `config.dev.yaml`)
2. **Expected:** Summary counters all show 0. Platform sections show empty state message. No JS errors in console.

### Settings with Slow Network
1. Throttle network to Slow 3G, navigate to `/settings`
2. **Expected:** Loading skeleton with `animate-pulse` appears during config fetch. After load, all sections populate.

### Settings API Error
1. With server stopped or `/api/config` returning 500, navigate to `/settings`
2. **Expected:** Error banner appears in tertiary styling (red-tinted background). No white error states.

## Failure Signals

- Any white/light background on login, devices, or settings pages
- Any `farm-*` class visible in browser DevTools element inspector
- Horizontal rule (`<hr>`) or `divide-y` class visible in DOM
- Bright red (#ef4444 / bg-red-50) error states instead of tertiary-tinted
- Summary counters not appearing on Devices page
- Settings showing as flat vertical list instead of bento grid
- Build failures after any edit (`npm run web:build` must stay green)
- Console errors related to missing imports or undefined components

## Requirements Proved By This UAT

- R021 — Test cases 4, 5, 6, 7 prove summary counters, platform groups, state-specific cards, restart action
- R022 — Test cases 8, 9, 10, 11 prove READ_ONLY badge, bento grid, 4 config sections, real data, no dividers
- R023 — Test cases 1, 2, 3 prove cinematic login screen elements, auth flow, no app shell
- R024 — Test case 11 + visual inspection across all three pages proves no-line rule compliance
- R025 — Test case 6 proves status indicators on device cards use pill badges with correct token colors
- R012 — All test cases collectively prove zero farm-* visual artifacts across the final 3 pages
- R013 — Test cases 1, 8 prove Space Grotesk on page headings
- R014 — Visual inspection across all pages confirms surface-container tiers and ghost borders

## Not Proven By This UAT

- Pixel-perfect match to reference PNGs (requires side-by-side visual comparison, not scripted)
- Performance of backdrop-filter blur on low-end devices
- WebSocket streaming on Devices page (existing functionality, not changed by S05)
- Mobile responsive behavior of Devices card grid and Settings bento grid (needs viewport resize testing)

## Notes for Tester

- The only `farm-*` string in the codebase is `device-farm-api-key` in `auth-store.svelte.ts` — this is a localStorage key name, NOT a CSS token. It is expected and correct.
- Device card state-specific content depends on having devices in different states. If testing with `config.dev.yaml` (no device pools), all counters will show 0 and no cards will render. Use a config with actual emulator pools to test state-specific rendering.
- The Settings page is read-only by design — there are no form inputs. All values come from the server config file via the `/api/config` API.
- Error styling across all three pages uses tertiary tokens (red-tinted with transparency), not raw red colors. This is intentional.
