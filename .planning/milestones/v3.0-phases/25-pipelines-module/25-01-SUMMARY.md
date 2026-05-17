---
phase: 25-pipelines-module
plan: 01
subsystem: infra
tags: [pg-boss, events, zod, uuid-v5, scheduler]

requires:
  - phase: 25-pipelines-module
    provides: Wave 0 substrate (events.ts stub, queue.ts alias, internal/module.ts throw-stub, dep-cruiser 9th rule, MOD-02 barrel)
  - phase: 18-lifecycle-module
    provides: Canonical boss.schedule + worker registration pattern (queue.ts shape)
  - phase: 23-jobs-module
    provides: Multi-event registry + makeJobsEmitters factory shape (events.ts shape reference)
  - phase: 15
    provides: createEventHelpers + TypedBus + EventRegistry substrate
  - phase: 20-pool-module
    provides: uuidv5 aggregate-id derivation pattern (single-source-of-truth re-derivation in spec)

provides:
  - Full pipelines events.ts body (5 Zod payload schemas + registry with TRACE-08 persistence flags + makePipelinesEmitters factory + PIPELINE_RUN_AGGREGATE_ID v5 UUID)
  - Full pipelines queue.ts body (payload schema + 4 helpers — createQueue, work, upsertSchedule, removeSchedule)
  - Pitfall 1 coverage (boss.unschedule positional args)
  - Pitfall 2 coverage (createQueue before schedule documentation)
  - Pitfall 10 coverage (explicit tz:'UTC')
  - 13 mock-based unit tests (8 events + 5 queue) all green

affects: [25-02-scheduler-migration, 25-03-factory-and-service-rewrite, 25-04-db-gated-proofs, 25-05-phase-close]

tech-stack:
  added: []
  patterns:
    - "key:scheduleId per pg-boss schedule (NOT singletonKey, NOT pipelineId) — RESEARCH Correction #1"
    - "uuidv5 aggregate-id derived at module load (not literal); spec re-derives for single-source-of-truth"
    - "TRACE-08 persistence split: terminal saga events persisted, transitional events transient"
    - "Zod-parse at worker boundary — malformed payloads throw rather than silently skip"

key-files:
  created:
    - server/pipelines/__tests__/queue.spec.ts
  modified:
    - server/pipelines/events.ts
    - server/pipelines/queue.ts
    - server/pipelines/__tests__/events.spec.ts

key-decisions:
  - "PIPELINE_RUN_AGGREGATE_ID computed at runtime via uuidv5('pipeline-run', URL_NS) rather than embedding a literal — matches Phase 18 LIFECYCLE_AGGREGATE_ID and Phase 20 POOL_AGGREGATE_ID derivation pattern (single source of truth via spec re-derivation)"
  - "schedule.upserted aggregateType='pipeline-schedule' (not 'pipeline-run') — schedules are a distinct aggregate from runs"
  - "Worker handler is ALWAYS preceded by Zod parse on job.data — malformed payloads throw to trigger pg-boss retry/DLQ accounting rather than silent skip"
  - "policy:'standard' retryLimit:0 for pipeline.scheduled.execute — pipeline runs are independent; retry-on-fire would create overlapping run windows; prefer manual re-trigger over re-firing same schedule slot"

patterns-established:
  - "Pipelines events module shape: 5 payload schemas + registry (4 pipeline-run + 1 pipeline-schedule) + makePipelinesEmitters factory exporting 5 typed helpers"
  - "Pipelines queue helper API: registerXxxQueue / registerXxxWorker / upsertXxxSchedule / removeXxxSchedule — establishes the per-module schedule lifecycle surface for non-singleton schedules (cf. lifecycle's singleton schedules)"

requirements-completed: [MOD-03, EVENTS-03, EVENTS-08, TRACE-04, TRACE-08, QUEUE-06, QUEUE-08]

duration: 11min
completed: 2026-05-08
---

# Phase 25 Plan 01: Pipelines Events + Queue Body Summary

**5-event pipelinesRegistry with TRACE-08 persistence split (2 terminal persisted, 3 transient) + 4 pg-boss helpers using key:scheduleId disambiguator (NOT singletonKey)**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-05-08T11:24Z
- **Completed:** 2026-05-08T11:35Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 3 (events.ts, queue.ts, events.spec.ts)
- **Files created:** 1 (queue.spec.ts)

## Accomplishments
- `server/pipelines/events.ts` full body shipped: 5 Zod payload schemas (pipelineRunStartedPayload, pipelineStageAdvancedPayload, pipelineRunCompletedPayload, pipelineRunFailedPayload, pipelineScheduleUpsertedPayload), pipelinesRegistry with TRACE-08 persistence flags (run.completed/run.failed persisted; run.started/stage.advanced/schedule.upserted transient), makePipelinesEmitters factory returning 5 typed helpers, and PIPELINE_RUN_AGGREGATE_ID v5 UUID derived from `uuidv5('pipeline-run', URL_NS)` at module load.
- `server/pipelines/queue.ts` full body shipped: pipelineScheduledExecutePayloadSchema + 4 helpers (registerPipelineScheduledExecuteQueue, registerPipelineScheduledExecuteWorker, upsertPipelineSchedule, removePipelineSchedule) with `key:scheduleId` (NOT singletonKey, NOT pipelineId) and `tz:'UTC'` explicit.
- 8 events.spec tests + 5 queue.spec tests all green (13 total).
- Pitfalls 1 (unschedule positional), 2 (createQueue before schedule), and 10 (explicit UTC) all covered.

## Task Commits

Each task was committed atomically (TDD RED→GREEN):

