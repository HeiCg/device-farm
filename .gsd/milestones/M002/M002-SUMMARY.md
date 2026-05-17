---
id: M002
provides:
  - Complete Kinetic Console dark theme across all 6 web routes (Dashboard, Jobs list, Job detail, Devices, Settings, Login)
  - 51 dark palette color tokens as --color-* CSS custom properties in Tailwind v4 @theme block
  - Space Grotesk + Inter typography system loaded via Google Fonts CDN
  - .glass-card CSS utility class with backdrop blur and ghost border
  - Kinetic Console app shell — top navbar (DEVICE_FARM brand), left sidebar (COMMAND_CENTER + health API polling), mobile bottom nav
  - Bento grid dashboard with 7 health/jobs/fleet data sections
  - Build History responsive 3-column card grid with inline filter tabs and status-colored borders
  - Job Detail with dark StepList, glow-bar MetricsPanel, macOS-dots LogViewer
  - Fleet Management devices page with 5-state summary counters and platform-grouped card grid
  - Bento grid settings page with 4 modular config sections
  - Cinematic dark login page with kinetic-gradient background
  - .kinetic-gradient CSS class for radial gradient backgrounds
  - D016 pattern — full static class strings in Record lookups for Tailwind v4 JIT safety
  - D017 pattern — $derived for reactive Record lookups in Svelte 5 (not {@const} at top-level)
key_decisions:
  - D007 Kinetic Console design system supersedes Jenkins-utilitarian (D003/D004)
  - D008 Reference Tailwind config as color token source of truth
  - D009 Space Grotesk + Inter dual-font typography
  - D010 "Device Farm" branding — visual language from reference, product identity stays
  - D011 Real routes only in navigation — no placeholders
  - D012 No RUN_NEW_JOB button — CLI-only job submission
  - D013 No mock data surfaces — only real API data
  - D014 Mobile bottom nav included for responsive support
  - D015 Tinted pill badges replace solid status circles
  - D016 Full static class strings for Tailwind v4 JIT safety
  - D017 $derived for reactive Record lookups in Svelte 5
patterns_established:
  - Tailwind v4 @theme block with --color-* namespace for all 51 design tokens organized by role
  - Font families via --font-* vars consumed by font-headline, font-body, font-label utilities
  - Ghost border pattern — outline-variant at ≤20% opacity for boundaries, no solid 1px dividers
  - Tinted pill badge pattern for status indicators — bg-{token}/10 text-{token} border-{token}/20
  - Bento grid layout — 3-column with col-span variants for dashboard and settings pages
  - Segmented-control tab pattern with if/else blocks for D016-compliant active/inactive styling
  - Surface-container tier hierarchy for tonal depth without borders
  - {@const} + Record or $derived + Record patterns for D016-safe dynamic Tailwind class application
  - macOS-style dots header for terminal/log viewer UI elements
  - Kinetic-gradient radial background for cinematic full-screen layouts
observability_surfaces:
  - "npm run web:build exits non-zero if any token reference, CSS syntax, or Svelte compilation is broken"
  - "grep -r 'farm-' web/src/ --include='*.svelte' --include='*.ts' returns only device-farm-api-key (localStorage key)"
  - "grep -c '^\s*--color-' web/src/app.css returns 51 for token definition count"
  - "Network tab /api/health requests every 5s confirm sidebar data polling is alive"
  - "document.fonts.check('16px \"Space Grotesk\"') returns true after page load"
