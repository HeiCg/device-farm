---
phase: 06-authentication-and-reporting
verified: 2026-03-11T13:30:00Z
status: human_needed
score: 13/13 must-haves verified
re_verification: true
  previous_status: gaps_found
  previous_score: 10/13
  gaps_closed:
    - "WebSocket routes accept token via query parameter (1008 on rejection)"
    - "Report routes inside bearer-auth protected scope in api/plugin.ts"
    - "Login page rejects invalid API keys using apiFetch('/admin/keys')"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Full browser auth flow"
    expected: "Unauthenticated visit redirects to /login; invalid key shows 'Invalid API key' error on login page; valid key grants dashboard access; clearing localStorage redirects back to login"
    why_human: "Browser redirect flow, localStorage state, and visual error display require manual browser testing"
  - test: "Flaky badge rendering on job detail page"
    expected: "Amber 'Flaky' badge appears next to flow names with 20%-80% pass rate; tooltip shows pass rate percentage"
    why_human: "Visual component rendering and data integration require browser verification with real job data"
  - test: "WebSocket rejection when auth enabled"
    expected: "WebSocket connection to /ws/jobs/:id and /ws/devices/:id/preview is closed with code 1008 when auth.enabled=true and no valid token is provided"
    why_human: "Confirms auth bypass is fully closed; requires server started with auth.enabled=true and an unauthenticated WS connection attempt"
---

# Phase 06: Authentication and Reporting Verification Report

**Phase Goal:** API keys, webhooks, JUnit reports, flaky detection — all API surface areas enforce authentication consistently when auth.enabled=true
**Verified:** 2026-03-11T13:30:00Z
**Status:** human_needed (all automated checks pass)
**Re-verification:** Yes — after gap closure via Plan 04 (commits 7f3414d, 3012ec8)

## Re-Verification Summary

Previous verification (2026-03-11T12:44:08Z) found 3 gaps. Plan 04 addressed all three. This re-verification confirms all gaps are closed.

| Gap | Previous Status | Current Status |
|-----|----------------|----------------|
| WebSocket token auth | FAILED | VERIFIED |
| Report routes in protected scope | PARTIAL | VERIFIED |
| Login validates against protected endpoint | PARTIAL | VERIFIED |

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Admin can create an API key and receives the raw key exactly once | VERIFIED | `AuthService.createKey()` returns `rawKey`; POST /admin/keys returns 201 with rawKey |
| 2 | Admin can list API keys (prefix/name/timestamps, not raw key) | VERIFIED | `AuthService.listKeys()` selects id/name/keyPrefix/timestamps only |
| 3 | Admin can revoke an API key | VERIFIED | `AuthService.revokeKey()` sets revoked=true; DELETE /admin/keys/:id returns 204 |
| 4 | API routes reject requests without a valid Bearer token with 401 | VERIFIED | All routes (job/device/config/key/report) now inside protected scope in api/plugin.ts line 29-39; reportRoutes added at line 38 |
| 5 | Health endpoint remains accessible without authentication | VERIFIED | healthRoute registered outside protected scope at api/plugin.ts line 26 |
| 6 | WebSocket routes reject unauthenticated connections with code 1008 when auth.enabled=true | VERIFIED | websocket-plugin.ts lines 44-49 and 101-106: async IIFE validates token via authService.validateKey, calls socket.close(1008, 'Policy violation') on failure; both /ws/jobs/:id and /ws/devices/:id/preview covered |
| 7 | When a job finishes, a webhook POST is sent to the configured URL with job result payload | VERIFIED | webhookService.deliver() called in executeJob; wired via job-plugin |
| 8 | GET /api/jobs/:id/report.xml returns valid JUnit XML for a completed job | VERIFIED | report-routes.ts fetches job+steps, calls generateJUnitXML, returns Content-Type: application/xml |
| 9 | GET /api/flows/flaky returns flows with unstable pass/fail history | VERIFIED | report-routes.ts calls flakyDetector.getFlaky(windowSize); FlakyDetector queries schema.jobSteps |
| 10 | Webhook delivery retries on server errors with exponential backoff and jitter | VERIFIED | WebhookService loops with BASE_DELAY * 2^attempt + random jitter; does not retry on 4xx |
| 11 | User without stored API key is redirected to login page | VERIFIED | +layout.svelte $effect checks isAuthenticated(), redirects to /login |
| 12 | All API requests include Authorization Bearer header from stored key | VERIFIED | api/client.ts injects Bearer header from getApiKey(); 401 triggers clearApiKey + redirect |
| 13 | Login page rejects invalid API keys with an error message | VERIFIED | login/+page.svelte calls apiFetch('/admin/keys') (protected endpoint); catch block calls clearApiKey() and sets errorMsg = 'Invalid API key' |

