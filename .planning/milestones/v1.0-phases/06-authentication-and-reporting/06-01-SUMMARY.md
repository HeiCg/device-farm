---
phase: 06-authentication-and-reporting
plan: 01
subsystem: auth
tags: [fastify, bearer-auth, scrypt, api-keys, security]

# Dependency graph
requires:
  - phase: 01-device-infrastructure
    provides: DB schema pattern, config schema pattern
  - phase: 02-job-execution-and-api
    provides: API plugin structure, route registration
provides:
  - AuthService with scrypt key hashing and timing-safe validation
  - Fastify auth plugin with selective bearer-auth enforcement
  - Admin key management routes (POST/GET/DELETE /api/admin/keys)
  - Route protection for all API routes except /api/health
  - auth.enabled config flag for dev/prod toggle
affects: [06-authentication-and-reporting]

# Tech tracking
tech-stack:
  added: ["@fastify/bearer-auth"]
  patterns: [scoped-route-protection, selective-hook-enforcement]

key-files:
  created:
    - server/auth/auth-service.ts
    - server/auth/auth-plugin.ts
    - server/auth/key-routes.ts
    - server/auth/__tests__/auth-service.test.ts
    - server/auth/__tests__/auth-plugin.test.ts
  modified:
    - server/db/schema.ts
    - server/config/schema.ts
    - server/api/plugin.ts
    - server/index.ts

key-decisions:
  - "scryptSync with HASH_LEN=64 for API key hashing -- secure, built-in, no external dependency"
  - "Bearer auth registered with addHook:false for selective route protection via scoped registration"
  - "Health endpoint registered outside protected scope to remain always public"
  - "Auth plugin registered after DB but before websocket-plugin in boot order"

patterns-established:
  - "Scoped route protection: health outside scope, all other routes inside protected scope with verifyBearerAuth hook"
  - "API key prefix lookup: first 8 chars for efficient DB lookup, then timing-safe hash comparison"

requirements-completed: [AUTH-01, AUTH-02]

# Metrics
duration: 8min
completed: 2026-03-11
---

# Phase 06 Plan 01: API Key Authentication Summary

**API key auth with scrypt hashing, bearer-auth selective enforcement, and admin key CRUD routes**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-11T12:19:27Z
- **Completed:** 2026-03-11T12:27:47Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- AuthService generates df_-prefixed API keys with scrypt hashing and timing-safe validation
- Auth plugin uses @fastify/bearer-auth with addHook:false for selective route enforcement
- Admin routes (POST/GET/DELETE /api/admin/keys) for key lifecycle management
- Health endpoint remains public; all other API routes protected when auth.enabled=true
- 20 auth tests + 289 total tests passing with no regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: API key schema, config extension, and AuthService with tests**
   - `490858f` (test) - TDD RED: failing tests for AuthService
   - `ff33128` (feat) - TDD GREEN: schema, config, AuthService implementation
2. **Task 2: Auth plugin, key admin routes, and route protection wiring**
   - `bb5d4c1` (test) - TDD RED: failing tests for auth plugin
   - `252c71c` (feat) - TDD GREEN: plugin, routes, api wiring

## Files Created/Modified
- `server/db/schema.ts` - Added apiKeys table (id, name, keyHash, keySalt, keyPrefix, timestamps, revoked)
- `server/config/schema.ts` - Added auth.enabled and webhooks config sections
- `server/auth/auth-service.ts` - Key generation, hashing, validation, CRUD operations
- `server/auth/auth-plugin.ts` - Fastify plugin with bearer-auth registration
- `server/auth/key-routes.ts` - POST/GET/DELETE /api/admin/keys routes
- `server/auth/__tests__/auth-service.test.ts` - 12 unit tests for AuthService
- `server/auth/__tests__/auth-plugin.test.ts` - 8 integration tests for auth flow
- `server/api/plugin.ts` - Split routes into public (health) and protected scopes
- `server/index.ts` - Added auth plugin to boot chain (after DB, before websocket)

## Decisions Made
- scryptSync with HASH_LEN=64 for API key hashing -- secure, built-in, no external dependency
- Bearer auth registered with addHook:false for selective route protection via scoped registration
- Health endpoint registered outside protected scope to remain always public
- Auth plugin registered after DB but before websocket-plugin in boot order
- Fire-and-forget lastUsedAt update on key validation to avoid blocking auth flow

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed missing @fastify/bearer-auth dependency**
- **Found during:** Task 2 (Auth plugin implementation)
- **Issue:** @fastify/bearer-auth not in package.json
- **Fix:** Ran `npm install @fastify/bearer-auth`
- **Files modified:** package.json, package-lock.json
- **Verification:** Import succeeds, all tests pass
- **Committed in:** ff33128 (Task 1 commit, bundled with first implementation)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential dependency installation. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Auth foundation complete, ready for WebSocket token auth (Phase 06 Plan 02 if planned)
- API key management available for admin setup
- Auth disabled by default (auth.enabled=false) for development convenience

---
*Phase: 06-authentication-and-reporting*
*Completed: 2026-03-11*