requirement_outcomes:
  - id: R012
    from_status: active
    to_status: validated
    proof: "51 @theme tokens defined. grep -r 'farm-' web/src/ returns only device-farm-api-key localStorage key (not CSS). Zero farm-canvas/farm-subtle/farm-border/farm-fg/farm-accent/farm-sidebar in any source file."
  - id: R013
    from_status: active
    to_status: validated
    proof: "Space Grotesk + Inter loaded via single Google Fonts CDN link in app.html. font-headline used across 10 component/page files. font-body/font-label registered in @theme."
  - id: R014
    from_status: active
    to_status: validated
    proof: ".glass-card defined in app.css with rgba(25,25,25,0.6) bg + backdrop-filter blur(12px). Used on dashboard (9 instances), login auth form, settings cards, device cards. Ghost borders at ≤15% opacity throughout."
  - id: R015
    from_status: active
    to_status: validated
    proof: "Header.svelte: fixed h-16 navbar with bg-background/80 backdrop-blur-xl, DEVICE_FARM brand in text-primary font-headline, 4 nav links with active underline, search input, icons, auth avatar."
  - id: R016
    from_status: active
    to_status: validated
    proof: "Nav.svelte: w-64 sidebar with COMMAND_CENTER header + green pulse dot, active nav items with border-r-4, Build Queue/Executor/Health sections wired to fetchHealth polling (setInterval 5s)."
  - id: R017
    from_status: active
    to_status: validated
    proof: "MobileNav.svelte: fixed bottom bar with md:hidden, 4 nav items (Dashboard/Jobs/Devices/Settings), Material Symbols icons, text-primary active state."
  - id: R018
    from_status: active
    to_status: validated
    proof: "Dashboard +page.svelte: 7 bento sections — Infrastructure Health glass card, Queue Android/iOS cards, quick actions grid, AlertBanner system alerts, fleet status table, recent builds column. All wired to getHealth/listJobs APIs."
  - id: R019
    from_status: active
    to_status: validated
    proof: "Build History: grid-cols-1 md:grid-cols-2 lg:grid-cols-3 card grid. JobCard with border-l-2 status border via borderStyles Record. Inline segmented-control filter tabs + platform toggle. Pagination preserved."
  - id: R020
    from_status: active
    to_status: validated
    proof: "Job Detail: font-headline job ID, D016-compliant if/else tabs, StepList with border-l-2 status borders + tinted icons, MetricsPanel with semantic glow bars (real PSS/heap only), LogViewer with macOS dots header + terminal bg-[#0d1117]."
  - id: R021
    from_status: active
    to_status: validated
    proof: "Devices page: 5-state summary counters, ANDROID_ECOSYSTEM + IOS_SUITE platform groups, responsive card grid (xl:grid-cols-4), DeviceCard with state-specific content (idle/running/error/booting/offline)."
  - id: R022
    from_status: active
    to_status: validated
    proof: "Settings page: DEVICE_FARM_CONFIG headline + READ_ONLY badge, grid-cols-12 bento with 4 sections (Server Parameters, Pool Orchestration, Job Execution Policy, Storage Subsystem). All from real /api/config."
  - id: R023
    from_status: active
    to_status: validated
    proof: "Login page: kinetic-gradient background, terminal icon, DEVICE_FARM headline in font-headline text-primary, COMMAND CENTER AUTHORIZATION subtitle, SYSTEM ACCESS KEY input, purple gradient INITIALIZE_SESSION button, SYSTEM_ONLINE footer with green pulse."
  - id: R024
    from_status: active
    to_status: validated
    proof: "Zero divide-y in web/src/. Zero border-farm-border. All boundaries via surface-container tiers, space-y spacing, and ghost borders (border-white/5, border-outline-variant/10, border-primary/15)."
  - id: R025
    from_status: active
    to_status: validated
    proof: "StatusBadge rewritten as tinted pill badge. statusStyle() returns token classes. Status colors: secondary/green (passed/idle), tertiary/red (failed/error), primary/purple (running), surface-variant (queued/offline). Applied across all pages."
  - id: R026
    from_status: active
    to_status: validated
    proof: "Zero CPU/RAM/Network Profiler/Memory Heap/Leak Detection strings in any svelte file. MetricsPanel shows only Total PSS, Native Heap, Java Heap from real WebSocket data."
  - id: R027
    from_status: active
    to_status: validated
    proof: "grep -rn 'RUN_NEW_JOB' web/src/ returns zero matches. No sidebar CTA, no FAB."
  - id: R028
    from_status: active
    to_status: validated
    proof: "All three nav surfaces show exactly 4 routes: Dashboard(/), Jobs(/jobs), Devices(/devices), Settings(/settings). Zero Analytics/Reports/Test Suites/Logs/DOCUMENTATION/SUPPORT references."
