---
phase: 06-authentication-and-reporting
plan: 04
subsystem: auth
tags: [websocket, bearer-auth, api-key, svelte, fastify]

# Dependency graph
requires:
  - phase: 06-authentication-and-reporting
    provides: "AuthService, bearer auth hooks, auth store, apiFetch client"
provides:
  - "Token-based WebSocket authentication (code 1008 on rejection)"
  - "Report routes inside bearer-auth protected scope"
  - "WebSocket clients pass ?token=<apiKey> in connection URLs"
  - "Login page validates against protected endpoint"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Async IIFE wrapper for auth check in synchronous WS handlers"
    - "Token query param for WebSocket authentication"

key-files:
  created: []
  modified:
    - server/streaming/websocket-plugin.ts
    - server/api/plugin.ts
    - server/reporting/reporting-plugin.ts
    - web/src/lib/ws/job-stream.svelte.ts
    - web/src/lib/ws/device-preview.svelte.ts
    - web/src/routes/login/+page.svelte

key-decisions:
  - "Async IIFE in WS handlers to bridge sync handler with async validateKey"
  - "Report routes moved from reporting-plugin to api/plugin protected scope"
  - "Login validates against /admin/keys (protected) instead of /api/health (public)"

patterns-established:
  - "WS auth pattern: read token from req.query, validate via authService, close 1008 on failure"

requirements-completed: [AUTH-02, AUTH-03, REPT-01, REPT-02, REPT-03, REPT-04]

# Metrics
duration: 3min
completed: 2026-03-11
---

# Phase 06 Plan 04: Gap Closure Summary

**WebSocket token auth, report route protection, and login validation fix to close three auth bypass vectors**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-11T13:09:20Z
- **Completed:** 2026-03-11T13:12:20Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- WebSocket connections now require valid token query param when auth.enabled=true (rejected with code 1008)
- Report routes (/api/jobs/:id/report.xml, /api/flows/flaky) moved inside bearer-auth protected scope
- Login page validates API key against protected /admin/keys endpoint instead of public /api/health
- Web UI WebSocket clients pass ?token=<apiKey> in connection URLs

## Task Commits

Each task was committed atomically:

1. **Task 1: Add WebSocket auth and move report routes into protected scope** - `7f3414d` (feat)
2. **Task 2: Pass token in WebSocket URLs and fix login validation** - `3012ec8` (feat)

## Files Created/Modified
- `server/streaming/websocket-plugin.ts` - Token validation on WS connection handlers, async IIFE wrapper
- `server/api/plugin.ts` - Report routes registered inside protected scope, added reporting dependency
- `server/reporting/reporting-plugin.ts` - Removed route registration (only decorates services now)
- `web/src/lib/ws/job-stream.svelte.ts` - Appends ?token=<apiKey> to WebSocket URL
- `web/src/lib/ws/device-preview.svelte.ts` - Appends ?token=<apiKey> to WebSocket URL
- `web/src/routes/login/+page.svelte` - Validates against apiFetch('/admin/keys') instead of fetch('/api/health')

## Decisions Made
- Async IIFE wrapper in WS handlers to bridge synchronous handler signature with async validateKey call
- Report routes moved from reporting-plugin to api/plugin protected scope (reporting-plugin only decorates services)
- Login validates against /admin/keys (protected endpoint) to correctly reject invalid API keys

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All API surface areas now enforce authentication consistently when auth.enabled=true
- No remaining auth bypass vectors in WebSocket, report, or login flows

---
*Phase: 06-authentication-and-reporting*
*Completed: 2026-03-11*