**Score:** 13/13 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/db/schema.ts` | apiKeys table | VERIFIED | apiKeys pgTable with all required columns |
| `server/auth/auth-service.ts` | Key generation, hashing, validation, CRUD | VERIFIED | generateKey, createKey, validateKey (scrypt), listKeys, revokeKey |
| `server/auth/auth-plugin.ts` | bearerAuth plugin with addHook:false | VERIFIED | Decorates authService; verifyBearerAuth hook |
| `server/auth/key-routes.ts` | POST/GET/DELETE /admin/keys | VERIFIED | All three routes with correct status codes |
| `server/config/schema.ts` | auth.enabled + webhooks config | VERIFIED | authSchema and webhooksSchema present |
| `server/reporting/webhook-service.ts` | Fire-and-forget delivery with retry | VERIFIED | Exponential backoff, HMAC signing, AbortSignal.timeout |
| `server/reporting/junit-generator.ts` | JUnit XML from job steps | VERIFIED | generateJUnitXML; handles passed/failed/skipped; XML escaping |
| `server/reporting/flaky-detector.ts` | Sliding window flaky detection | VERIFIED | Queries schema.jobSteps; groups in JS; FLAKY_MIN_RATE/FLAKY_MAX_RATE |
| `server/reporting/report-routes.ts` | GET /jobs/:id/report.xml and GET /flows/flaky | VERIFIED | Both routes implemented; 404/409 handling |
| `server/reporting/reporting-plugin.ts` | Decorates services only (no route registration) | VERIFIED | Routes removed; only webhookService and flakyDetector decorations remain |
| `server/api/plugin.ts` | reportRoutes inside protected scope | VERIFIED | Line 38: `await scope.register(reportRoutes, { prefix: '/api' })` inside bearer-auth scope; 'reporting' in dependencies array (line 43) |
| `server/streaming/websocket-plugin.ts` | Token validation on both WS handlers | VERIFIED | Lines 44-49 (/ws/jobs/:id) and 101-106 (/ws/devices/:id/preview): reads req.query.token, calls authService.validateKey, closes 1008 on failure |
| `web/src/lib/auth/auth-store.svelte.ts` | Reactive auth state with localStorage | VERIFIED | $state rune; getApiKey/setApiKey/clearApiKey/isAuthenticated exported |
| `web/src/routes/login/+page.svelte` | Login validates against protected endpoint | VERIFIED | apiFetch('/admin/keys') at line 25; catch clears key and shows error at line 30-31 |
| `web/src/lib/ws/job-stream.svelte.ts` | Token query param in WS URL | VERIFIED | Line 69: `?token=${encodeURIComponent(token)}`; imports getApiKey from auth-store |
| `web/src/lib/ws/device-preview.svelte.ts` | Token query param in WS URL | VERIFIED | Line 18: `?token=${encodeURIComponent(token)}`; imports getApiKey from auth-store |
| `web/src/lib/components/FlakeyBadge.svelte` | Flaky indicator badge | VERIFIED | Amber badge with AlertTriangle icon; tooltip with pass rate |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `server/auth/auth-plugin.ts` | `server/auth/auth-service.ts` | `new AuthService(fastify.db)` | WIRED | Line 16: authService instantiated and decorated |
| `server/api/plugin.ts` | `server/auth/auth-plugin.ts` | `scope.addHook('onRequest', scope.verifyBearerAuth)` | WIRED | Lines 30-31: bearer hook applied to protected scope |
| `server/api/plugin.ts` | `server/reporting/report-routes.ts` | `scope.register(reportRoutes)` | WIRED | Line 38: reportRoutes registered inside protected scope |
| `server/streaming/websocket-plugin.ts` | `server/auth/auth-service.ts` | `fastify.authService.validateKey(token)` | WIRED | Lines 46 and 103: authService.validateKey called in both WS handlers |
| `server/auth/auth-service.ts` | `server/db/schema.ts` | drizzle queries on apiKeys | WIRED | Multiple schema.apiKeys queries |
| `server/jobs/job-service.ts` | `server/reporting/webhook-service.ts` | `webhookService.deliver()` in executeJob | WIRED | Fire-and-forget at executeJob line 360 |
| `server/reporting/report-routes.ts` | `server/reporting/junit-generator.ts` | `generateJUnitXML(job, steps)` | WIRED | generateJUnitXML called in report route handler |
| `server/reporting/flaky-detector.ts` | `server/db/schema.ts` | drizzle query on jobSteps | WIRED | schema.jobSteps.flowName and schema.jobSteps.status queried |
| `web/src/lib/api/client.ts` | `web/src/lib/auth/auth-store.svelte.ts` | `getApiKey()` for Authorization header | WIRED | Bearer header injected; 401 triggers clearApiKey + redirect |
| `web/src/routes/+layout.svelte` | `web/src/lib/auth/auth-store.svelte.ts` | `isAuthenticated()` for redirect gate | WIRED | $derived + $effect for redirect |
| `web/src/lib/ws/job-stream.svelte.ts` | `web/src/lib/auth/auth-store.svelte.ts` | `getApiKey()` for token param | WIRED | Line 6 import; line 68-70 builds tokenParam |
| `web/src/lib/ws/device-preview.svelte.ts` | `web/src/lib/auth/auth-store.svelte.ts` | `getApiKey()` for token param | WIRED | Line 5 import; lines 17-19 builds tokenParam |
| `web/src/routes/jobs/[id]/+page.svelte` | `web/src/lib/components/FlakeyBadge.svelte` | Badge shown via StepList with flakyMap | WIRED | StepList.svelte imports FlakeyBadge; renders with flakyMap |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| AUTH-01 | 06-01 | API keys managed by admin for CLI, CI, and Web UI | SATISFIED | Full CRUD via /api/admin/keys; AuthService with scrypt hashing; key routes return 201/200/204 |
| AUTH-02 | 06-01, 06-04 | API routes protected — require valid API key | SATISFIED | All routes including report routes now inside bearer-auth scope; WebSocket routes validate token via authService.validateKey with 1008 rejection |
| AUTH-03 | 06-03, 06-04 | Web UI requires API key or login for access | SATISFIED | +layout.svelte redirects unauthenticated users; login page validates via apiFetch('/admin/keys') and shows error on invalid key |
| REPT-01 | 06-02 | Webhook POST when job finishes | SATISFIED | WebhookService.deliver() fired in executeJob with exponential backoff retry |
| REPT-02 | 06-02 | JUnit XML report per job | SATISFIED | GET /api/jobs/:id/report.xml returns valid XML; generateJUnitXML handles all step statuses |
| REPT-03 | 06-02 | Pass/fail history per flow for flaky detection | SATISFIED | FlakyDetector with sliding window; GET /api/flows/flaky endpoint |
| REPT-04 | 06-03 | UI shows badge for flaky flows | SATISFIED | FlakeyBadge in StepList; flakyMap fetched from /api/flows/flaky on job detail page |

### Anti-Patterns Found

No blockers or warnings found in gap-closure files.

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | — |

All three previously identified blockers are resolved:
- `server/streaming/websocket-plugin.ts`: Auth hooks added (lines 44-49, 101-106)
- `server/reporting/reporting-plugin.ts`: Route registration removed; only service decoration remains
- `web/src/routes/login/+page.svelte`: Now uses `apiFetch('/admin/keys')` not `fetch('/api/health')`

### Human Verification Required

#### 1. Full Browser Auth Flow

**Test:** Open the app unauthenticated. Verify redirect to /login. Enter an invalid key, click Sign In. Verify "Invalid API key" error message appears. Enter a valid key (created via POST /api/admin/keys). Verify redirect to dashboard. Clear localStorage and verify redirect back to /login.
**Expected:** Clean redirect flow with "Invalid API key" error on bad key; valid key grants dashboard access immediately.
**Why human:** Browser redirect, localStorage state, and visual error display require manual browser testing.

#### 2. Flaky Badge Rendering

**Test:** Create several jobs with the same flow name, some passing and some failing. Navigate to a completed job detail page.
**Expected:** Amber "Flaky" badge appears next to flow names with 20%-80% pass rate; hovering shows pass rate percentage in tooltip.
**Why human:** Requires real job data with mixed pass/fail history and visual verification of badge rendering.

#### 3. WebSocket Rejection When Auth Enabled

**Test:** Set `auth.enabled: true` in config.yaml. Start server. Attempt to open a WebSocket connection to `/ws/jobs/<any-id>` without a `?token=` parameter (e.g., using `wscat` or browser DevTools).
**Expected:** Connection is immediately closed with code 1008 (Policy violation).
**Why human:** Confirms live auth behavior in a running server; not exercisable via static analysis.

### Gaps Summary

No gaps remain. All three gaps from the initial verification were closed in Plan 04:

1. **WebSocket auth** — Both `/ws/jobs/:id` and `/ws/devices/:id/preview` now validate `req.query.token` via `fastify.authService.validateKey(token)` inside an async IIFE, closing with code 1008 on failure. The `websocket-plugin` dependency list now includes `'auth'`. Web clients pass `?token=<encodeURIComponent(getApiKey())>` in both WS URLs.

2. **Report routes protected** — `reportRoutes` is imported and registered inside the bearer-auth protected scope in `api/plugin.ts` (line 38). The `'reporting'` plugin is in the dependencies array (line 43). The `reporting-plugin.ts` no longer registers routes — it only decorates `webhookService` and `flakyDetector`.

3. **Login validation** — `login/+page.svelte` sets the key via `setApiKey(key)` then calls `await apiFetch('/admin/keys')`. On a 401 (invalid key), the catch block calls `clearApiKey()` and sets `errorMsg = 'Invalid API key'`. On success, it redirects to `/`.

---

_Verified: 2026-03-11T13:30:00Z_
_Verifier: Claude (gsd-verifier)_
_Re-verification after gap closure: Plan 04, commits 7f3414d and 3012ec8_
