---
phase: 25-pipelines-module
verified: 2026-05-08T00:00:00Z
status: passed
score: 3/3 must-haves verified
---

# Phase 25: Pipelines Module Verification Report

**Phase Goal:** Migrate pipeline scheduler from `node-cron` (last holdout) to `boss.schedule()`; have pipelines subscribe to `job.completed` for stage advancement instead of polling.

**Verified:** 2026-05-08
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `node-cron` no longer imported anywhere in `server/`; `package.json` drops `node-cron` + `@types/node-cron`; pipeline CRUD ops idempotently upsert via `boss.schedule()` with `key: scheduleId`; `service.deletePipeline` cascades `boss.unschedule` | VERIFIED | `grep -rE "from 'node-cron'" server/ --include='*.ts'` returns ONLY test-body mentions in `lifecycle-ownership.spec.ts`. `grep -c "node-cron" package.json` returns 0; `@types/node-cron` returns 0. `server/pipelines/queue.ts:111-126` `upsertPipelineSchedule` calls `boss.schedule(name, cron, data, {key: scheduleId, tz: 'UTC'})`. `server/pipelines/internal/service.ts:140-151` `deletePipeline` iterates child schedules and calls `removePipelineSchedule({boss, scheduleId})` (Pitfall 3 cascade). |
| 2 | Pipeline stage advancement driven by subscriber to `job.completed` via DB join on `pipeline_stage_jobs.jobId`; matrix N-of-N gate via DB aggregate; 3-stage pipeline completes without local Promise chain | VERIFIED | `server/pipelines/internal/subscribers.ts:44-128` subscribes to `jobsModule.bus.on('job.completed', ...)`; lines 49-61 perform DB join `pipelineStageJobs.jobId → pipelineStageRuns`; lines 68-78 implement matrix N-of-N gate (`allTerminal = matrixState.every(...)`). `server/pipelines/internal/executor.ts` is 108 lines, pure (only `executeScript` + `evaluateCondition`), zero Promise chain or `executeRun`. `server/pipelines/internal/service.ts:5` documents "executeRun() Promise-chain DELETED (was lines 198-380)". `server/pipelines/internal/service.ts:617` documents "NO polling — subscriber takes over." `subscriber.spec.ts` includes `[SC2] 3-stage sequential pipeline completes via bus events (no local Promise chain)` and `[SC2 + Pitfall 8] matrix N-of-N gate` tests. |
| 3 | Pipelines module follows Phase 16 conventions (MODULE.md 9-section + barrel + internal/ + factory + tests-as-spec); plugin-order.spec extension; Nyquist passes | VERIFIED | `server/pipelines/MODULE.md` has 10 H2 sections (the 9 canonical + Runnable Example): Purpose, Public API, Events Emitted, Events Consumed, Queue Produced, Queue Consumed, Invariants, Non-Goals, Dependencies, Runnable Example. `server/pipelines/index.ts` MOD-02 strict — first non-comment export is `createPipelinesModule, type PipelinesModule, type CreatePipelinesModuleDeps from './internal/module.js'`. `server/pipelines/internal/` directory present with module.ts, scheduler.ts, service.ts, executor.ts, subscribers.ts, broadcaster.ts, git-service.ts, secrets.ts. 11 `.spec.ts` files in `__tests__/`, 0 `.test.ts` files (MOD-04 closed). `server/__tests__/plugin-order.spec.ts:337-379` Phase 25 additive block with 6 assertions (queueIdx<pipelinesIdx, eventBusIdx<pipelinesIdx, jobPluginIdx<pipelinesIdx, deps literal, grep-friendly literal, MODULE.md 9-count). `.dependency-cruiser.cjs:168` 9th rule `no-deep-imports-into-pipelines-internal` present. Nyquist baseline.json unchanged since Phase 15 commit; SUMMARY reports +3.01pp delta within -2pp budget. |

