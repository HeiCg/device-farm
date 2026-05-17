# M002: Kinetic Console Reskin — Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

## Project Description

Complete visual overhaul of the Device Farm web UI — replacing the Jenkins-utilitarian light theme (M001) with a dark "Kinetic Console" command-center aesthetic. Every CSS token, component, and layout structure changes. Data wiring, API clients, WebSocket subscriptions, and route structure all stay intact.

## Why This Milestone

The Jenkins light theme served as a functional baseline, but the target experience is a high-tech, atmospheric dark command center. The user provided complete reference designs (6 screens as PNG + HTML) and a detailed DESIGN.md documenting the design system. M002 is the visual identity the product was always heading toward.

## User-Visible Outcome

### When this milestone is complete, the user can:

- Open the web dashboard and see a dark obsidian command center with purple accents, green success glow, glass card surfaces, and Space Grotesk headlines on every page
- Navigate via top navbar ("DEVICE_FARM" brand + nav links) and left sidebar (COMMAND_CENTER + live queue/executor data)
- View fleet overview in a bento grid layout with infrastructure health, queue cards, alerts, device table, and recent builds
- Browse build history as a card grid with status-colored borders
- Inspect job details with sidebar steps cluster, terminal-style log viewer, and real-time metrics
- Manage runners as per-device cards with state-specific content
- See settings as modular data sections resembling a system status panel
- Log in through a cinematic dark auth screen
- Use the dashboard from a phone via mobile bottom navigation

### Entry point / environment

- Entry point: Browser at localhost:5173 (dev) or served by Fastify (production)
- Environment: local dev / browser
- Live dependencies involved: Device Farm server (health, jobs, devices, config APIs + WebSocket)

## Completion Class

- Contract complete means: all components render with new token system, web:build succeeds, no Jenkins-era tokens or styles remain
- Integration complete means: all pages show real data from the server APIs, WebSocket streams work, navigation across all routes works
- Operational complete means: none (no deployment changes)

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- Every route (/, /jobs, /jobs/:id, /devices, /settings, /login) renders with the obsidian dark theme
- `npm run web:build` succeeds with zero errors
- No `farm-*` old light-theme tokens, no Jenkins-era colors, no hardcoded light backgrounds remain in source
- Mobile bottom nav is visible on small viewports and functional
- Real data flows through on every page (no mock/placeholder data sections)

## Risks and Unknowns

- Tailwind v4 `@theme` directive handles the ~40 color tokens differently than v3's `tailwind.config` — must translate correctly
- Glass card `backdrop-filter: blur()` may have performance implications on lower-end devices — acceptable tradeoff for the aesthetic
- Build History card grid is a significant layout change from the current list — must maintain pagination and filter functionality

## Existing Codebase / Prior Art

- `web/src/app.css` — Current `@theme` block with `farm-*` tokens, to be fully replaced
- `web/src/app.html` — Loads Material Symbols via CDN; needs Space Grotesk + Inter added
- `web/src/routes/+layout.svelte` — Current layout with Header + Nav + main area; needs restructuring for new shell
- `web/src/lib/components/layout/Header.svelte` — Current dark navy top bar; will be rewritten
- `web/src/lib/components/layout/Nav.svelte` — Current light sidebar; will be rewritten
- `web/src/lib/components/shared/StatusBadge.svelte` — Solid color balls; will become tinted pill badges
- `web/src/lib/components/shared/WeatherIcon.svelte` — Weather metaphor; may be removed or adapted
- `web/src/lib/components/shared/AlertBanner.svelte` — Light colored banners; will become dark tinted
- `web/src/lib/components/jobs/JobCard.svelte` — List row pattern; will become card pattern
- `web/src/lib/components/jobs/LogViewer.svelte` — Already dark (#0d1117); minor adjustments
- `web/src/lib/components/jobs/StepList.svelte` — Light bordered list; will become dark cluster
- `web/src/lib/components/jobs/MetricsPanel.svelte` — Light progress bars; will become dark tonal bars
- `web/src/lib/components/devices/DeviceCard.svelte` — Table row; will become full card
- Reference designs at `/Users/heicg/Downloads/stitch_acesso_remoto_live_testing/` — 6 screen PNGs, 6 HTML files, 1 DESIGN.md

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions.

## Relevant Requirements

- R012–R028 — All 17 active requirements for this milestone
- R001, R002 (validated) — Material Symbols stays, tokens get replaced
- R003 (validated) — Superseded by R025 (new status badge style)

## Scope

### In Scope

- Complete `app.css` token replacement with reference palette (~40 colors)
- Google Fonts addition (Space Grotesk + Inter)
- App shell rewrite (top navbar, sidebar, mobile nav, layout offsets)
- All 6 page templates reskinned to match reference designs
- All 15 components updated to new design system
- `format.ts` statusStyle function updated for new color tokens
- Glass card CSS utility class
- Responsive mobile bottom nav

### Out of Scope / Non-Goals

- No new routes (Analytics, Reports, Test Suites, Logs)
- No RUN_NEW_JOB button or FAB
- No fake data surfaces (CPU, RAM, Network, Leak Detection)
- No server-side changes
- No new API endpoints
- No changes to WebSocket protocol
- No changes to authentication logic

## Technical Constraints

- Tailwind CSS v4 with `@theme` directive — not v3 `tailwind.config.js`
- SvelteKit 5 with Svelte 5 runes — no legacy reactive syntax
- Static adapter — SPA served by Fastify
- Reference HTML uses Tailwind CDN (v3 style); must be translated to v4 `@theme` approach

## Integration Points

- Health API (`GET /api/health`) — dashboard, sidebar, devices
- Jobs API (`GET /api/jobs`, `GET /api/jobs/:id`) — dashboard, build history, job detail
- Config API (`GET /api/config`) — settings page
- Devices API (`GET /api/devices`) — runners page
- WebSocket job stream — job detail live logs/steps/metrics
- WebSocket device preview — job detail live preview tab

## Open Questions

- WeatherIcon component: the reference designs don't use weather metaphor. May become a health percentage display instead of sun/cloud/rain icons — decide during S01.
