---
phase: 25-pipelines-module
plan: 02
subsystem: infra
tags: [pg-boss, scheduler, node-cron-removal, db-gated]

requires:
  - phase: 25-pipelines-module
    provides: Plan 25-01 queue.ts helpers (upsertPipelineSchedule + removePipelineSchedule + PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME)
  - phase: 18-lifecycle-module
    provides: reconcile + orphan-cleanup pattern (lifecycle/internal/module.ts:70-130) — adapted via getSchedules + unschedule loop
  - phase: 15
    provides: queue plugin (server/queue/plugin.ts) — fastify.boss decorator surface used in DB-gated harness

provides:
  - Rewritten server/pipelines/scheduler.ts (126 lines, was 124) with ZERO node-cron imports
  - boss.schedule-backed addSchedule / removeSchedule / reconcileSchedules / getActiveSchedules
  - Orphan cleanup loop (Pitfall 6) — pgboss.schedule rows whose key is not in pipelineSchedules.id set are auto-unscheduled at boot
  - 2 new DB-gated tests in queue.spec.ts proving SC1 idempotent upsert + Pitfall 3 unschedule
  - Plugin.ts back-compat shim (overloaded ctor) — accepts BOTH legacy (db, logger, pipelineService) and new ({db, logger, boss}) signatures

affects: [25-03-factory-and-service-rewrite, 25-04-db-gated-proofs, 25-05-phase-close]

tech-stack:
  added: []
  patterns:
    - "key:scheduleId is the per-schedule disambiguator at the upsert primitive (proven idempotent in DB-gated test)"
    - "Reconciliation pattern: SELECT enabled rows → upsert each → getSchedules → unschedule orphans (Phase 18 lifecycle pattern adapted for non-singleton multi-key schedules)"
    - "Overloaded constructor for cross-wave compatibility — accepts legacy positional + new deps-object form during Wave-2 → Wave-3 transition"

key-files:
  created: []
  modified:
    - server/pipelines/scheduler.ts
    - server/pipelines/__tests__/queue.spec.ts

key-decisions:
  - "Overloaded constructor (legacy 3-arg + new deps-object) keeps plugin.ts compiling during the Wave-2 → Wave-3 transition rather than accepting a temporary compile error. Boss is undefined under legacy ctor; start() warns and returns instead of crashing boot. Plan 25-03 deletes plugin.ts entirely; this shim retires then."
  - "Synchronous reconcile during onReady (per RESEARCH Open Question 2). With <100 pipelines this is sub-second; if it grows beyond that we revisit deferred async hand-off."
  - "Orphan cleanup is a separate loop after the upsert pass (NOT interleaved). Two passes makes the appKeys Set construction trivial and avoids racing the upsert call against the getSchedules read."
  - "BEHAVIOUR CHANGE: invalid cron now throws at boss.schedule call time (was silent log+skip in legacy node-cron impl at lines 85-88 of pre-rewrite scheduler.ts). Documented in scheduler.ts addSchedule JSDoc."

requirements-completed: [QUEUE-08, MOD-03]

duration: 7min
completed: 2026-05-08
---

# Phase 25 Plan 02: scheduler.ts boss.schedule Migration Summary

**Rewrote server/pipelines/scheduler.ts to ZERO node-cron imports — every schedule mutation now goes through boss.schedule via Plan 25-01's queue.ts helpers, with idempotency + orphan cleanup proven against a real pg-boss instance.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-05-08T11:38Z
- **Completed:** 2026-05-08T11:44Z
- **Tasks:** 2 (Task 2.1 auto, Task 2.2 TDD-style RED w/ existing impl in 25-01)
- **Files modified:** 2 (scheduler.ts, queue.spec.ts)
- **Files created:** 0

## Accomplishments

- **`server/pipelines/scheduler.ts` rewritten end-to-end (126 lines, was 124).** ZERO `node-cron` / `cron.schedule(` / `cron.validate(` callsites remain (verified via grep). The legacy `ScheduleEntry` interface, the `private schedules: Map<...>` in-memory mirror, and the `private registerSchedule()` method are all DELETED. New surface:
  - `reconcileSchedules()` — idempotent boot reconcile: upsert every enabled `pipelineSchedules` row, then enumerate `boss.getSchedules()` and unschedule any pgboss key not in the app-side row set (Pitfall 6 orphan cleanup).
  - `addSchedule(scheduleId)` / `removeSchedule(scheduleId)` — delegate to `upsertPipelineSchedule` / `removePipelineSchedule` from queue.ts. Disabled-or-missing rows in `addSchedule` route to `removePipelineSchedule` so the pgboss view is always consistent with the app-side enabled flag.
  - `getActiveSchedules()` — reads pg-boss directly (no in-memory Map); same return shape as before for back-compat with debug routes / tests.
  - `stop()` — no-op; pg-boss schedules persist across restarts, the worker offWork lives in Plan 25-03's createPipelinesModule shutdown.
  - `start()` — back-compat alias for plugin.ts onReady; calls reconcileSchedules. Removed when plugin.ts is rewritten in 25-03.
