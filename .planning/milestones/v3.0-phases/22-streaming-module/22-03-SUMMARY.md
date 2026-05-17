---
phase: 22-streaming-module
plan: 03
subsystem: testing
tags: [streaming, websocket, vitest, fastify, drizzle, pg-boss, zod, correlation-id, ALS, async-local-storage]

# Dependency graph
requires:
  - phase: 22-streaming-module
    provides: "Plan 22-01 streamingRegistry + wsEnvelopeSchema + jobsRegistry log/step/status bridgehead"
  - phase: 22-streaming-module
    provides: "Plan 22-02 createStreamingModule factory + thin streaming plugin + 7 broadcaster.emit→bus surgery"
  - phase: 21-artifacts-module
    provides: "subscriber.spec.ts / correlation.spec.ts canonical patterns (stub-jobs-plugin + skipIf(!HAS_DB))"
  - phase: 20-pool-module
    provides: "plain-object ALS store shape canonical (NOT legacy Map)"
provides:
  - "DB-gated subscriber.spec proving SC2 (bus → subscriber → envelope → broadcaster path) end-to-end"
  - "DB-gated correlation.spec proving SC1+TRACE-06 round-trip + SC3 dev-tool grep-ability + ALS-missing fallback"
  - "Non-DB envelope.spec proving wsEnvelopeSchema.safeParse contract (8 reject cases + valid + payload variants)"
  - "Plan 22-04 lifecycle-ownership.spec grep-guard has proven substitute-path reference"
affects: [22-04-PLAN, 22-05-PLAN, 22-06-PLAN, 23-jobs-keystone, 27-trace-tree]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DB-gated integration spec (describe.skipIf(!HAS_DB)) with structured console.warn skip — Phase 19/20/21 inheritance"
    - "Stub-jobs-plugin pattern: TypedBus(jobsRegistry) + makeJobsEmitters + side-channel envelope forward + persisted-event short-circuit"
    - "Per-test isolated pgboss schema (pgboss_stream_<suffix>) with afterEach DROP CASCADE for parallel-test safety"
    - "Plain-object ALS shape: asyncLocalStorage.run({correlationId, currentEventId: null, actor: '...'} as never, async () => ...)"
    - "Non-DB unit spec for schema contracts — fast-feedback (<500ms) smoke runs on all hosts (SPEC-08)"

key-files:
  created:
    - "server/streaming/__tests__/subscriber.spec.ts (240 lines, 4 tests, DB-gated SC1+SC2)"
    - "server/streaming/__tests__/correlation.spec.ts (215 lines, 3 tests, DB-gated SC1+TRACE-06+SC3)"
    - "server/streaming/__tests__/envelope.spec.ts (111 lines, 9 tests, non-DB safeParse)"
  modified: []

key-decisions:
  - "Stub plugins duplicated across subscriber.spec + correlation.spec (NOT extracted to shared fixture) — Phase 21 artifacts precedent for scope discipline; Phase 27+ consolidation trigger if 4th sample point appears"
  - "afterEach (NOT beforeAll) lifecycle in DB-gated specs — each test gets fresh app instance + fresh pg-boss schema; matches sub/corr need to assert per-test broadcaster state independently"
  - "Stub config plugin uses minimal AppConfig shape (database_url + auth.enabled:false + storage + pool) instead of real config loader — avoids YAML dependency in tests"

patterns-established:
  - "Per-test pg-boss schema isolation in streaming module: schema name pgboss_stream_<flavor>_<rand6> with afterEach DROP CASCADE"
  - "Stub-auth-plugin + stub-pool-plugin pair (named 'auth' + 'pool-plugin') registered before streaming plugin so 5-entry deps array (config/auth/pool-plugin/event-bus/db) resolves cleanly"
  - "Plain-object ALS shape verified across all 3 specs (zero new Map([[ matches via grep -cE)"

requirements-completed: [TRACE-06, EVENTS-06]

