---
phase: 23-jobs-module-keystone
plan: 05
subsystem: jobs
tags: [drain, pg-boss, system_state, admin-routes, runbook, openapi]

# Dependency graph
requires:
  - phase: 23-00
    provides: system_state DB table (key/value)
  - phase: 23-01
    provides: jobsRegistry + makeJobsEmitters (extended to 11 entries)
  - phase: 23-04
    provides: createJobsModule factory + drain admission gate (enqueueJob 503 DRAINING)
provides:
  - server/jobs/internal/routes.ts (registerJobsAdminRoutes + honorDrainOnBoot)
  - server/jobs/events.ts +2 events (DRAIN_COMPLETED, DRAIN_RESUMED)
  - server/jobs/internal/module.ts +registerWorkerOnly + admin route wiring
  - POST /admin/drain + POST /admin/drain/resume routes (long-poll drain procedure)
  - DRAIN_COMPLETED + DRAIN_RESUMED persisted events with aggregateType:'system'
  - server/openapi.json /admin/drain + /admin/drain/resume paths + DrainResponse schemas
  - docs/runbooks/drain.md operational runbook
affects: [23-06, 23-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pitfall 1 corrected: pg-boss v12 has NO updateQueue({paused}); drain uses boss.offWork(name, {wait:false}) + system_state row + enqueueJob admission check"
    - "Restart safety: honorDrainOnBoot reads system_state on plugin onReady and re-calls offWork — drain state survives process restart"
    - "Public JobsModule API split: registerWorkerOnly (worker only, post-ready safe) + registerWorkerAndSubscribers (full boot, with hooks)"
    - "system.drain.* events use aggregateType:'system' (NOT 'job') to discriminate trace-tree consumption (DEFERRED-23-B)"
    - "Admin routes use fastify-zod-openapi withTypeProvider().route() pattern matching Phase 19 Plan 19-05 DLQ route"
    - "Bearer/X-API-Key auth via requireAuth helper wrapping authService.validateKey (DEFERRED-23-A: Phase 26 will add admin claim)"

key-files:
  created:
    - server/jobs/internal/routes.ts (252 lines)
    - server/jobs/__tests__/drain-route.spec.ts (238 lines, 6 DB-gated tests)
    - docs/runbooks/drain.md (98 lines)
  modified:
    - server/jobs/events.ts (+44 lines; DRAIN_COMPLETED, DRAIN_RESUMED keys + payload schemas + registry entries + emitter helpers)
    - server/jobs/__tests__/events.spec.ts (+57 lines; 4 new it-blocks asserting 13 entries / 6 persisted / 2 system aggregateType / 13 emitters)
    - server/jobs/internal/module.ts (+24 lines; registerWorkerOnly split + admin route wiring + onReady honorDrainOnBoot hook)
    - server/jobs/__tests__/module.spec.ts (+12 lines; mock fastify gains withTypeProvider/authService stubs)
    - server/openapi.json (regenerated; +2 paths + 2 schemas)
  deleted: []

key-decisions:
  - "Split JobsModule public API: registerWorkerOnly (NEW, worker-only, post-ready safe) + registerWorkerAndSubscribers (full boot path with addHook). Resume route uses registerWorkerOnly because Fastify throws FST_ERR_INSTANCE_ALREADY_LISTENING when addHook is called after ready(). The boot-time path retains the full method for plugin registration."
  - "emit.drainCompleted/drainResumed use randomUUID() as aggregateId (NOT the ISO string drainedAt). The events table Zod refinement requires aggregateId to be a UUID — system.drain.* events are singletons-per-occurrence, so a fresh UUID per drain is the correct shape. The drainedAt string lives inside the payload."
  - "Auth via requireAuth helper extracting Bearer/X-API-Key from headers and calling fastify.authService.validateKey. The plan suggested fastify.authService.validateKey directly as preHandler, but its signature ((rawKey:string)=>Promise<boolean>) is incompatible with Fastify's preHandler shape ((req,reply)=>Promise<void>). The wrapper handles header extraction + 401 response."
  - "Created system_state table directly in dev DB via psql (Rule 3 - blocking issue). Plan 23-00 added the schema definition to server/db/schema.ts but `npx drizzle-kit push` had not been run against the dev DB. CREATE TABLE IF NOT EXISTS is idempotent and matches the schema definition exactly."

patterns-established:
  - "Drain mechanism: 3-step state change (system_state row + offWork + admission check)"
  - "Restart safety hook: honorDrainOnBoot reads system_state on onReady and re-calls offWork"
  - "Admin route auth: requireAuth wrapping authService.validateKey (header parsing inline)"
  - "Event aggregateType discrimination: 'job' for jobs.* events, 'system' for system.drain.* events"

requirements-completed: [QUEUE-03]

# Metrics
duration: 35m
completed: 2026-05-08
---

# Phase 23 Plan 23-05: Drain Procedure Summary

**Operator-facing /admin/drain + /admin/drain/resume endpoints landing the Pitfall 1-corrected drain mechanism (boss.offWork + system_state + admission check) plus system.drain.* events surface, restart safety hook, OpenAPI artifact, and operational runbook.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-05-08T02:38:00Z
- **Completed:** 2026-05-08T03:03:00Z
- **Tasks:** 5/5
- **Files modified:** 8 (3 created, 5 modified)
- **Test pass rate:** 17/17 events.spec + 6/6 drain-route.spec + 6/6 module.spec = 29/29 jobs spec passes

## Accomplishments

- **jobsRegistry: 11 → 13 entries** — adds DRAIN_COMPLETED + DRAIN_RESUMED events (both persisted, aggregateType:'system' per DEFERRED-23-B)
- **makeJobsEmitters: 11 → 13 helpers** — adds drainCompleted + drainResumed
- **Persisted ratio: 4 → 6** (out of 13) — drain events join the audit trail
- **POST /admin/drain endpoint** — long-poll drain with ?timeout=N (default 300s, max 1800s); upserts system_state row + calls boss.offWork on JOB_EXECUTE + RECORDING_UPLOAD queues + polls until in_flight=0; emits DRAIN_COMPLETED on success
- **POST /admin/drain/resume endpoint** — deletes system_state row + calls jobsModule.registerWorkerOnly (NOT registerWorkerAndSubscribers) + emits DRAIN_RESUMED
- **honorDrainOnBoot helper** — registered as second onReady hook in createJobsModule; reads system_state at boot and re-calls offWork so drain state survives process restart
- **Pitfall 1 corrected** — pg-boss v12 has NO updateQueue({paused}); the canonical pattern (boss.offWork + system_state + admission check on enqueueJob) is now implemented end-to-end
- **6 DB-gated tests in drain-route.spec.ts** — all passing against dev DB: drain success path, missing-auth 401, invalid-auth 401, admission gate 503, resume success, system.drain.completed event persistence
- **OpenAPI artifact regenerated** — server/openapi.json carries /admin/drain + /admin/drain/resume paths + DrainResponse (discriminated union) + DrainResumeResponse schemas
- **Operational runbook** — docs/runbooks/drain.md (98 lines) covers mechanism, procedure (drain/restart/resume), failure modes, auth, events, observability

## Task Commits

1. **Task 5.1: Extend events.ts with system.drain.* events (registry to 13 entries)** — `f687d82` (feat)
2. **Task 5.2: Create internal/routes.ts with /admin/drain + /admin/drain/resume** — `b55b219` (feat)
3. **Task 5.3: Wire registerJobsAdminRoutes + honorDrainOnBoot into createJobsModule** — `46e719c` (feat)
4. **Task 5.4: Write drain-route.spec.ts (6 DB-gated tests)** — `18640a0` (test)
5. **Task 5.5: Regenerate openapi.json + write docs/runbooks/drain.md** — `5a9bdba` (docs)

## Files Created/Modified

### Created
- `server/jobs/internal/routes.ts` (252 lines) — registerJobsAdminRoutes + honorDrainOnBoot + requireAuth helper + Zod schemas for drain query/responses
- `server/jobs/__tests__/drain-route.spec.ts` (238 lines, 6 DB-gated tests)
- `docs/runbooks/drain.md` (98 lines) — operational runbook

### Modified
- `server/jobs/events.ts` — +DRAIN_COMPLETED + DRAIN_RESUMED keys + systemDrainCompletedPayload + systemDrainResumedPayload + 2 registry entries + 2 emitter helpers
- `server/jobs/__tests__/events.spec.ts` — extended for 13 entries / 6 persisted / 2 system aggregateType / 13 emitters
- `server/jobs/internal/module.ts` — split registerWorkerOnly out of registerWorkerAndSubscribers; added admin route registration + second onReady honorDrainOnBoot hook
- `server/jobs/__tests__/module.spec.ts` — mock fastify gains withTypeProvider + authService stubs
- `server/openapi.json` — regenerated (adds /admin/drain + /admin/drain/resume paths + DrainResponse + DrainResumeResponse schemas)

## Decisions Made

See `key-decisions:` frontmatter — 4 decisions documented covering JobsModule API split (registerWorkerOnly), aggregateId UUID requirement for emit.drainCompleted, requireAuth header extraction wrapping validateKey, and the system_state DB table dev-DB sync.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] emit.drainCompleted/drainResumed needed UUID aggregateId**
- **Found during:** Task 5.4 (drain-route.spec failed with 500: "aggregateId Invalid UUID")
- **Issue:** Initial routes.ts passed `drainedAt` (ISO string) as aggregateId to `emit.drainCompleted(drainedAt, payload)`. The events table envelope schema enforces `aggregateId` as UUID via Zod refinement.
- **Fix:** Pass `randomUUID()` as aggregateId; the ISO string lives in the payload. Each drain occurrence gets a fresh aggregateId — semantically correct because system.drain.* events are singletons-per-occurrence (no shared aggregate).
- **Files modified:** `server/jobs/internal/routes.ts`
- **Verification:** drain-route.spec test 1 + test 6 (DRAIN_COMPLETED row in events table) pass.

