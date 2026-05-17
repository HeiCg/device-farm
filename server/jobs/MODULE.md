# jobs

Phase 23 Jobs Module Keystone (EVENTS-10 / QUEUE-03 / CLI-05 / DEBT-02).

## Purpose

Owns the job lifecycle saga (`queued → allocated → running → completed → recording → webhook → cleanup`) per EVENTS-10. Replaces imperative coupling in `executeJob` with a chained-subscriber saga over the typed bus, where every transition emits a named event and every cross-module hand-off (recording, webhook, cleanup) is a bus subscription instead of a direct call.

Owns the `job.execute` queue (QUEUE-03 — `policy:'stately'` + per-send `singletonKey:jobId` + `retryLimit:0`); duplicate enqueue is dropped at the queue layer rather than racing into a second emulator boot. Hosts the `/admin/drain` + `/admin/drain/resume` operator endpoints + `system_state.drain_requested_at` row read on plugin `onReady` for restart-safe drain. Houses the deviceName-joined `jobResponseSchema` (DEBT-02) + `internal/repo.ts` `leftJoin(devices)` SQL source of truth (CLI-05).

The module is constructed by the `createJobsModule` factory (MOD-06) — `server/jobs/plugin.ts` is a thin wirer (decorator + onReady worker registration + onClose shutdown). Direct imports from `server/jobs/internal/**` are forbidden by `dependency-cruiser` rule `no-deep-imports-into-jobs-internal` (Plan 23-00 — 7th forbidden rule, MOD-02 enforcement).

## Public API

Exports from `server/jobs/index.ts`:

| Symbol | Source | Purpose |
|--------|--------|---------|
| `createJobsModule` | `./internal/module.js` | MOD-06 factory; constructs per-module bus + emit helpers + worker + drain admission + saga subscribers |
| `JobsModule` (type) | `./internal/module.js` | Factory return type — `{bus, emit, enqueueJob, runningJobs, registerWorkerAndSubscribers, shutdown}` |
| `CreateJobsModuleDeps` (type) | `./internal/module.js` | Factory dependency record (`{fastify, db, config, logger}`) |
| `JOB_EVENT_NAMES` | `./events.js` | 13-key constant: 6 bridgehead (Phase 19/21/22) + 5 saga (Phase 23) + 2 system.drain (Phase 23) |
| `jobsRegistry` | `./events.js` | EventRegistry — typed schema + persistence + aggregateType lookup |
| `makeJobsEmitters` | `./events.js` | Factory returning 13 typed emit helpers |
| `JobsRegistry` / `JobsEmitters` / `JobEventName` (types) | `./events.js` | Derived types |
| `JOB_EXECUTE_QUEUE_NAME` | `./queue.js` | Constant `'job.execute'` |
| `JobExecutePayload` (type) | `./queue.js` | `{jobId, platform}` |
| `jobStatusSchema` / `platformSchema` / `jobSummarySchema` / `jobResponseSchema` | `./schemas.js` | Zod schemas; `jobResponseSchema` is the DEBT-02 deviceName-cross-field schema with `.meta({id:'Job'})` for OpenAPI emit |
| `JobSummary` / `JobResponse` (types) | `./schemas.js` | Derived types |
| `JobService` | `./job-service.js` | Back-compat shim — delegates to `fastify.jobsModule.enqueueJob`; Phase 24+ may delete |
| `jobsPlugin` | `./plugin.js` | Default export — Fastify plugin with name `'job-plugin'` |

Fastify decorators exposed by the plugin:

- `fastify.jobsModule: JobsModule`
- `fastify.jobService: JobService` (back-compat shim)

## Events Emitted

13 events across 3 cohorts.

| Event | Payload | Persisted | aggregateType |
|-------|---------|-----------|---------------|
| `job.started` | `{jobId, deviceId, platform}` | false | job |
| `job.completed` | `{jobId, status, platform, summary?}` | true | job |
| `maestro.log.written` | `{jobId, filePath, fileName, mimeType, fileSizeBytes}` | false | job |
| `job.log` | `{jobId, data:{line, stream}}` | false | job |
| `job.step` | `{jobId, data:{flowName, status, command?, durationMs?}}` | false | job |
| `job.status` | `{jobId, data:{status}}` | false | job |
| `job.allocated` | `{jobId, deviceId, platform}` | false | job |
| `job.running` | `{jobId, deviceId, platform}` | false | job |
| `job.recording.requested` | `{jobId, recordingId, outputPath}` | true | job |
| `job.cleanup.requested` | `{jobId}` | true | job |
| `job.failed` | `{jobId, step, reason}` | true | job |
| `system.drain.completed` | `{drainedAt, durationMs}` | true | system |
| `system.drain.resumed` | `{resumedAt}` | true | system |