# Metrics
duration: 9min
completed: 2026-05-08
---

# Phase 22 Plan 22-03: Wave 3 Runtime Proofs Summary

**Three Vitest specs (subscriber.spec + correlation.spec + envelope.spec) prove Phase 22 SC1, SC2, SC3, and TRACE-06 end-to-end via in-process bus → subscriber → envelope → broadcaster path with 16 tests across DB-gated integration and non-DB unit coverage.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-05-08T02:30:00Z
- **Completed:** 2026-05-08T02:39:30Z
- **Tasks:** 3 (all TDD-style: write spec → run → green → commit)
- **Files created:** 3

## Accomplishments

- **subscriber.spec.ts** (4 tests, ~5s with DB): proves jobsModule.emit.log / .step / .status each fan out via the streaming subscriber to the JobBroadcaster, and that the ring buffer replays 5 prior emissions in emission order on a late subscribe (SC2 invariant).
- **correlation.spec.ts** (3 tests, ~5s with DB): proves envelope.correlationId === ALS.correlationId after a full bus round-trip (TRACE-06), that JSON.stringify(envelope) places `"correlationId":"<uuid>"` at the root for dev-tool grep-ability (SC3), and that the subscriber's `readAls(...) ?? randomUUID()` fallback produces a valid UUID (never undefined) when ALS is unset.
- **envelope.spec.ts** (9 tests, ~80ms): proves wsEnvelopeSchema.safeParse correctly accepts a valid candidate, rejects 7 distinct malformations (missing/non-UUID correlationId, missing/non-literal v, missing/non-datetime ts, empty type), and accepts arbitrary payload shapes (null, string, number, nested object, array) per z.unknown().
- All 3 specs use the plain-object ALS store shape canonical to Phase 20+; zero `new Map([[` matches across the three new files.
- All 74 streaming-module tests (74/0 with DB enabled) pass after this plan.

## Task Commits

Each task was committed atomically:

1. **Task 3.1: subscriber.spec.ts (DB-gated SC1+SC2)** — `4dc743d` (test)
2. **Task 3.2: correlation.spec.ts (DB-gated SC1+TRACE-06+SC3)** — `35ff8e6` (test)
3. **Task 3.3: envelope.spec.ts (non-DB safeParse coverage)** — `57e0da4` (test)

**Plan metadata commit:** TBD (final commit after STATE.md / ROADMAP.md updates).

## Files Created/Modified

**Created:**
- `server/streaming/__tests__/subscriber.spec.ts` — DB-gated 4-test integration spec; boots minimal Fastify stack (stub-config + correlation + db + event-bus + queue + stub-auth + stub-pool + stub-jobs + real streaming plugin); per-test schema isolation via `pgboss_stream_sub_<rand6>` + afterEach DROP CASCADE; asserts envelope shape (type/v/correlationId/ts/payload) and ring-buffer replay order.
- `server/streaming/__tests__/correlation.spec.ts` — DB-gated 3-test spec on the same minimal stack; asserts ALS-correlationId propagation through emit → subscriber → envelope; asserts root-level "correlationId":"<uuid>" substring in JSON.stringify; asserts UUID-fallback when ALS is empty.
- `server/streaming/__tests__/envelope.spec.ts` — Non-DB 9-test schema contract spec covering valid + 7 reject cases + payload-variant coverage. Runs in <500ms.

**Modified:** None.

## Decisions Made