**2. [Rule 1 - Bug] resume route called registerWorkerAndSubscribers post-ready (FST_ERR_INSTANCE_ALREADY_LISTENING)**
- **Found during:** Task 5.4 (drain-route.spec test 4 failed with 500: "Fastify instance is already listening. Cannot call addHook!")
- **Issue:** registerWorkerAndSubscribers calls `fastify.addHook('onReady', ...)`. After fastify.ready() (production runtime, including resume calls), addHook throws.
- **Fix:** Split JobsModule public API: NEW `registerWorkerOnly` does just `registerJobsExecuteQueue` + `registerJobsExecuteWorker` (no addHook); `registerWorkerAndSubscribers` calls registerWorkerOnly internally + adds the hooks. Resume route uses registerWorkerOnly. The bus subscribers + admin routes were already wired during plugin boot; only the pg-boss worker needs re-registration on resume.
- **Files modified:** `server/jobs/internal/module.ts` (interface + factory body), `server/jobs/internal/routes.ts` (resume handler)
- **Verification:** drain-route.spec test 4 (resume path) passes; module.spec 6/6 still pass.

**3. [Rule 3 - Blocking] system_state table missing from dev DB**
- **Found during:** Task 5.4 (drain-route.spec failed with PostgresError: "relation system_state does not exist")
- **Issue:** Plan 23-00 added `systemState` to `server/db/schema.ts` but `npx drizzle-kit push` had not been run against the dev DB. The drain spec needs the table.
- **Fix:** Created the table directly via psql with `CREATE TABLE IF NOT EXISTS system_state (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());` — exact match to the schema definition; idempotent.
- **Verification:** drain-route.spec passes 6/6.

