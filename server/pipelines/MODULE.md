# `server/pipelines/` — MODULE.md

## Purpose

The pipelines module owns CI-style multi-stage execution. A pipeline definition declares
sequential stages (script + maestro), runs are scheduled via cron expressions or triggered
via HTTP/manual invocation, and stage advancement is driven by a `job.completed` bus
subscriber that joins `pipeline_stage_jobs` to identify which stages depend on a completed
job. Phase 25 closed two migrations: (1) `node-cron` → `boss.schedule()` (last `node-cron`
consumer in the codebase — `node-cron` + `@types/node-cron` dropped from `package.json`),
and (2) Promise-chain `executeRun` → bus subscriber stage advancement (the local Promise
chain in `internal/service.executeRun` and the polling loop are deleted; `internal/executor.ts`
is now pure with only `executeScript` + `evaluateCondition`).

## Public API

Exports from `server/pipelines/index.ts` (the ONLY legitimate import surface outside this
module — enforced by the `dependency-cruiser` rule `no-deep-imports-into-pipelines-internal`
added in Phase 25 Plan 25-00 as the 9th forbidden rule).

- **Plugin:** `pipelinesPlugin` (default — name `'pipelines-plugin'`, dependencies
  `['config', 'db', 'queue', 'event-bus', 'websocket-plugin', 'job-plugin']`).
- **Factory (canonical v3.0):** `createPipelinesModule(deps)` + types `PipelinesModule`,
  `CreatePipelinesModuleDeps` (MOD-06).
- **Back-compat classes (decorators on fastify still consume these):** `PipelineService`,
  `PipelineScheduler`, `PipelineBroadcaster`, `SecretsService`, `GitService`.
- **Events surface:** `pipelinesRegistry`, `makePipelinesEmitters`, `PIPELINE_EVENT_NAMES`,
  `PIPELINE_RUN_AGGREGATE_ID`, `PIPELINE_RUN_AGGREGATE_TYPE`, `PIPELINE_SCHEDULE_AGGREGATE_TYPE`,
  5 payload schemas + inferred types (`PipelineEventName`, `PipelinesRegistry`,
  `PipelinesEmitters`).
- **Queue surface:** `PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME`,
  `pipelineScheduledExecutePayloadSchema`, `PipelineScheduledExecutePayload`,
  `registerPipelineScheduledExecuteQueue`, `registerPipelineScheduledExecuteWorker`,
  `upsertPipelineSchedule`, `removePipelineSchedule`.

Fastify decorators exposed by the plugin:

- `fastify.pipelinesModule: PipelinesModule` (NEW canonical surface)
- `fastify.pipelineService: PipelineService` (back-compat)
- `fastify.pipelineBroadcaster: PipelineBroadcaster` (back-compat)
- `fastify.secretsService: SecretsService` (back-compat)
- `fastify.gitService: GitService` (back-compat)
- `fastify.pipelineScheduler: PipelineScheduler` (back-compat)

## Events Emitted

| Name                          | Persisted (TRACE-08) | Aggregate Type      | Payload                                                |
| ----------------------------- | -------------------- | ------------------- | ------------------------------------------------------ |
| `pipeline.run.started`        | NO                   | `pipeline-run`      | `{runId, pipelineId, triggerType: api\|schedule\|manual}` |
| `pipeline.stage.advanced`     | NO                   | `pipeline-run`      | `{runId, stageIndex, stageName, status: passed\|failed\|skipped}` |
| `pipeline.run.completed`      | **YES**              | `pipeline-run`      | `{runId, pipelineId, status, durationMs}`              |
| `pipeline.run.failed`         | **YES**              | `pipeline-run`      | `{runId, pipelineId, reason, failedStageIndex}`        |
| `pipeline.schedule.upserted`  | NO                   | `pipeline-schedule` | `{scheduleId, pipelineId, cron}`                       |

Persistence policy per TRACE-08: terminal saga facts (`run.completed` / `run.failed`) land
in the `events` table; high-frequency derivable signals stay transient.

## Events Consumed

| Name             | Source        | Action                                                                              |
| ---------------- | ------------- | ----------------------------------------------------------------------------------- |
| `job.completed`  | `jobs` module | DB-driven join on `pipeline_stage_jobs.jobId` → advance owning stage; matrix N-of-N gate. NEVER routed via envelope correlationId (Pitfall 4). |