TRACE-08 split: high-frequency / derivable transients (`job.started`, `maestro.log.written`, `job.log`, `job.step`, `job.status`, `job.allocated`, `job.running`) are NOT persisted; terminal + cross-module hand-off events (`job.completed`, `job.recording.requested`, `job.cleanup.requested`, `job.failed`) ARE persisted. `system.drain.*` carry `aggregateType:'system'` (DEFERRED-23-B) discriminating from per-job events for trace-tree consumption.

## Events Consumed

| Event | Producer | Handler |
|-------|----------|---------|
| `device.allocated` | pool | jobs subscriber writes `jobs.status='allocated'` + `jobs.deviceId` + `jobs.startedAt`; emits `job.allocated` |
| `device.released` | pool | trace-only audit — no DB write (the cleanup path is owned by `job.cleanup.requested` subscribers) |
| `device.health.failed` | pool | if a running job's device fails health, the saga emits `job.failed{step:'run', reason:'device unhealthy'}` |
| `job.completed` | jobs (own) | inline subscriber writes `jobs.finishedAt` + emits `job.cleanup.requested` |
| `job.failed` | jobs (own) | inline subscriber writes `jobs.status='failed'` + `errorMessage` + emits `job.cleanup.requested` |

Cross-module subscribers consume jobs events from their own modules:

- artifacts → `job.started` (start recording + memory sampling), `maestro.log.written` (create log artifact), `job.completed`/`job.recording.requested` (enqueue `recording.upload`)
- reporting → `job.completed` (enqueue `webhook.deliver`)
- streaming → `job.log` / `job.step` / `job.status` (envelope + WS fan-out), `job.cleanup.requested` (broadcaster cleanup — resolves DEFERRED-22-D)
- pool → `job.failed` (release device if still allocated)

## Queue Produced

| Queue | Policy | retryLimit | Worker Handler |
|-------|--------|------------|----------------|
| `job.execute` | `stately` | 0 | `runJob` from `internal/executor.ts` — runs the saga; emits `job.running` → maestro → `job.completed` (success) or `job.failed` (any thrown error) |

Per-send contract: `boss.send('job.execute', {jobId, platform}, {singletonKey: jobId})` enforces idempotent enqueue (QUEUE-03 / Pitfall 2). Duplicate enqueue with same jobId returns `null` (Pitfall 3 — does NOT throw). The drain admission check inside `enqueueJob` reads `system_state.drain_requested_at` and throws `503 system_draining` if drain is active.

## Queue Consumed

None. Jobs subscribers do NOT enqueue work to other queues. Cross-module subscribers manage their own queues independently:

- artifacts subscribes to `job.completed` / `job.recording.requested` → enqueues `recording.upload` (Phase 21)
- reporting subscribes to `job.completed` → enqueues `webhook.deliver` (Phase 19)
- streaming subscribes to `job.cleanup.requested` → in-process broadcaster cleanup (no queue)
- pool subscribes to `job.failed` → in-process device release (no queue)

## Invariants