**4. [Rule 3 - Blocking] module.spec mock fastify missing withTypeProvider + authService**
- **Found during:** Task 5.3 (module.spec failed because registerWorkerAndSubscribers now calls registerJobsAdminRoutes which uses fastify.withTypeProvider().route() and fastify.authService)
- **Issue:** The Task 5.3 wiring exposed the routes registration call inside the factory; the existing mock fastify didn't have withTypeProvider or authService.
- **Fix:** Extended `makeMockFastify()` in module.spec.ts: added `withTypeProvider: vi.fn(() => ({route: vi.fn()}))` and `authService: {validateKey: vi.fn().mockResolvedValue(true)}`.
- **Verification:** module.spec 6/6 still pass.

### Plan-spec acceptance threshold notes (NOT auto-fixes)

**A. routes.ts: 252 lines (plan target 130-220)**
- **Why:** Plan didn't budget for the requireAuth helper (~25 lines: header parsing + Bearer prefix handling + 401 path). The plan suggested using `fastify.authService.validateKey` directly as preHandler; that doesn't compile (signature mismatch — validateKey is `(string)=>Promise<boolean>`, preHandler is `(req,reply)=>Promise<void>`). The wrapper is the minimum fix.
- **Net result:** 252 lines is reasonable for 2 routes + 2 helpers + 4 schemas + extensive doc-comments. Plan 23-07 close MAY refactor if a smaller surface emerges.

