---
phase: 23-jobs-module-keystone
plan: 04
subsystem: jobs
tags: [saga, pg-boss, typed-bus, factory, persist-envelope, drain-admission]

# Dependency graph
requires:
  - phase: 23-01
    provides: 5 new jobs events (allocated/running/recordingRequested/cleanupRequested/failed) + emitters
  - phase: 23-02
    provides: JOB_EXECUTE_QUEUE_NAME contract (policy:'stately', retryLimit:0, singletonKey:jobId)
  - phase: 23-03
    provides: deviceName repo join (findJobById/listJobs) + JobResponseSchema with refinement
provides:
  - server/jobs/internal/module.ts createJobsModule factory (MOD-06)
  - server/jobs/internal/executor.ts pure execution loop (saga emits)
  - server/jobs/internal/subscribers.ts saga subscriber chain
  - server/jobs/plugin.ts thin wirer (replaces 122-line Phase 19 plugin)
  - server/jobs/job-service.ts back-compat shim (669 -> 153 lines)
  - server/jobs/index.ts expanded barrel (1 -> 42 lines)
  - DEFERRED-21 cleared (jobs/plugin.ts no longer imports bus/bus.ts)
  - DEFERRED-22-D resolved (streaming subscribes to job.cleanup.requested)
  - DEFERRED-22-F partially resolved (job-service.ts no longer imports streaming/internal)