- **Overloaded constructor** accepts BOTH the legacy 3-arg form `(db, logger, pipelineService)` (what plugin.ts currently passes) AND the new `({db, logger, boss})` form. Under the legacy form, `boss` is undefined and `start()` logs a warning + returns without crashing — keeps the build green during the Wave-2 → Wave-3 transition. The TypeScript dual-overload signature is verified by the project-wide `npx tsc --noEmit` returning 10 pre-existing errors with ZERO new errors introduced by this plan.
- **`server/pipelines/__tests__/queue.spec.ts` extended with 2 DB-gated tests** under a new `describe.skipIf(!HAS_DB)('Phase 25 — pipelines queue DB-gated proofs (SC1)')` block:
  - **Test A (SC1 idempotent upsert):** `upsertPipelineSchedule` called twice with the same `scheduleId` but different `cronExpression` → `boss.getSchedules()` returns EXACTLY 1 row for that key with the LATEST cron. Proves the `key` parameter behaves as the upsert primitive.
  - **Test B (Pitfall 3 unschedule on delete):** `upsertPipelineSchedule` then `removePipelineSchedule` → `boss.getSchedules()` returns 0 matching rows. Proves the positional-arg unschedule call actually deletes (not silent no-op).
  - Harness mirrors `server/lifecycle/__tests__/queue.spec.ts`: stubConfigPlugin + stubDbPlugin + correlationPlugin + queuePlugin (with isolated `pgboss_pipelines_queue_spec` schema). Both tests use unique UUID scheduleIds.

## Task Commits

Each task was committed atomically:

1. **Task 2.1: scheduler.ts rewrite** — `156a1be` (feat)
2. **Task 2.2: queue.spec DB-gated proofs** — `87bb8cd` (test)

**Plan metadata:** _will be appended on final commit (SUMMARY.md + STATE.md + ROADMAP.md)_

## Files Created/Modified

- `server/pipelines/scheduler.ts` — Rewritten end-to-end. ZERO node-cron imports; 4 helper delegations to queue.ts (upsertPipelineSchedule x3, removePipelineSchedule x2, boss.getSchedules x2, boss.unschedule x1); reconcileSchedules + orphan cleanup loop; overloaded constructor for plugin.ts back-compat.
- `server/pipelines/__tests__/queue.spec.ts` — Extended with 2 DB-gated proofs (idempotent upsert + Pitfall 3 unschedule). Total now: 7 tests (5 mock + 2 DB-gated). With DB env: 7/7 pass. Without DB: 5/5 pass + 2 skipped.

## Decisions Made

- **Overloaded constructor over compile-error acceptance.** Plan recommended either a cross-wave compile break OR a back-compat shim. Chose the shim — adds ~12 lines but keeps `npx tsc --noEmit` and `npm run build` green between Wave-2 (this plan) and Wave-3 (Plan 25-03 plugin.ts rewrite). Risk: legacy ctor calls would silently no-op on boot due to undefined boss. Mitigation: `start()` logs a clear warning identifying the cause; only `plugin.ts` invokes legacy ctor and Plan 25-03 deletes plugin.ts within the same wave-merge window.
- **Synchronous reconcile during onReady** (per Plan + RESEARCH Open Question 2). With <100 pipelines the upsert + orphan-cleanup loop is sub-second. Deferred async hand-off until empirical evidence pushes past that threshold.
- **Orphan cleanup as a separate post-upsert pass.** Two-pass design keeps `appKeys: Set<string>` construction trivial and avoids racing the upsert calls against the `boss.getSchedules` read. Cost: one extra DB roundtrip; benefit: deterministic ordering.
- **BEHAVIOUR CHANGE: invalid cron throws.** Legacy node-cron impl silent-logged and skipped at lines 85-88 of pre-rewrite scheduler.ts. New impl throws at `boss.schedule` call time via pg-boss's CronExpressionParser. Documented in `addSchedule` JSDoc; surfaces validation errors to the route handler instead of swallowing them. Aligns with reporting/jobs Zod-parse-at-boundary pattern.

## Deviations from Plan