**B. drain-route.spec.ts: 238 lines (plan target 120-220)**
- **Why:** Added 6 tests instead of 5 (added invalid-key 401 test alongside missing-key 401). The bonus test costs ~12 lines and proves the validateKey rejection path explicitly.

**Total deviations:** 4 auto-fixed (2 Rule 1 bugs caught at runtime, 2 Rule 3 blocking issues caught at test time). No scope creep; no architectural changes (no Rule 4 prompts).

## Issues Encountered

- **DEFERRED-23-A** (Phase 26 admin claim) — TODO comments in routes.ts (5 sites) + docs/runbooks/drain.md note. Phase 26 Auth Module formalizes admin claim + requireAdmin middleware.
- **DEFERRED-23-B** (system.drain.* aggregateType placement) — events live in jobsRegistry but use `aggregateType:'system'` (not 'job'). Phase 27+ may extract to a system module.

## User Setup Required

If the operator's dev DB doesn't have the `system_state` table, run:
```bash
DATABASE_URL=<your-db-url> npx drizzle-kit push
```
This applies all schema changes including Plan 23-00's system_state table.

## Next Phase Readiness

- **Plan 23-06 unblocked** — DB-gated subscriber.spec / correlation.spec / lifecycle-ownership.spec can now exercise the full saga + drain admission. The system.drain.* events are part of the trace tree.
- **Plan 23-07 close pending** — MODULE.md body, plugin-order.spec extension, `.test.ts → .spec.ts` mass rename, deferred-items.md update with DEFERRED-23-A + DEFERRED-23-B, Nyquist gate, STATE/ROADMAP final updates.

## Self-Check: PASSED

- ✓ `server/jobs/internal/routes.ts` exists (252 lines)
- ✓ `server/jobs/__tests__/drain-route.spec.ts` exists (238 lines)
- ✓ `docs/runbooks/drain.md` exists (98 lines)
- ✓ `server/jobs/events.ts` has DRAIN_COMPLETED + DRAIN_RESUMED + 2 system aggregateType entries + 6 persisted entries
- ✓ `server/jobs/internal/module.ts` has registerWorkerOnly + honorDrainOnBoot wiring
- ✓ `server/openapi.json` jq path queries return non-null for /admin/drain, /admin/drain/resume, DrainResponse, DrainResumeResponse
- ✓ `npx vitest run server/jobs/__tests__/events.spec.ts` 17/17 passing
- ✓ `DATABASE_URL=... npx vitest run server/jobs/__tests__/drain-route.spec.ts` 6/6 passing
- ✓ `DATABASE_URL=... npx vitest run server/jobs/__tests__/` 76/76 passing (entire jobs spec suite)
- ✓ `npx tsc --noEmit` shows ZERO new errors in server/jobs/
- ✓ Commit `f687d82` (events extension) found
- ✓ Commit `b55b219` (routes.ts) found
- ✓ Commit `46e719c` (module wiring) found
- ✓ Commit `18640a0` (drain-route.spec) found
- ✓ Commit `5a9bdba` (openapi + runbook) found

---
*Phase: 23-jobs-module-keystone*
*Completed: 2026-05-08*