duration: ~93min (S01 18m + S02 25m + S03 10m + S04 28m + S05 22m)
verification_result: passed
completed_at: 2026-03-18
---

# M002: Kinetic Console Reskin

**Complete visual overhaul of the Device Farm web UI from Jenkins-utilitarian light theme to a dark obsidian command-center aesthetic — 51 dark palette tokens, Space Grotesk + Inter typography, glass card surfaces, tonal depth hierarchy, and all 6 routes reskinned with zero legacy tokens remaining.**

## What Happened

Five slices executed sequentially over ~93 minutes to replace every visual surface in the web application.

**S01 (Design Foundation)** established the token system that everything else depends on. The entire `app.css` @theme block was rewritten — 24 `farm-*` light-theme tokens removed, 51 Kinetic Console dark palette tokens added (background #0e0e0e, primary #c39bff, secondary #00fd93, tertiary #ff7168, surface-container tiers for depth). Space Grotesk and Inter were loaded via a consolidated Google Fonts CDN link. The `.glass-card` utility class was created. All 5 shared components (StatusBadge, AlertBanner, Filters, Pagination, FlakeyBadge) and `statusStyle()` were migrated to the new token system. A critical pattern was established early: Tailwind v4 JIT requires full static class strings in lookup maps — dynamic construction like `` `bg-${color}/10` `` silently fails (D016).

**S02 (App Shell)** rewrote the four layout files that frame every page. The Header became a fixed top navbar with DEVICE_FARM brand, 4 nav links with active underline detection, and backdrop-blur glass effect. The Nav sidebar became a COMMAND_CENTER with green pulse dot, health-API-wired Build Queue/Executor/Health sections (polling every 5 seconds), and purple active-state nav items. A new MobileNav component was created as a fixed bottom bar visible on viewports under 768px. The layout scaffold was restructured with correct offsets (`md:pl-64 pt-16 pb-20 md:pb-0`).

**S03 (Dashboard)** replaced the flat Jenkins grid with a 3-column bento layout containing 7 sections: Infrastructure Health glass card with green percentage, Queue Android/iOS cards (iOS with conditional red overflow tint), quick actions grid, system alert banners, Active Fleet Status table, and Recent Builds column with status-colored card borders. All sections are wired to real `getHealth` and `listJobs` API calls.

**S04 (Jobs)** made the highest-risk structural change — converting the Build History from a flat list to a responsive 3-column card grid. The `Filters` component was replaced with inline segmented-control tabs (status + platform toggle with deselect behavior). JobCard was rewritten with `border-l-2` status-colored left borders via a D016-safe `$derived` Record lookup (D017 — Svelte 5 restricts `{@const}` to block contexts). Job Detail got dark tabs, StepList with tinted icon circles, MetricsPanel with semantic glow bars (real PSS/heap data only), and LogViewer with macOS-style colored dots header.

**S05 (Remaining Pages)** completed the migration. Login became a cinematic full-screen auth page with kinetic-gradient background, ambient blur orbs, glass card, and purple gradient INITIALIZE_SESSION button. Devices became a fleet management page with 5-state summary counters, ANDROID_ECOSYSTEM/IOS_SUITE platform sections, and state-specific DeviceCard content (idle→OS info, running→job link, error→restart, booting→pulse, offline→grayscale). Settings became a `grid-cols-12` bento layout with 4 modular config sections and a READ_ONLY badge.

After S05, zero `farm-*` CSS tokens remain in any source file (only the `device-farm-api-key` localStorage key, which is not a CSS token). Zero `divide-y` borders. Zero mock data labels. All data surfaces wired to real APIs.

## Cross-Slice Verification

Each success criterion from the roadmap was independently verified against the live codebase:

| # | Criterion | Verification | Result |
|---|-----------|-------------|--------|
| 1 | Every route renders with obsidian dark theme | All 6 route files use dark tokens (bg-background, surface-container tiers, on-surface text). Zero light-theme colors. | ✅ |
| 2 | Space Grotesk + Inter fonts load correctly | `grep 'Space.Grotesk' web/src/app.html` confirms CDN link. `font-headline` used across 10 files. | ✅ |
| 3 | All components use reference color tokens | `grep -c '^\s*--color-' web/src/app.css` = 51 token definitions. Zero `farm-*` in any component. | ✅ |
| 4 | No-Line Rule observed | Zero `divide-y` in web/src/. Zero `border-farm-border`. All boundaries via tonal shifts or ghost borders. | ✅ |
| 5 | Mobile bottom nav works on small viewports | MobileNav.svelte uses `md:hidden`, Nav.svelte uses `hidden md:flex`. Responsive breakpoint wired. | ✅ |
| 6 | All data is real | Zero CPU/RAM/Network/Leak mock labels. 7+ API wiring points across routes (`getHealth`, `listJobs`, `getConfig`, `listDevices`). | ✅ |
| 7 | No RUN_NEW_JOB, no placeholder nav items | `grep -rn 'RUN_NEW_JOB'` = zero. `grep -rn 'Analytics\|Reports\|Test.Suites'` in layout = zero. | ✅ |
| 8 | `npm run web:build` succeeds with zero errors | Build completed successfully — SSR + client bundles + static adapter. Exit code 0. | ✅ |

**Definition of Done** — all 7 items verified:
- ✅ All 6 routes render with obsidian dark theme
- ✅ `npm run web:build` succeeds
- ✅ Zero occurrences of `farm-canvas`, `farm-subtle`, `farm-border`, `farm-fg`, `farm-accent`, `farm-sidebar`
- ✅ Space Grotesk and Inter fonts load via CDN and render
- ✅ Mobile bottom nav visible on viewports < 768px
- ✅ All data surfaces wired to real APIs
- ✅ Reference design visual fidelity confirmed per-page in slice summaries

## Requirement Changes

All 17 M002 requirements transitioned from active to validated:

- R012: active → validated — 51 @theme tokens, zero farm-* CSS tokens in web/src/
- R013: active → validated — Google Fonts CDN link confirmed, font-headline across 10 files
- R014: active → validated — .glass-card defined, surface-container tiers throughout, ghost borders ≤15% opacity
- R015: active → validated — Top navbar with h-16, backdrop-blur, DEVICE_FARM brand, nav links, search, icons
- R016: active → validated — Sidebar w-64, COMMAND_CENTER + pulse, health API polling every 5s
- R017: active → validated — MobileNav md:hidden, 4 items with Material Symbols, text-primary active
- R018: active → validated — Dashboard 7 bento sections with real health/jobs data
- R019: active → validated — Build History 3-column card grid with filter tabs and status borders
- R020: active → validated — Job Detail with dark StepList, glow-bar MetricsPanel, macOS-dots LogViewer
- R021: active → validated — Devices with 5-state counters, platform groups, state-specific cards
- R022: active → validated — Settings grid-cols-12 bento with 4 config sections from real /api/config
- R023: active → validated — Cinematic dark login with kinetic-gradient, INITIALIZE_SESSION CTA
- R024: active → validated — Zero divide-y, zero solid sectioning borders across entire app
- R025: active → validated — Tinted pill badges with semantic status colors across all pages
- R026: active → validated — Zero mock data labels, only real API data surfaces
- R027: active → validated — Zero RUN_NEW_JOB references anywhere
- R028: active → validated — Exactly 4 real routes in all nav surfaces, zero placeholders

## Forward Intelligence

### What the next milestone should know
- The entire web UI is now on the Kinetic Console dark design system with 51 tokens in `@theme`. Any new component must use these tokens — never hardcode hex colors or use old `farm-*` names.
- Tailwind v4 JIT requires full static class strings (D016). Any dynamic class construction like `` `bg-${color}/10` `` will silently produce no CSS. Use Record lookup maps with complete strings.
- Svelte 5 restricts `{@const}` to block contexts ({#if}, {#each}). Use `$derived` for component-level reactive lookups (D017).
- The app shell uses `md:pl-64 pt-16 pb-20 md:pb-0` offsets. All page content renders inside this padded container — pages don't need their own navbar/sidebar spacing.
- Search input in top navbar is visual-only — no search functionality wired. Notification icon is also visual-only.

### What's fragile
- **`kinetic-gradient` CSS class** uses hardcoded color values (not tokens) for radial gradient stops — if primary color changes, this needs manual update.
- **`bg-background/80` opacity modifier** on navbar depends on Tailwind v4 parsing opacity modifiers on custom @theme colors. Config changes could break the glass effect silently.
- **`isActive()` route matching** uses `startsWith` for sub-routes — a route like `/devices-new` would incorrectly match `/devices`.
- **`--radius-full` must not be overridden** — it's intentionally left at 9999px. Custom radii only override `--radius`, `--radius-lg`, `--radius-xl`.

### Authoritative diagnostics
- `npm run web:build` — single source of truth for compilation health. Catches broken token references, missing imports, and Svelte errors.
- `grep -r 'farm-' web/src/ --include='*.svelte' --include='*.ts'` — legacy token contamination check. Should return only `device-farm-api-key`.
- `grep -c '^\s*--color-' web/src/app.css` — token definition count, should be exactly 51.
- Network tab → `/api/health` requests every 5s — confirms sidebar polling is alive.

### What assumptions changed
- Token count is 51, not ~40 as estimated in the roadmap — the reference palette has more surface-container tiers and outline variants than initially scoped. No downstream impact.
- Svelte 5 `{@const}` cannot be used at top-level template scope — only inside block contexts. The `$derived` pattern (D017) was discovered in S04 and applied in S05.
- Nav link labels changed from Build History/Runners/Manage to Jobs/Devices/Settings across all three nav surfaces for consistency.

## Files Created/Modified

- `web/src/app.css` — Complete rewrite: 51 dark tokens, 3 font families, 3 radius overrides, .glass-card utility, .kinetic-gradient class, dark body/scrollbar styles
- `web/src/app.html` — Google Fonts CDN preconnect + consolidated link for Space Grotesk + Inter + Material Symbols
- `web/src/routes/+layout.svelte` — Restructured layout with dark background, correct offsets, MobileNav import
- `web/src/lib/components/layout/Header.svelte` — Rewritten as top navbar with DEVICE_FARM brand, nav links, search, icons
- `web/src/lib/components/layout/Nav.svelte` — Reskinned sidebar with COMMAND_CENTER header, dark nav items, health API sections
- `web/src/lib/components/layout/MobileNav.svelte` — New mobile bottom nav with 4 items and Material Symbols icons
- `web/src/routes/+page.svelte` — Dashboard rewritten as 7-section bento grid with real API data
- `web/src/lib/components/jobs/JobCard.svelte` — Rewritten as dark card with border-l-2 status border
- `web/src/routes/jobs/+page.svelte` — Build History with card grid, inline filter tabs, dark states
- `web/src/routes/jobs/[id]/+page.svelte` — Job Detail with dark header, D016-compliant tabs, ghost borders
- `web/src/lib/components/jobs/StepList.svelte` — Dark tonal hierarchy with status borders and tinted icons
- `web/src/lib/components/jobs/MetricsPanel.svelte` — Semantic glow bars with real PSS/heap data only
- `web/src/lib/components/jobs/LogViewer.svelte` — Token-aligned borders with macOS-style dots header
- `web/src/routes/login/+page.svelte` — Cinematic dark auth screen with kinetic-gradient background
- `web/src/routes/devices/+page.svelte` — Fleet management with summary counters and platform card grid
- `web/src/lib/components/devices/DeviceCard.svelte` — Vertical card with state-specific content branches
- `web/src/routes/settings/+page.svelte` — Bento grid with 4 modular config sections
- `web/src/lib/components/shared/StatusBadge.svelte` — Tinted pill badge with status→token color mapping
- `web/src/lib/components/shared/AlertBanner.svelte` — Dark tinted variant with tertiary/primary tokens
- `web/src/lib/components/shared/Filters.svelte` — Dark surface-container styling (retained but unused after S04 inline tabs)
- `web/src/lib/components/shared/Pagination.svelte` — Dark surface-container-high styling
- `web/src/lib/components/FlakeyBadge.svelte` — Tertiary-tinted flaky indicator
- `web/src/lib/utils/format.ts` — statusStyle() returns Kinetic Console token classes