Subscription deferred to `fastify.addHook('onReady', ...)` per Pitfall 5 (Phase 23
inheritance) — `fastify.jobsModule.bus` is decorated by the jobs plugin, but pipelines
plugin runs after; deferral keeps the wiring agnostic to plugin-order shifts.

## Queue Produced

- `pipeline.scheduled.execute` (`PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME`) — created via
  `boss.createQueue` with `policy: 'standard'` + `retryLimit: 0`. Per-`pipelineSchedules.id`
  schedules are upserted via `boss.schedule(name, cron, data, { key: scheduleId, tz: 'UTC' })`
  (NOT `singletonKey`, NOT `pipelineId` — `key` is the pg-boss v12 schedule disambiguator
  per Pitfall 1).

## Queue Consumed

- `pipeline.scheduled.execute` (self-consumed) — worker invokes
  `service.triggerRun(pipelineId, 'schedule', variables)` and updates
  `pipelineSchedules.lastRunAt`.

## Invariants

1. **`pipeline_stage_jobs.jobId` is the routing primitive for stage advancement, NOT envelope
   correlationId** (Pitfall 4). The `job.completed` subscriber DB-joins on `jobId` to find
   the owning stage; correlationId is for trace tooling only. Tested by
   `__tests__/subscriber.spec.ts` and `__tests__/lifecycle-ownership.spec.ts`.
2. **Matrix stages: stage status writes ONLY when ALL matrix entries are terminal**
   (Pitfall 8 — N-of-N gate). The subscriber inspects sibling rows in `pipeline_stage_jobs`
   for the same stage and short-circuits if any sibling is still `running`. Tested by
   `__tests__/subscriber.spec.ts -t "matrix"`.
3. **`service.deletePipeline(id)` cascades `boss.unschedule` for every child schedule
   before deleting the row** (Pitfall 3 — orphan schedule prevention). Tested by
   `__tests__/queue.spec.ts -t "unschedule on delete"`.
4. **`scheduler.reconcileSchedules()` is idempotent on every boot** (Pitfall 6 —
   `pgboss.schedule` converges to `pipelineSchedules.enabled=true` rows; orphans removed).
   Tested by `__tests__/queue.spec.ts -t "idempotent upsert"`.
5. **ZERO `node-cron` imports anywhere in `server/`** — last consumer (`internal/scheduler.ts`)
   migrated to `boss.schedule` in Plan 25-02 + 25-03; `node-cron` + `@types/node-cron` dropped
   from `package.json` in Plan 25-03. Tested by
   `__tests__/lifecycle-ownership.spec.ts -t "zero node-cron"`.

## Non-Goals

- **Pipeline DAG / parallel stages** (DEFERRED-25-B). Sequential stages only; v2 territory.
- **Script-stage durability across server restart** (DEFERRED-25-G). Mid-script crash on
  restart still hangs the run; out of scope for Phase 25.
- **Per-schedule timezone column** (DEFERRED-25-F). All schedules default to UTC
  (Pitfall 10); future feature phase may add a per-schedule tz column.
- **persistEnvelope consolidation** (DEFERRED-25-A — 9TH SAMPLE POINT). Phase 27+ owns the
  tree-wide extraction across hooks/lifecycle/reporting/pool/artifacts/streaming/jobs/
  maestro/pipelines.
- **Pipeline definition language / grammar changes** (out of scope). Current YAML schema
  (`internal/pipeline-schema.ts`) preserved as-is.
- **Pipeline-run cancellation API as a public surface** — DEFERRED-25-C resolved IN-phase
  by preserving `runningRuns: Map<runId, AbortController>` for in-process script-stage
  abort + a DB `pipelineRuns.status='cancelled'` short-circuit in
  `subscribers.advanceRunOrComplete`. No new public API.
- **`pipelineRuns.correlationId` column** (DEFERRED-25-E). Phase 27's events-trace API may
  add it if the convenience trumps the events-table aggregateId join. Phase 25 relies on
  ALS-driven envelope correlationId.
- **Maestro test rewrite** (DEFERRED-24-A inherited as DEFERRED-25-D) — Phase 30 Test
  Migration Cleanup owns the tests-as-spec rewrite of inherited modules.
- **`integration.spec.ts` rewrite cost-balloon fallback** (DEFERRED-25-H). The legacy
  integration test asserted on synchronous `executeRun` semantics (Pitfall 7); under the
  new bus-driven flow it is wrapped in `it.skip` with a TODO pointing at Phase 30 Test
  Migration Cleanup.

## Dependencies