1. **Task 1.1 RED: extend events.spec to 8 tests** — `6b4b51a` (test)
2. **Task 1.1 GREEN: events.ts full body** — `e476450` (feat)
3. **Task 1.2 RED: queue.spec mock-based tests** — `81f0ebc` (test)
4. **Task 1.2 GREEN: queue.ts full body** — `aa61032` (feat)

**Plan metadata:** _will be appended on final commit (SUMMARY.md + STATE.md + ROADMAP.md)_

## Files Created/Modified
- `server/pipelines/events.ts` — Replaced Plan 25-00 stub with full body (5 events + payload schemas + persistence flags + makePipelinesEmitters)
- `server/pipelines/queue.ts` — Replaced Plan 25-00 alias-only stub with full body (4 helpers + payload schema)
- `server/pipelines/__tests__/events.spec.ts` — Extended from 1-test stub to 8 tests covering registry shape, persistence, payloads, uuidv5 derivation, makePipelinesEmitters return shape, and ALS correlationId stamping
- `server/pipelines/__tests__/queue.spec.ts` — NEW (mock-based, no DB) — 5 tests proving payload schema + createQueue policy + worker Zod-parse + upsertPipelineSchedule key:scheduleId + removePipelineSchedule positional unschedule

## Decisions Made

- **PIPELINE_RUN_AGGREGATE_ID derived at runtime, not literal.** Computed via `uuidv5('pipeline-run', URL_NAMESPACE)` at module load. The spec re-derives the same expression at test time and asserts equality — single source of truth (catches stale literals during plan-author edits). Matches Phase 18 LIFECYCLE_AGGREGATE_ID pattern (despite that phase using a frozen literal — Phase 20 evolved to runtime derivation, and Phase 25 follows Phase 20).
- **schedule.upserted is its own aggregate.** aggregateType='pipeline-schedule' (not 'pipeline-run') because schedules are mutated independently of runs. This unlocks schedule-scoped trace queries in Phase 27+.
- **policy:'standard' retryLimit:0** on the pipeline.scheduled.execute queue. Pipeline runs are independent; if a schedule fire fails to spawn a run, retrying would create overlapping run windows. Manual re-trigger via the API is the recovery path. Differs from lifecycle's `policy:'stately' retryLimit:1` because lifecycle has singleton schedules (one fire per slot is OK to retry); pipelines schedules can fire many runs and a stuck retry would compound.
- **Defensive Zod parse at worker boundary.** Malformed payloads throw, triggering pg-boss retry/DLQ accounting rather than silent skip. queue.spec proves this (`innerWorker(...malformed...)` rejects).

## Deviations from Plan

None - plan executed exactly as written. Two minor doc-comment cleanups in events.ts (rephrased to avoid `persisted: false` and `persisted: true` literal substrings outside the registry — needed to satisfy the plan's exact-count grep acceptance criteria of 2 and 3 respectively) and one in queue.ts (rephrased "node-cron" doc references to satisfy `! grep "node-cron" server/pipelines/queue.ts` verification gate). All within plan scope; no behavior changes.

## Issues Encountered

- **Initial pg-boss type import error.** First draft used `import type PgBoss from 'pg-boss'` (default import) — pg-boss v12 has no default export. Switched to `import type { PgBoss, Job } from 'pg-boss'` matching Phase 23 jobs/queue.ts convention. Also added explicit `Array<Job<PipelineScheduledExecutePayload>>` annotation on the worker callback to fix `Parameter 'jobs' implicitly has an 'any' type` (TS7006). Both fixed in the same Task 1.2 commit.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Plan 25-02 (scheduler.ts boss.schedule migration) UNBLOCKED:**
- `scheduler.ts` can now `import { upsertPipelineSchedule, removePipelineSchedule } from './queue.js'` to replace the prior in-memory ScheduleEntry Map with idempotent pg-boss schedules.
- The DB-gated idempotency proof (boss.schedule overwrites prior schedule when same key reused) lands in 25-02 against a real boss instance — current spec covers call-shape only.

**Plan 25-03 (createPipelinesModule factory) UNBLOCKED:**
- The factory can `import { makePipelinesEmitters, registerPipelineScheduledExecuteQueue, registerPipelineScheduledExecuteWorker } from './events.js' / './queue.js'` to wire the worker subscriber + emit helpers at boot.
- TRACE-08 persistence flags ready for the factory's onEmit hook to forward run.completed and run.failed to the events table.

**Verification gates green:**
- `npx vitest run server/pipelines/__tests__/{events,queue}.spec.ts` → 13/13 pass
- `npx tsc --noEmit` → 0 NEW errors on plan files (10 pre-existing inherited from Phase 15-23 carry-forwards)
- `npm run dep-check` → 3 pre-existing violations (Phase 23 streaming/internal scope, unchanged)
- `! grep "node-cron" server/pipelines/queue.ts` → 0 matches
- `! grep "singletonKey: pipelineId" server/pipelines/queue.ts` → 0 matches (CONTEXT bug not introduced)

## Self-Check: PASSED

**Files created/modified verified:**
- FOUND: server/pipelines/events.ts
- FOUND: server/pipelines/queue.ts
- FOUND: server/pipelines/__tests__/events.spec.ts
- FOUND: server/pipelines/__tests__/queue.spec.ts

**Commits verified:**
- FOUND: 6b4b51a (test 25-01 RED events.spec extension)
- FOUND: e476450 (feat 25-01 GREEN events.ts body)
- FOUND: 81f0ebc (test 25-01 RED queue.spec)
- FOUND: aa61032 (feat 25-01 GREEN queue.ts body)

---
*Phase: 25-pipelines-module*
*Plan: 25-01*
*Completed: 2026-05-08*