**Score:** 3/3 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/pipelines/internal/scheduler.ts` | boss.schedule migration; zero node-cron imports; reconcileSchedules + orphan cleanup | VERIFIED | 127 lines. Imports `upsertPipelineSchedule`, `removePipelineSchedule` from `../queue.js`. `reconcileSchedules()` upserts enabled rows + unschedules orphan keys (Pitfall 6). No `node-cron` import. |
| `server/pipelines/queue.ts` | Payload schema + 4 helpers (createQueue, work, upsert with `key:scheduleId`, remove positional) | VERIFIED | 140 lines. `pipelineScheduledExecutePayloadSchema` (Zod) + `registerPipelineScheduledExecuteQueue` (createQueue policy:'standard' retryLimit:0) + `registerPipelineScheduledExecuteWorker` + `upsertPipelineSchedule` (uses `key: scheduleId, tz:'UTC'` per Pitfall 1) + `removePipelineSchedule` (positional `boss.unschedule(name, key)`). |
| `server/pipelines/internal/subscribers.ts` | Subscriber to `job.completed` with DB join + matrix N-of-N gate | VERIFIED | 132 lines. `wirePipelinesStageAdvancementSubscriber` subscribes to `jobsModule.bus.on('job.completed')`. Routing primitive is `payload.jobId` (NOT envelope.correlationId per Pitfall 4). Matrix gate aggregates ALL `pipelineStageJobs` rows for stageRunId; advances only when all terminal. |
| `server/pipelines/internal/executor.ts` | Pure (executeScript + evaluateCondition only); no Promise chain | VERIFIED | 108 lines. Only `class PipelineExecutor` with `evaluateCondition` (lines 29-33) and `executeScript` (lines 35-107). No `executeRun`, no `Promise.all` orchestration. |
| `server/pipelines/internal/service.ts` | `deletePipeline` cascade unschedules child schedules; no polling; no Promise chain | VERIFIED | 26.7K. Imports `removePipelineSchedule`. `deletePipeline` (line 140) iterates child schedules and calls `removePipelineSchedule` per row (Pitfall 3). Header comment at line 5 documents "executeRun() Promise-chain DELETED". Line 617 "NO polling — subscriber takes over". |
| `server/pipelines/MODULE.md` | 9-section canonical body + Runnable Example | VERIFIED | 10 H2 headings present (the 9 canonical + Runnable Example). Pitfall references throughout. |
| `server/pipelines/index.ts` | MOD-02 strict barrel — internal/module.js re-export FIRST | VERIFIED | 64 lines. First non-comment export is `createPipelinesModule, type PipelinesModule, type CreatePipelinesModuleDeps from './internal/module.js'`. Re-exports `pipelinesPlugin` default, 5 back-compat classes, events surface, queue surface. |
| `package.json` | `node-cron` + `@types/node-cron` removed | VERIFIED | `grep -c "node-cron"` returns 0; `grep -c "@types/node-cron"` returns 0. `pg-boss ^12.15.0` present. |
| `server/__tests__/plugin-order.spec.ts` | Phase 25 additive block (6 assertions) | VERIFIED | Phase 25 block at lines 337-379. queueIdx<pipelinesIdx, eventBusIdx<pipelinesIdx, jobPluginIdx<pipelinesIdx, deps literal extracted via readFileSync regex, grep-friendly single-line literal, MODULE.md 9-section count. Reuses Phase 24's `pipelinesIdx` const (no duplicate). |
| `.dependency-cruiser.cjs` | 9th rule `no-deep-imports-into-pipelines-internal` | VERIFIED | Rule definition at line 168; comment-block reference at line 39. |
| `server/pipelines/__tests__/*.spec.ts` | All `.test.ts` renamed to `.spec.ts` (MOD-04) | VERIFIED | `find ... -name '*.test.ts'` returns 0. `find ... -name '*.spec.ts'` returns 11 (correlation, events, executor, git-service, integration, lifecycle-ownership, module, parser, queue, secrets, subscriber). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `server/pipelines/internal/scheduler.ts` | `server/pipelines/queue.ts` | `upsertPipelineSchedule({key: scheduleId})` | WIRED | Line 16-19 imports; lines 63-68, 91-95 call upsertPipelineSchedule. |
| `server/pipelines/internal/service.ts` (deletePipeline) | `server/pipelines/queue.ts` (removePipelineSchedule) | Cascade on child schedules per Pitfall 3 | WIRED | Line 31 imports `removePipelineSchedule`; lines 140-151 iterate child schedules and call it inside try/catch. |
| `server/pipelines/internal/module.ts` | `server/pipelines/internal/subscribers.ts` | `wirePipelinesStageAdvancementSubscriber` | WIRED | Imports `wirePipelinesStageAdvancementSubscriber from './subscribers.js'`; calls it at boot. |
| `server/pipelines/internal/module.ts` | `server/pipelines/queue.ts` | `registerPipelineScheduledExecuteQueue` + `registerPipelineScheduledExecuteWorker` | WIRED | Both registers imported and called at module boot. |
| `server/pipelines/internal/subscribers.ts` | `jobsModule.bus` | `jobsModule.bus.on('job.completed', ...)` | WIRED | Line 44 subscribes via injected jobsModule; routes via `payload.jobId` (Pitfall 4). |
| `subscriber.spec.ts` | DB integration | 3-stage sequential + matrix N-of-N gate | WIRED | Two `[SC2]` it-blocks present testing the subscriber end-to-end via DB-gated `vi.waitFor`. |
| `lifecycle-ownership.spec.ts` | grep-guards | 4 guards (zero node-cron + executor pure + service no polling + package.json clean) | WIRED | All 4 tests pass (verified via `npx vitest run`). |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| MOD-01 | 25-00, 25-05 | MODULE.md exists with 9 canonical sections | SATISFIED | 10 H2 sections (9 canonical + Runnable Example). |
| MOD-02 | 25-00, 25-03, 25-05 | Strict 1-line internal re-export FIRST in barrel | SATISFIED | `index.ts` first export is `from './internal/module.js'`. Dep-cruiser rule 9 enforces. |
| MOD-03 | 25-01 | Events surface in events.ts (PIPELINE_EVENT_NAMES, registry, emitters) | SATISFIED | `events.ts` 7.5K with 5 names + registry + makePipelinesEmitters. |
| MOD-04 | 25-05 | All test files use .spec.ts (not .test.ts) | SATISFIED | 0 `.test.ts` files; 11 `.spec.ts` files. |
| MOD-05 | 25-00 | Dep-cruiser rule prevents deep imports into internal/ | SATISFIED | Rule 9 `no-deep-imports-into-pipelines-internal` in `.dependency-cruiser.cjs`. |
| MOD-06 | 25-03 | Factory-injected deps (createPipelinesModule with CreatePipelinesModuleDeps) | SATISFIED | Factory exists; subscriber.ts WireSubscriberDeps injected. |
| MOD-07 | 25-01, 25-03 | TRACE-08 persistence flags on terminal events | SATISFIED | run.completed + run.failed marked PERSISTED per MODULE.md events table. |
| MOD-08 | 25-03 | Plugin.ts thin wirer delegates to factory | SATISFIED | `plugin.ts` 3.1K (down from legacy ~10K). |
| MOD-09 | 25-04 | DB-gated proofs (subscriber.spec, correlation.spec, lifecycle-ownership.spec) | SATISFIED | All three specs present and passing. |

No orphaned requirements detected — all phase plan requirement IDs map to evidence in code.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | — | — | All scanned files clean of TODO/FIXME blockers; node-cron only mentioned in test bodies (lifecycle-ownership grep-guards) and doc citations (expected). |

### Human Verification Required

None — all checks programmatically verifiable via grep + spec execution. The lifecycle-ownership.spec passes its 4 grep guards; subscriber.spec exercises end-to-end bus flow through DB; queue.spec proves SC1 idempotency.

### Gaps Summary

No gaps. All three Success Criteria from ROADMAP § Phase 25 close cleanly:

- **SC1:** node-cron is fully eliminated from server/ (only test-body string mentions remain in lifecycle-ownership.spec.ts grep-guards), package.json + lockfile clean, pipeline CRUD ops upsert via `boss.schedule(name, cron, data, {key: scheduleId, tz:'UTC'})`, and `deletePipeline` cascades unschedules per Pitfall 3.
- **SC2:** Stage advancement is driven entirely by `wirePipelinesStageAdvancementSubscriber` listening on `jobsModule.bus.on('job.completed')`; payload.jobId is the routing primitive (NOT correlationId — Pitfall 4); matrix N-of-N gate aggregates `pipelineStageJobs` rows; executor.ts is pure (108 lines, no executeRun); service.executeRun + polling deleted (header comment at line 5 documents removal); 3-stage sequential + matrix proofs in subscriber.spec.
- **SC3:** Phase 16 conventions all met — MODULE.md 9 H2 + Runnable Example; barrel MOD-02 strict first; internal/ encapsulation enforced by dep-cruiser rule 9; all `.test.ts` renamed to `.spec.ts` (MOD-04 closed); plugin-order.spec extended with 6 additive Phase 25 assertions; Nyquist baseline UNCHANGED since Phase 15, current delta +3.01pp within -2pp budget.

The pipelines module is the LAST node-cron consumer in v3.0 — pg-boss is now the sole scheduler in the project.

---

_Verified: 2026-05-08_
_Verifier: Claude (gsd-verifier)_