1. **Singleton enqueue** — `enqueueJob` calls `boss.send` with `singletonKey:jobId`; pg-boss `policy:'stately'` drops duplicates. Spec: `__tests__/idempotency.spec.ts` (Plan 23-02 queue layer + Plan 23-04 SC2 strict).
2. **Saga ownership** — `internal/executor.ts` does NOT contain `.catch(() => {})` swallowing, `setTimeout(...broadcaster...cleanup)`, direct `bus.emit()` outside `events.ts`, or imports from `streaming/internal/`. All errors emit `job.failed`. Spec: `__tests__/lifecycle-ownership.spec.ts` (Plan 23-06 — 4 grep-guards all assert count=0).
3. **deviceName cross-field** — `jobResponseSchema` requires non-empty `deviceName` whenever `deviceId` is non-null (Zod `.refine`). Spec: `__tests__/contract-devicename.spec.ts` cases (a)-(e) (Plan 23-03).
4. **OpenAPI Job schema** — `server/openapi.json` `components.schemas.Job` carries `deviceName` property in both `properties` and `required[]`; CI fails if dropped. Spec: `__tests__/contract-devicename.spec.ts` case (f).
5. **No in-memory FIFO** — `server/jobs/job-queue.ts` deleted (Plan 23-04). pg-boss is the sole queue surface. Spec: SC4 grep contract (`! grep -rE "from .*jobs/job-queue" server/`).
6. **Drain restart safety** — plugin `onReady` reads `system_state.drain_requested_at`; calls `boss.offWork(workerId)` if a drain row is present so a server restart during drain does NOT silently resume work. Spec: `__tests__/drain-route.spec.ts` (Plan 23-05).
7. **correlationId end-to-end** — saga events stamp `envelope.correlationId` from ALS (`readAls('correlationId')`). Spec: `__tests__/correlation.spec.ts` (Plan 23-06).

## Non-Goals

- **Maestro CLI extraction** — `JobExecutor` class stays at `server/jobs/job-executor.ts` (legacy Maestro process wrapper). Phase 24 Maestro Module owns extraction into `server/maestro/`.
- **`device.booted` event** — Phase 20 deferred to Phase 24 Maestro. Phase 23 SC2 idempotency.spec filters `device.state.changed{from:'booting',to:'idle'}` instead.
- **persistEnvelope consolidation** — 7TH SAMPLE POINT reached at `server/jobs/internal/module.ts` (after hooks / lifecycle / reporting / pool / artifacts / streaming). Phase 27+ consolidates the duplicated middleware into `server/bus/middlewares/persist-envelope.ts` (DEFERRED-22-E).
- **`requireAdmin` middleware on `/admin/drain`** — Plan 23-05 lands with any-valid-key gate (`fastify.authService.validateKey`). Phase 26 Auth Module formalizes the admin claim (DEFERRED-23-A).
- **`system.drain.*` event ownership** — Phase 23 emits these from the jobs module for proximity to the drain endpoint (`aggregateType:'system'` discriminator). Phase 27+ may extract to a dedicated `server/system/` module if more system-wide events emerge (DEFERRED-23-B).
- **Cross-tier `deviceName` proof in Go** — `contract-devicename.spec` test (g) attempts a Go-side `TestStatusDeviceName`; if Go infra is unreachable the assertion logs + skips and Phase 28 ships the Go test as part of CLI-04 (DEFERRED-23-C).
- **CLI Go codegen + web openapi-fetch consumption** — Phase 28 + Phase 29 own consumption of the deviceName contract this phase establishes.
- **pg-boss schema isolation per drain test** — drain specs share the default pg-boss schema (Phase 19 precedent — no observed flakes). If parallel-load flakes appear, switch to per-spec ephemeral schema (DEFERRED-23-D).

## Dependencies

Plugin metadata (`server/jobs/plugin.ts`):

```javascript
dependencies: ['config', 'db', 'queue', 'event-bus', 'pool-plugin', 'auth']
```

- `config` — `fastify.config.auth.enabled` for the drain endpoint auth gate.
- `db` — `fastify.db` for `internal/repo.ts` (`leftJoin(devices)`) + `system_state` read/write + `persistEnvelope` middleware.
- `queue` — `fastify.boss` for `boss.send` (enqueueJob) + `boss.work` (worker) + `boss.offWork` (drain).
- `event-bus` — `fastify.onPersisted` decorator + per-module `TypedBus` factory.
- `pool-plugin` — `fastify.poolModule.bus.on('device.allocated', ...)` cross-module subscriber wiring.
- `auth` — `fastify.authService.validateKey` for the `/admin/drain` + `/admin/drain/resume` preHandlers.

Resolves DEFERRED-21 — the long-standing `server/jobs/plugin.ts → server/bus/bus.ts` dep-cruiser violation cleared in Plan 23-04 by routing the bus through the `event-bus` plugin dependency (factory consumes `fastify.busFactory<JobsRegistry>()` instead of importing `bus.ts` directly).