affects: [23-05, 23-06, 23-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - 7th persistEnvelope sample point (Phase 27+ consolidation trigger)
    - Saga error path: emit job.failed -> chained subscribers handle cleanup
    - Cross-module subscribers wired via fastify.addHook('onReady') (Pitfall 5)
    - Drain admission: read system_state row, throw 503 with statusCode/code

key-files:
  created:
    - server/jobs/internal/executor.ts (265 lines)
    - server/jobs/internal/subscribers.ts (139 lines)
    - server/jobs/__tests__/module.spec.ts (157 lines)
  modified:
    - server/jobs/internal/module.ts (12 -> 231 lines; full factory body)
    - server/jobs/plugin.ts (122 -> 70 lines; thin wirer)
    - server/jobs/job-service.ts (669 -> 161 lines; back-compat shim)
    - server/jobs/index.ts (1 -> 42 lines; expanded barrel)
    - server/streaming/internal/module.ts (+19 lines; cleanup subscriber)
    - server/pool/internal/module.ts (+57 lines; failed subscriber)
    - server/jobs/__tests__/idempotency.spec.ts (+70 lines; SC2 strict block)
  deleted:
    - server/jobs/job-queue.ts (35-line in-memory FIFO)
    - server/jobs/__tests__/job-queue.test.ts
    - server/jobs/__tests__/job-service.test.ts (assertions obsolete)

key-decisions:
  - "Option B chosen: kept 161-line JobService shim (with metadata validation) instead of deleting outright. Routes + pipelines + route-tests rely on fastify.jobService.createJob/cancelJob/getQueueDepth/shutdown surface — preserving the shim avoids cross-module file changes (scope creep). Phase 24+ may delete entirely once all callers migrate to fastify.jobsModule.enqueueJob."
  - "Deleted server/jobs/__tests__/job-service.test.ts entirely. Its 350+ lines of assertions tested the old JobService dispatch+queue+mutex behaviour; new MOD-06 factory is mock-based via module.spec.ts and DB-gated via idempotency.spec.ts (Plan 23-02)."
  - "TypedBus.on delivers parsed payload directly (NOT envelope). Fixed subscribers.ts handlers accordingly — initial draft used envelope.payload pattern from Phase 21 onPersisted (which DOES use envelope for persisted events). The pattern split is documented in subscribers.ts comments."
  - "Pool subscribes to job.failed via fastify.addHook('onReady') even though pool plugin step 8 < jobs plugin step 13 — onReady is the canonical pattern across Phase 19/20/21/22 and aligns with Pitfall 5."
  - "Drain admission uses Object.assign(new Error('system_draining'), {statusCode: 503, code: 'DRAINING'}) instead of an http-errors lib import to avoid widening the dep surface (jobs/internal already has zero http-errors dependency)."

patterns-established:
  - "Saga subscriber: ONLY in OWNER module. jobs owns device.allocated reaction; pool owns job.failed reaction; streaming owns job.cleanup.requested reaction; artifacts already owns job.completed reaction (Phase 21)."
  - "Plugin thin wirer: factory in internal/, plugin.ts ~70 lines just creating + decorating + onClose. Mirrors Phase 21/22 shape exactly."
  - "Module-local in-flight Map: runningJobs:Map<jobId, {abortController, deviceId}> tracks active executions. shutdown() aborts each entry."

requirements-completed: [EVENTS-10, QUEUE-03]

# Metrics
duration: 18m
completed: 2026-05-08
---

# Phase 23 Plan 23-04: Jobs Module Keystone Saga Rewrite Summary

**Atomic single-plan rewrite landing the createJobsModule factory + pg-boss-driven executor + saga subscriber chain + JobQueue deletion + DEFERRED-21/22-D resolution.**

## Performance

- **Duration:** ~18 min (16m 28s commit-stream + ~2m self-check / SUMMARY)
- **Started:** 2026-05-08T06:10:27Z
- **Completed:** 2026-05-08T06:28:00Z
- **Tasks:** 8/8 + 1 type-fix follow-up
- **Files modified:** 13 (3 created, 7 modified, 3 deleted)

## Accomplishments

- **MOD-06 factory shape complete** — createJobsModule returns `{emit, bus, runningJobs, getInFlightCount, enqueueJob, registerWorkerAndSubscribers, shutdown}` mirroring Phase 21/22 producer modules
- **In-memory JobQueue removed** — `server/jobs/job-queue.ts` deleted; SC4 grep contract holds (`grep -r "from .*job-queue" server/` returns 0)
- **DEFERRED-21 resolved** — `jobs/plugin.ts → bus/bus.ts` violation cleared (plugin imports only from `./internal/module.js` + `./job-service.js`); dep-cruiser violation count 7 → 3
- **DEFERRED-22-D resolved** — `setTimeout(broadcaster.cleanup, 5000)` replaced by streaming subscriber on `job.cleanup.requested`
- **DEFERRED-22-F resolved** — `job-service.ts → streaming/internal/job-broadcaster.ts` + `→ device-preview.ts` violations cleared (shim doesn't import streaming internals)
- **7th persistEnvelope sample point** reached (consolidation trigger continues to defer to Phase 27+)
- **module.spec.ts** — 6 it-blocks all passing without DB (factory shape + drain admission + idempotent shutdown)

## Task Commits

1. **Task 4.1: Extract executor.ts** — `20c5cba` (feat)
2. **Task 4.2: Create subscribers.ts** — `5c481b0` (feat)
3. **Task 4.3: createJobsModule factory** — `fa2b961` (feat)
4. **Task 4.4: plugin.ts rewrite + JobService shim** — `4412546` (feat)
5. **Task 4.5: Expand index.ts + delete job-queue + obsolete tests** — `509eda7` (feat)
6. **Task 4.6: Cross-module subscribers (streaming + pool)** — `2a23111` (feat)
7. **Task 4.7: module.spec.ts** — `ffdcccb` (test)
8. **Task 4.8: idempotency.spec.ts SC2 strict** — `ac72eb9` (test)
9. **Type fix: MockLogger** — `6515e14` (fix)

## Files Created/Modified

### Created
- `server/jobs/internal/executor.ts` — Pure execution loop; runJob worker handler; emits running/started/log/step/status/completed/maestroLogWritten/failed
- `server/jobs/internal/subscribers.ts` — Saga subscriber chain (device.allocated → job.allocated; job.completed → cleanup.requested; job.failed → cleanup.requested)
- `server/jobs/__tests__/module.spec.ts` — Mock-based factory tests (no DB)

### Modified
- `server/jobs/internal/module.ts` — Full createJobsModule factory body with 7th persistEnvelope sample
- `server/jobs/plugin.ts` — Thin wirer; canonical 6-entry deps array; clears DEFERRED-21
- `server/jobs/job-service.ts` — Back-compat shim (createJob/cancelJob/getQueueDepth/shutdown)
- `server/jobs/index.ts` — Expanded barrel with public surface
- `server/streaming/internal/module.ts` — New job.cleanup.requested subscriber (DEFERRED-22-D)
- `server/pool/internal/module.ts` — New job.failed subscriber + onReady hook
- `server/jobs/__tests__/idempotency.spec.ts` — Saga-level SC2 strict describe block (PHASE23_FULL_STACK_TEST gate)

### Deleted
- `server/jobs/job-queue.ts` — In-memory FIFO removed
- `server/jobs/__tests__/job-queue.test.ts` — Obsolete with FIFO removal
- `server/jobs/__tests__/job-service.test.ts` — Obsolete; module.spec.ts replaces

## Decisions Made

See `key-decisions:` frontmatter — 5 decisions documented covering JobService shim retention, obsolete test deletion, TypedBus subscriber payload shape, onReady deferral pattern, and drain admission error shape.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypedBus.on subscribers must accept payload, not envelope**
- **Found during:** Task 4.3 (typecheck after createJobsModule landed)
- **Issue:** Initial draft of subscribers.ts used `(envelope) => envelope.payload` pattern adopted from Phase 21 `onPersisted`. But TypedBus.on (the per-module bus surface used by jobs subscribers) delivers the parsed payload directly via `this.ee.emit(type, parsed)`. The envelope-level access compiled but failed type narrowing.
- **Fix:** Refactored both job.completed and job.failed handlers to accept `payload` directly. Defensive cast `raw as { ... }` retained for the cross-module device.allocated handler (pool's bus uses the same pattern but the cross-module type narrowing across plugins is intentionally weakened).
- **Files modified:** `server/jobs/internal/subscribers.ts` (lines 64-117)
- **Verification:** `npx tsc --noEmit` clean for `server/jobs/`; module.spec 6 tests pass

**2. [Rule 1 - Bug] MockLogger TS7023 self-referencing inference error**
- **Found during:** Final verification (after Task 4.8)
- **Issue:** `function makeMockLogger() { const child: ReturnType<typeof makeMockLogger> = ...; }` triggers TS7023 because the function's return type is being inferred from a value that references the function's own return type.
- **Fix:** Extracted explicit `MockLogger` interface; function now has explicit return type annotation.
- **Files modified:** `server/jobs/__tests__/module.spec.ts`
- **Verification:** `npx tsc --noEmit` clean; tests still pass.
- **Committed in:** `6515e14`

### Plan-spec acceptance threshold notes (NOT auto-fixes)

**A. dep-check residual count 3 (plan asked for 0)**
- **Why:** Pre-existing artifacts → streaming/internal violations (`server/artifacts/memory-service.ts`, `server/artifacts/artifact-service.ts`, `server/artifacts/__tests__/artifact-service.spec.ts` all import from `server/streaming/internal/types.ts`). These predate Phase 23 (likely Phase 21 oversight when artifacts module was wired). Per the scope-boundary rule, NOT in Phase 23-04 scope.
- **Net Phase 23 impact:** dep-check went from **7 violations → 3 violations**. The 4 cleared are exactly the ones Plan 23-04 targets:
  - `jobs/plugin.ts → bus/bus.ts` (DEFERRED-21)
  - `jobs/plugin.ts → streaming/internal/adapters/index.ts`
  - `jobs/job-service.ts → streaming/internal/job-broadcaster.ts` (DEFERRED-22-F)
  - `jobs/job-service.ts → streaming/internal/device-preview.ts` (DEFERRED-22-F)
- **Recommendation:** A future Phase 21-cleanup or Phase 27 deferred-resolution plan should fix the 3 artifacts → streaming residuals.

**B. job-service.ts: 161 lines (plan target 30-80)**
- **Why:** Preserved metadata validation logic from the old Phase 19 implementation (~50 lines `validateMetadata` + Zod schema iteration). Removing this would break the routes.test.ts mock surface AND the production validation behaviour POST /api/jobs relies on.
- **Net result:** 161 lines is reasonable for a back-compat shim that does DB inserts (jobs row + jobFiles) + metadata validation + delegate to jobsModule.enqueueJob. Plan 23-07 close MAY refactor further if a smaller surface emerges.

**C. internal/module.ts: 231 lines (plan target 250-400)**
- **Why:** Slightly under because the persistEnvelope helper was extracted to a top-level `makePersistEnvelope` function (matching Phase 20 pool's shape) instead of inlining inside the factory body. Behaviour identical; line count differs only because of indentation level.

**Total deviations:** 2 auto-fixed (both Rule 1 bugs caught at typecheck). No scope creep; no architectural changes (no Rule 4 prompts).

## Issues Encountered

- **The plan's executor.ts sketch references `fastify.pool.allocateDevice` / `fastify.pool.releaseDevice`** — actual API is `fastify.pool.allocate(platform, jobId)` / `fastify.pool.release(deviceId)`. Adapted the executor to match the real API.
- **The executor's flow-files load path** — old job-service held files in the in-memory `QueuedJob` object. New executor reads `jobFiles` from the DB and calls existing `JobExecutor.writeFlowFiles`. The shim handles the upsert in `createJob`. This is consistent with the pgboss-singleton-key contract: payload is `{jobId, platform}` only; everything else stored in DB.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 23-05 unblocked** — `/admin/drain` route can now read the same `system_state` table that `enqueueJob`'s admission check reads. Drain semantics: `boss.updateQueue({paused:true})` + write `drain_requested_at` row + long-poll for in-flight count → 0.
- **Plan 23-06 unblocked** — DB-gated subscriber.spec / correlation.spec / lifecycle-ownership.spec can now exercise the real saga (or assert grep-guards on the post-Plan-23-04 file state).
- **Plan 23-07 close pending** — MODULE.md body, plugin-order.spec extension (3 positional + structural deps array assertion), `.test.ts → .spec.ts` mass rename, deferred-items.md update, Nyquist gate, STATE/ROADMAP final updates.

## Self-Check: PASSED

- ✓ `server/jobs/internal/executor.ts` exists (265 lines)
- ✓ `server/jobs/internal/subscribers.ts` exists (139 lines)
- ✓ `server/jobs/internal/module.ts` exists (231 lines, has createJobsModule)
- ✓ `server/jobs/plugin.ts` exists (70 lines, no bus/bus imports)
- ✓ `server/jobs/job-service.ts` exists (161-line shim)
- ✓ `server/jobs/index.ts` exists (42-line expanded barrel)
- ✓ `server/jobs/job-queue.ts` does NOT exist
- ✓ `server/jobs/__tests__/job-queue.test.ts` does NOT exist
- ✓ `server/jobs/__tests__/job-service.test.ts` does NOT exist
- ✓ `server/jobs/__tests__/module.spec.ts` exists (157 lines, 6 passing tests)
- ✓ `server/jobs/__tests__/idempotency.spec.ts` extended with SC2-strict describe (gated)
- ✓ Commit `20c5cba` (executor.ts) found
- ✓ Commit `5c481b0` (subscribers.ts) found
- ✓ Commit `fa2b961` (createJobsModule factory) found
- ✓ Commit `4412546` (plugin rewrite + shim) found
- ✓ Commit `509eda7` (barrel + delete) found
- ✓ Commit `2a23111` (cross-module subs) found
- ✓ Commit `ffdcccb` (module.spec) found
- ✓ Commit `ac72eb9` (idempotency.spec extension) found
- ✓ Commit `6515e14` (MockLogger fix) found
- ✓ `npm run dep-check` shows 3 violations (down from 7; 4 Phase 23 targets cleared)
- ✓ `npx tsc --noEmit` shows 0 errors in `server/jobs/`
- ✓ `npx vitest run server/jobs/__tests__/module.spec.ts` 6/6 passing

---
*Phase: 23-jobs-module-keystone*
*Completed: 2026-05-08*
