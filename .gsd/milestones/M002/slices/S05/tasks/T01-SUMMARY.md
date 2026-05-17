---
id: T01
parent: S05
milestone: M002
provides:
  - Cinematic dark auth screen for Login page with zero farm-* tokens
  - .kinetic-gradient CSS class in app.css for radial gradient backgrounds
key_files:
  - web/src/routes/login/+page.svelte
  - web/src/app.css
key_decisions:
  - None — followed plan exactly
patterns_established:
  - Login page is self-contained full-screen (no app shell) with kinetic-gradient background, blur orbs, glass card pattern
  - Error states use tertiary tokens (bg-tertiary/10 border-tertiary/20 text-tertiary) instead of bg-red-50/farm-danger
observability_surfaces:
  - Auth error banner visible in DOM as tertiary-styled div with error text
  - Login form discoverable via accessibility tree (h1 DEVICE_FARM, input id=api-key, button INITIALIZE_SESSION)
duration: 6m
verification_result: passed
completed_at: 2026-03-18
blocker_discovered: false
---

# T01: Reskin Login page to cinematic dark auth screen

**Reskinned Login page from Jenkins-era light theme to cinematic dark auth screen with radial gradient background, glass card, purple gradient CTA, and system status footer — zero farm-* tokens remain**

## What Happened

Added `.kinetic-gradient` CSS class to `app.css` with a dual radial-gradient (purple at top, green at bottom-right) over the background color. Rewrote the login page template from 42 lines of `farm-*` styled markup to the Kinetic Console design: full-screen dark container with ambient blur orbs, backdrop-blur glass card, terminal icon, DEVICE_FARM headline, COMMAND CENTER AUTHORIZATION subtitle, SYSTEM ACCESS KEY labeled password input with key icon, purple gradient INITIALIZE_SESSION button, and a SYSTEM_ONLINE footer with animated green pulse dot. The script block (lines 1–31) was preserved byte-for-byte — all auth logic (`handleSubmit`, `setApiKey`, `clearApiKey`, `apiFetch`) is unchanged. Error state now uses tertiary tokens instead of `bg-red-50`/`farm-danger`.

## Verification

All 9 task-level grep checks pass. Build exits 0. Zero `farm-*` tokens in login page. All required text strings confirmed present.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npm run web:build` | 0 | ✅ pass | 4.8s |
| 2 | `grep -c 'farm-' web/src/routes/login/+page.svelte` | 1 (0 matches) | ✅ pass | <1s |
| 3 | `grep -c 'bg-red-50' web/src/routes/login/+page.svelte` | 1 (0 matches) | ✅ pass | <1s |
| 4 | `grep 'DEVICE_FARM' web/src/routes/login/+page.svelte` | 0 | ✅ pass | <1s |
| 5 | `grep 'INITIALIZE_SESSION' web/src/routes/login/+page.svelte` | 0 | ✅ pass | <1s |
| 6 | `grep 'COMMAND CENTER AUTHORIZATION' web/src/routes/login/+page.svelte` | 0 | ✅ pass | <1s |
| 7 | `grep 'kinetic-gradient' web/src/routes/login/+page.svelte` | 0 | ✅ pass | <1s |
| 8 | `grep 'kinetic-gradient' web/src/app.css` | 0 | ✅ pass | <1s |
| 9 | `grep 'bg-background' web/src/routes/login/+page.svelte` | 0 | ✅ pass | <1s |

**Slice-level checks (partial — T01 is first of 3 tasks):**

| # | Check | Verdict | Notes |
|---|-------|---------|-------|
| 1 | `grep -r 'farm-' ...login/` | ✅ pass | Zero matches in login |
| 2 | `grep -r 'farm-' ...devices/ ...settings/ ...DeviceCard.svelte` | ⏳ pending | T02/T03 scope |
| 3 | `grep -r 'bg-red-50\|border-farm' ...login/` | ✅ pass | Zero matches in login |
| 4 | `grep -r 'divide-y\|divide-farm' ...login/` | ✅ pass | Zero matches in login |
| 5 | Login 5-string check | ✅ pass | All 5 strings found |

## Diagnostics

- **Login page structure:** Inspect via `browser_find` for heading "DEVICE_FARM", input with id `api-key`, button with text "INITIALIZE_SESSION"
- **Error state:** Submit empty key → "Please enter an API key" error in tertiary-styled banner. Submit invalid key → "Invalid API key" in same banner.
- **CSS class:** `grep 'kinetic-gradient' web/src/app.css` confirms the gradient background class exists

## Deviations

None — followed plan exactly.

## Known Issues

None.

## Files Created/Modified

- `web/src/app.css` — Added `.kinetic-gradient` CSS class (radial gradient background utility)
- `web/src/routes/login/+page.svelte` — Rewrote template from Jenkins light theme to cinematic dark auth screen
- `.gsd/milestones/M002/slices/S05/S05-PLAN.md` — Added Observability / Diagnostics section (pre-flight fix)
- `.gsd/milestones/M002/slices/S05/tasks/T01-PLAN.md` — Added Observability Impact section (pre-flight fix)