### Runnable Example

```typescript
// Submit a job (HTTP route handler):
import type { FastifyInstance } from 'fastify';

async function submitJob(
  fastify: FastifyInstance,
  jobId: string,
  platform: 'android' | 'ios',
) {
  // Insert job row (status='queued' is the default).
  await fastify.db.insert(fastify.db.schema.jobs).values({
    id: jobId,
    status: 'queued',
    platform,
  });

  // Enqueue. Admission check inside throws 503 if drain is active.
  const bossId = await fastify.jobsModule.enqueueJob(jobId, { jobId, platform });
  return { bossJobId: bossId };
}

// Subscribe to terminal events from another module (onReady-deferred):
fastify.addHook('onReady', async () => {
  fastify.jobsModule.bus.on('job.completed', async ({ payload }) => {
    // payload: {jobId, status, platform, summary?}
    await myService.handleCompleted(payload);
  });
  fastify.jobsModule.bus.on('job.failed', async ({ payload }) => {
    // payload: {jobId, step, reason}
    await myService.handleFailure(payload);
  });
});
```

**TypeScript snippet typecheck:** this runnable example compiles against the current barrel (Plan 23-07 output). MOD-09 (Phase 27 scope) will enforce snippet typecheck in CI; Phase 23 ships hand-verified.

References to RESEARCH pitfalls: Pitfall 1 (drain via `boss.offWork` + `system_state` row, NOT in-memory flag); Pitfall 2 (`policy:'stately'` REQUIRED for `singletonKey` dedup); Pitfall 3 (duplicate enqueue returns `null`, does NOT throw). See `.planning/phases/23-jobs-module-keystone/23-RESEARCH.md`.

## Phase 37 additions

Track D (Plan 37-04) extends the jobs module with parallel patterns ported 1:1 from kittyfarm (`InputCoordinator.swift` + `BuildPlayRunner.swift`). These surfaces are additive — single-device flow is byte-unchanged.

### Public API additions

| Symbol | Source | Purpose |
|--------|--------|---------|
| `createInputBroadcaster` | `./internal/input-broadcaster.js` | Fan-out tap/key/text to N sessions via `Promise.allSettled` (no rollback on partial failure) |
| `InputBroadcaster` (type) | `./internal/input-broadcaster.js` | Broadcaster API surface (`broadcast` method) |
| `BroadcastResult` (type) | `./internal/input-broadcaster.js` | Per-session result `{sessionId, ok, error?}` |
| `runParallelDeploy` | `./internal/build-once-deploy-n.js` | Build-once-deploy-N execution path; pre-allocates devices via `pool.allocateMany`, runs install+launch in parallel |
| `parallelDeployJobSchema` | `./schemas.js` | Job-spec discriminated union member for `mode:'parallel-deploy'` (Zod-validated metadata) |

### Phase 37 invariants

- (8) `InputBroadcaster.broadcast` uses `Promise.allSettled` — never `Promise.all`. A single session failure does NOT cancel siblings. Tested by `server/jobs/__tests__/input-broadcaster.spec.ts` plus grep-guard `! grep -E "Promise\.all\(" server/jobs/internal/input-broadcaster.ts`.
- (9) `runParallelDeploy` never rolls back successful sends. When one device fails, the other devices' install+launch results are preserved in the aggregated summary. Tested by `parallel-deploy.spec.ts -t "successful sends preserved"`.
- (10) Route layer enforces `parallelism <= config.pool.<platform>.max_parallelism`; over-cap returns 503 + `Retry-After` header (Pitfall 9 from 37-RESEARCH — port allocator exhaustion defense-in-depth).

### Track D non-goals

- Cross-platform broadcast (Android + iOS sessions at the same time) — single-platform per broadcast call.
- Replay / idempotency-key on broadcast — fire-and-forget by design. Operators wanting idempotency can wrap with a higher-level orchestrator.

### Webhook payload extension (Plan 37-05)

The reporting module's webhook builder (`server/reporting/internal/webhook-payload.ts`) extends the v3 envelope additively (SPEC-08) with `preflight`, `analysis`, and `parallelDeploy` optional fields. The `parallelDeploy` field is sourced verbatim from `jobs.metadata.parallelDeploy` populated by the executor branch above.