Plugin name: `'pipelines-plugin'` (preserved for back-compat with `plugin-order.spec` +
any dependency-array references).

Plugin dependencies array (verbatim from `server/pipelines/plugin.ts`): 6 entries.

```
['config', 'db', 'queue', 'event-bus', 'websocket-plugin', 'job-plugin']
```

- `config` — for `SecretsService` + `GitService` configuration (workspace dir, secret
  encryption key).
- `db` — for `persistEnvelope` middleware (writes terminal events
  `run.completed` / `run.failed` to the `events` table) and for service-layer Drizzle
  queries.
- `queue` — for `fastify.boss` + `fastify.queue` (`registerPipelineScheduledExecuteQueue`,
  `registerPipelineScheduledExecuteWorker`, `upsertPipelineSchedule`,
  `removePipelineSchedule`).
- `event-bus` — `createEventHelpers` + ALS-aware envelope stamping.
- `websocket-plugin` — pipeline runs broadcast via `fastify.pipelineBroadcaster` over WS;
  websocket plugin must register first to provide the WS substrate.
- `job-plugin` — pipelines subscribes to `fastify.jobsModule.bus.on('job.completed', …)`
  in `onReady`; jobs plugin must register first to decorate `jobsModule`.

Module dependencies (consumed via fastify decorators in the factory):

- `fastify.db` — Drizzle queries + `persistEnvelope` writes.
- `fastify.boss` — pg-boss queue + schedule API.
- `fastify.queue` — ALS-aware `boss.send` wrapper for any in-band enqueues.
- `fastify.jobsModule.bus` — subscribe to `job.completed` in `registerSubscribers`.
- `fastify.config` — workspace + secret-encryption configuration.
- `fastify.log` — child logger named `'pipelines'` (MOD-07).

## Runnable Example

```typescript
// Trigger a pipeline run programmatically and observe stage advancement events.
import type { FastifyInstance } from 'fastify';

export async function runPipelineWithObservers(fastify: FastifyInstance, pipelineId: string) {
  // Subscribe BEFORE triggering — bus subscribers fire on every stage transition.
  fastify.pipelinesModule.bus.on('pipeline.stage.advanced', (payload) => {
    fastify.log.info(
      { runId: payload.runId, stageIndex: payload.stageIndex, stageName: payload.stageName, status: payload.status },
      'Pipeline stage advanced',
    );
  });

  fastify.pipelinesModule.bus.on('pipeline.run.completed', (payload) => {
    fastify.log.info(
      { runId: payload.runId, status: payload.status, durationMs: payload.durationMs },
      'Pipeline run completed',
    );
  });

  // Trigger a run via the API surface (also reachable via POST /api/pipelines/:id/run).
  const { runId } = await fastify.pipelinesModule.service.triggerRun(
    pipelineId,
    'manual',
    { ENV: 'staging' },
  );

  return runId;
}

// Schedule a recurring pipeline run via cron (boss.schedule, not node-cron):
//
//   await fastify.pipelinesModule.service.upsertSchedule({
//     pipelineId,
//     scheduleId: 'nightly-build',
//     cron: '0 2 * * *',  // 02:00 UTC daily
//     variables: { ENV: 'production' },
//   });
//
// Internally calls upsertPipelineSchedule({boss, scheduleId, pipelineId, cron, variables})
// from server/pipelines/queue.ts which calls boss.schedule(name, cron, data, {key, tz:'UTC'}).
//
// Example envelope on the bus when a scheduled run fires:
// {
//   "type": "pipeline.run.started",
//   "v": 1,
//   "ts": "2026-05-08T02:00:00.000Z",
//   "correlationId": "9c8a3d3c-8f7e-4a12-7f4c-3e902c8f47c1",
//   "aggregateType": "pipeline-run",
//   "aggregateId": "...runId...",
//   "payload": { "runId": "...", "pipelineId": "...", "triggerType": "schedule" }
// }
```

References to RESEARCH pitfalls: Pitfall 1 (`key` not `singletonKey`), Pitfall 3 (cascade
unschedule on delete), Pitfall 4 (DB-join routing primitive), Pitfall 5 (`onReady` cross-module
subscription), Pitfall 6 (idempotent reconcile), Pitfall 7 (bus-driven async semantics — no
synchronous Promise hold), Pitfall 8 (matrix N-of-N gate), Pitfall 10 (UTC tz explicit). See
`.planning/phases/25-pipelines-module/25-RESEARCH.md`.
