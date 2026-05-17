# Project

## What This Is

Device Farm is a self-hosted test execution platform for Apple Silicon Macs. It manages Android emulators and iOS simulators, executes Maestro test flows, and provides real-time observability via WebSocket streaming and a web dashboard. Stack: TypeScript server (Fastify 5) + Go CLI (Cobra) + SvelteKit 5 web UI + PostgreSQL (Drizzle ORM).

The web UI has 7 routes (Dashboard, Jobs list, Job detail, Devices, Device Inspector, Settings, Login), 25+ Svelte components, typed API clients, and WebSocket subscriptions for live job streaming and device preview.

The server exposes Maestro integration endpoints (hierarchy, screenshot, device state, element query), a hooks system (lifecycle hooks with adb/idb commands), and a device info collector (OS version, screen, RAM, model via adb/xcrun).

## Core Value

Complete Maestro frontend — submit tests, inspect device state with hierarchy viewer, configure lifecycle hooks, and debug test results with per-step artifacts, all from the Kinetic Console dark dashboard.

## Current State

- Server, CLI, and web app all functional
- M001 complete: Jenkins design system applied across all pages
- M002 complete: Full Kinetic Console dark theme (51 tokens, Space Grotesk + Inter, glass cards, tonal layering)
- M003 complete: Full Maestro integration UI — hierarchy viewer with 3 switchable sources, element inspector with Maestro command suggestions, hooks management CRUD, enriched device cards, Maestro options + debug artifacts in job detail
- Server Maestro integration built: hierarchy service (3 strategies + native adb uiautomator dump), device info collector, screenshot endpoints, combined `/state` endpoint
- Server hooks system built: HookExecutor with 4 lifecycle events, CRUD API routes, template variables, test-run endpoint
- Job executor extended with `--include-tags`, `--exclude-tags`, `--debug-output`, `--format`, `--shards` passthrough
- Config schema expanded with `hooks` and `maestro` sections
- All 311 existing tests green (including 11 new hierarchy service tests), TypeScript clean
- Zero `farm-*` CSS tokens remain in web/src
- All 34 requirements (R001-R043) that are in scope are validated; 7 requirements (R029-R032, R044-R046) are out of scope

## Architecture / Key Patterns

- SvelteKit 5 with Svelte 5 runes (`$state`, `$derived`, `$effect`)
- Tailwind CSS v4 with `@theme` directive for design tokens in `web/src/app.css`
- Static adapter — SPA served by Fastify server
- Material Symbols Outlined + Space Grotesk + Inter via Google Fonts CDN
- D016: Full static class strings in Record lookups for Tailwind v4 JIT safety
- D017: `$derived` for reactive Record lookups in Svelte 5
- Glass card pattern: .glass-card CSS class with rgba(25,25,25,0.6) bg + backdrop-filter blur(12px)
- Ghost border pattern: outline-variant at ≤20% opacity
- Surface-container tier hierarchy for tonal depth
- SVG viewBox for coordinate-free hierarchy overlay rendering (no manual device-pixel to CSS-pixel math)
- Clipboard copy with per-button $state feedback and auto-reset
- Defensive extractor pattern (extractMaestroOptions) for nullable jsonb metadata
- Two-click inline delete confirmation (D021) for destructive actions