- **Stub plugins duplicated, not extracted:** subscriber.spec and correlation.spec each define their own `makeStubConfigPlugin` / `makeStubAuthPlugin` / `makeStubPoolPlugin` / `makeStubJobsPlugin` instead of importing from a shared fixture. Mirrors Phase 21 artifacts precedent (artifacts/__tests__ has 3+ specs each with its own stub plugins). Sample point #2 — Phase 27+ consolidation trigger if a 4th DB-gated streaming spec appears.
- **afterEach (not beforeAll/afterAll) for app lifecycle:** unlike Phase 21 artifacts which use `beforeAll` + shared schema, the streaming specs use `afterEach` + per-test schema. Rationale: each subscriber.spec test wants a fresh JobBroadcaster + fresh subscriber wiring to assert independent envelope counts. Cost: ~3-4s per test; acceptable for 4+3 = 7 DB-gated tests total.
- **Stub config plugin shape:** minimal AppConfig literal (`{database_url, auth: {enabled:false}, storage, pool}`) instead of invoking the real `loadConfig()` — avoids YAML / config.yaml dependency in tests and matches Phase 21 artifacts/correlation.spec pattern.
- **No streaming/__tests__/fixtures/ directory created:** Phase 21 artifacts created `fixtures/stub-recording-service.ts` because recordingService is a real concrete dependency. Phase 22 streaming has no analogous concrete dep — the subscriber reads from `fastify.jobsModule.bus` via `bus.on()`; stubs live inline in each spec.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None — three specs went straight from write → green on first DB run.

## User Setup Required

None — no external service configuration required. The DB-gated specs read `TEST_DATABASE_URL` or `DATABASE_URL` from env (already configured in `.env`).

## Verification Results

- `npx vitest run server/streaming/__tests__/subscriber.spec.ts` (with DATABASE_URL set) → 4/4 pass
- `npx vitest run server/streaming/__tests__/correlation.spec.ts` (with DATABASE_URL set) → 3/3 pass
- `npx vitest run server/streaming/__tests__/envelope.spec.ts` → 9/9 pass in <500ms (no DB)
- `npx vitest run server/streaming/__tests__/` (with DATABASE_URL set) → 74/0 pass (all streaming-module tests)
- `grep -cE "new Map\(\[\[" server/streaming/__tests__/subscriber.spec.ts server/streaming/__tests__/correlation.spec.ts server/streaming/__tests__/envelope.spec.ts` → 0 0 0 (plain-object ALS shape enforced)
- `npx tsc --noEmit` → 0 new errors on the 3 new spec files (pre-existing 8 errors unchanged)
- `npx eslint server/streaming/__tests__/{subscriber,correlation,envelope}.spec.ts` → 0 issues

## Self-Check: PASSED

- [x] `server/streaming/__tests__/subscriber.spec.ts` exists (FOUND)
- [x] `server/streaming/__tests__/correlation.spec.ts` exists (FOUND)
- [x] `server/streaming/__tests__/envelope.spec.ts` exists (FOUND)
- [x] Commit `4dc743d` (Task 3.1) reachable in `git log`
- [x] Commit `35ff8e6` (Task 3.2) reachable in `git log`
- [x] Commit `57e0da4` (Task 3.3) reachable in `git log`

## Next Phase Readiness

- **Plan 22-04 (Wave 4) lifecycle-ownership.spec unblocked:** the readFileSync grep-guard asserting zero `jobBroadcaster.emit` callsites in `server/jobs/job-service.ts` (proven structurally green in Plan 22-02) now has a runtime substitute-path proof in 22-03's subscriber.spec — bus emit → broadcaster envelope arrives at subscribers as expected. Plan 22-04 can quote 22-03's specs as proof of correctness for the deletion.
- **Plan 22-05 (Wave 5 close-out):** MODULE.md + barrel expansion (MOD-01/MOD-02/MOD-04) inherits the same DB-gated pattern; spec rename `module.spec.ts` (already adopted) needs no further migration.
- **Plan 22-06 (Wave 6 phase close):** grep-guard will assert `grep -cE "new Map\(\[\[" server/streaming/__tests__/*.spec.ts == 0` — already satisfied by this plan's enforcement.
- **Phase 23 Jobs Module Keystone:** when the full saga registry lands, the `bus.on('job.log'|'job.step'|'job.status', ...)` pattern proven here will scale to additional job.* events without changing the subscriber pattern in `createStreamingModule`.

---
*Phase: 22-streaming-module*
*Completed: 2026-05-08*
