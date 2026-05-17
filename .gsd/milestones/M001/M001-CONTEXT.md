# M001: Jenkins Design System Reskin

**Gathered:** 2026-03-15
**Status:** Ready for planning

## Project Description

Extract the complete design system from the Jenkins-inspired reference HTML (`/Users/heicg/Downloads/stitch_acesso_remoto_live_testing/code.html`) and apply it across all Device Farm web UI pages. This includes color tokens, typography, icon system (Material Symbols), component patterns (status balls, weather indicators, alert banners, Jenkins tables, metric cards), layout shell (top navbar + sidebar), and page-level content restructuring.

## Why This Milestone

The web UI has a half-implemented design system with dead `gh-*` token references, mixed icon libraries (Lucide + Material Symbols), and no top navbar. The user wants a cohesive Jenkins-utilitarian aesthetic that matches the reference design — dense, information-first, operations-tool feel.

## User-Visible Outcome

### When this milestone is complete, the user can:

- See every page of the Device Farm web UI rendered in the Jenkins-utilitarian aesthetic matching the reference design
- Navigate via a dark navy top bar with breadcrumbs and a consistent sidebar with health indicators

### Entry point / environment

- Entry point: Web browser at the Device Farm server URL
- Environment: local dev (SvelteKit dev server on :5173) and production (static build served by Fastify)
- Live dependencies involved: Device Farm API server for data

## Completion Class

- Contract complete means: all pages render with correct tokens, zero `gh-*` references, zero Lucide imports, `web:build` passes
- Integration complete means: all pages load real data from the API and display correctly
- Operational complete means: none — this is a visual reskin, not a behavior change

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- Every route (/, /jobs, /jobs/:id, /devices, /settings, /login) renders with the Jenkins aesthetic
- `grep -r 'gh-' web/src/` returns zero results
- `grep -r 'lucide-svelte' web/src/` returns zero results
- `npm run web:build` succeeds with no errors

## Risks and Unknowns

- Token migration surface is large (16 files, ~220 `gh-*` references) — risk of missing references causing unstyled elements
- Dashboard content restructuring (health widget, device table) requires mapping reference patterns to real API data shapes that differ from reference mock data

## Existing Codebase / Prior Art

- `web/src/app.css` — Design tokens already defined with `farm-*` namespace, Jenkins-style table CSS, status ball CSS
- `web/src/lib/components/layout/Nav.svelte` — Sidebar already uses Material Symbols and `farm-*` tokens
- `web/src/lib/components/shared/StatusBadge.svelte` — Currently uses Lucide icons, needs conversion to status balls
- `web/src/lib/api/types.ts` — All TypeScript types for API responses (Device, Job, HealthResponse)
- `web/src/lib/api/health.ts` — Health endpoint client (provides device states, queue depths)
- Reference HTML: `/Users/heicg/Downloads/stitch_acesso_remoto_live_testing/code.html`
- Reference screenshot: `/Users/heicg/Downloads/stitch_acesso_remoto_live_testing/screen.png`

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions — it is an append-only register; read it during planning, append to it during execution.

## Relevant Requirements

- R001-R011 — All 11 requirements are owned by this milestone

## Scope

### In Scope

- Full color token alignment with reference palette
- Material Symbols replacing all Lucide icons
- Jenkins status balls + weather metaphor indicators
- Dark navy top navbar with breadcrumbs
- Sidebar enhancements (executor status, health bar)
- Dashboard content restructuring (health widget, alerts, device table, quick actions)
- All page reskins (Jobs, Job detail, Devices, Settings, Login)
- `gh-*` elimination and `lucide-svelte` removal

### Out of Scope / Non-Goals

- Adding new features or routes
- Changing API endpoints or server behavior
- Dark mode / theme switching
- Mobile responsive layout optimization
- Adding new data visualizations beyond what the reference shows

## Technical Constraints

- Tailwind CSS v4 with `@theme` directive — tokens defined as CSS custom properties
- Material Symbols Outlined already loaded via CDN link in `app.html`
- SvelteKit 5 with Svelte 5 runes — no legacy Svelte 4 patterns
- Static adapter — no SSR considerations

## Integration Points

- Device Farm API (`/api/health`, `/api/jobs`, `/api/devices`, `/api/config`) — provides all data for the dashboard and pages
- WebSocket subscriptions — live job streaming and device preview must continue working after reskin

## Open Questions

- None — all decisions resolved during discussion