**1. [Rule 3 - Blocking issue] Overloaded constructor instead of compile-error acceptance**
- **Found during:** Task 2.1 (constructor rewrite)
- **Issue:** Plan said "RECOMMENDED: just accept the temporary compile error" but the project-wide `npx tsc --noEmit` is the verification gate; a cross-wave compile break would block subsequent CI runs and other phase work between 25-02 and 25-03.
- **Fix:** Implemented dual-signature overloaded constructor — `(deps: PipelineSchedulerDeps)` AND `(db, logger, pipelineService?)` — dispatches based on argument shape (typeof arg1 + arg2 === undefined). Boss is undefined under legacy ctor; start() warns + returns instead of crashing.
- **Files modified:** server/pipelines/scheduler.ts (lines 36-49 ctor body + 51-54 requireBoss helper + 121-124 start() boss-undefined branch)
- **Commit:** 156a1be
- **Plan precedent:** Plan listed this as one of two acceptable approaches ("retaining the OLD constructor signature alongside the new one OR by exporting a thin shim"). Chose the in-class overload over an external shim for locality.

**2. [Rule 1 - Bug] First draft scheduler.ts at 206 lines exceeded plan's 70-130 acceptance range**
- **Found during:** Task 2.1 verification
- **Issue:** Initial JSDoc + dual-ctor + comments → 206 lines; plan acceptance criterion `wc -l 70..130`.
- **Fix:** Compressed JSDoc blocks (single-line where intent obvious), inlined arg destructuring, removed redundant comments. Final: 126 lines (within 70-130 range, target ~100).
- **Files modified:** server/pipelines/scheduler.ts (full file rewrite)
- **Commit:** 156a1be (only one commit for Task 2.1; trim happened pre-commit)

## Authentication Gates

None — no external service auth required for this plan.

## Issues Encountered

- **`pg-boss` Schedule type cast.** The `Schedule` type from `pg-boss` v12 is not directly exported in a way that supports the destructured `{name, cron, key, tz, data}` shape used here at the call sites. Cast each `boss.getSchedules()` result via `(await boss.getSchedules()) as unknown as BossScheduleRow[]` with a local `BossScheduleRow` type alias. Matches the loose-typing pattern from Phase 18 lifecycle scheduler. No runtime impact — the schema is documented in pg-boss source and the cast is gated on the `s.name === PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME` filter.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Plan 25-03 (createPipelinesModule factory + service.ts rewrite + plugin.ts deletion + node-cron drop from package.json) UNBLOCKED:**

- `scheduler.ts` is now node-cron-free; the constructor accepts `{db, logger, boss}` as its primary form. Plan 25-03's factory wires `new PipelineScheduler({ db, logger, boss: fastify.boss })` directly.
- `reconcileSchedules()` is the single boot entry point — Plan 25-03 calls it from createPipelinesModule.registerSchedulesAndWorkers.
- `boss.unschedule()` now lives in `removePipelineSchedule` from queue.ts — Plan 25-03's service.ts deletePipeline cascade calls scheduler.removeSchedule per child schedule (RESEARCH Correction #3 — current service.deletePipeline lines 89-91 leaks pg-boss schedules; this plan provides the helper, 25-03 wires the cascade).
- `package.json` node-cron drop is safe AFTER service.ts rewrite confirms no other in-tree consumer (deferred to 25-03 per plan).

**Verification gates green:**
- `! grep "from 'node-cron'" server/pipelines/scheduler.ts` → exit 1 (zero matches — SC1 critical)
- `! grep -E "import cron from" server/pipelines/scheduler.ts` → exit 1
- `! grep -E "cron\.(schedule|validate)\(" server/pipelines/scheduler.ts` → exit 1
- `! grep "ScheduleEntry" server/pipelines/scheduler.ts` → exit 1
- `! grep "this.schedules.*Map" server/pipelines/scheduler.ts` → exit 1
- `wc -l server/pipelines/scheduler.ts` = 126 (within 70-130 range)
- `npx tsc --noEmit` → 10 pre-existing errors (DEFERRED-15-A inherited + DEFERRED-22-related); ZERO new errors from this plan
- `npx vitest run server/pipelines/__tests__/queue.spec.ts` → 5/5 mock pass, 2 DB-gated skipped (without DB)
- `DATABASE_URL=... npx vitest run server/pipelines/__tests__/queue.spec.ts` → 7/7 pass

## Self-Check: PASSED

**Files modified verified:**
- FOUND: server/pipelines/scheduler.ts
- FOUND: server/pipelines/__tests__/queue.spec.ts

**Commits verified:**
- FOUND: 156a1be (feat 25-02 scheduler.ts rewrite)
- FOUND: 87bb8cd (test 25-02 queue.spec DB-gated proofs)

---
*Phase: 25-pipelines-module*
*Plan: 25-02*
*Completed: 2026-05-08*
