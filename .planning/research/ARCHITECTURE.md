# Architecture Research — v3.0 Spec-Driven Refactor

**Domain:** Device Farm (test execution platform) — integration of Zod + event bus + pg-boss + correlation IDs into existing Fastify/Go/SvelteKit stack
**Researched:** 2026-04-16
**Confidence:** HIGH (grounded in full read of current server code; pg-boss/Fastify patterns verified against upstream docs)
**Scope:** How v3.0 pillars integrate with existing code. **No new features.**

---

## 1. Executive Summary

The v3.0 refactor is a **structural, not functional** change. The current `server/` is already organized by domain (12 + 3 plugins), but modules leak into each other through Fastify decorators used as a service locator, and async work is split across three incompatible queuing mechanisms:

- In-memory `JobQueue` per platform (jobs module) — lost on crash
- `node-cron` in `lifecycle-plugin` (daily/hourly housekeeping) — in-process
- `node-cron` in `pipelines/scheduler.ts` (per-schedule cron) — in-process, duplicated
- `fire-and-forget` webhooks via `WebhookService.deliver(...).catch(...)` — no retry persistence
- `fire-and-forget` auto-link, screenshot capture, hook execution — all ad-hoc `.catch()` patterns in `job-service.ts`

v3.0 unifies all persistent async work behind **pg-boss**, all cross-module notifications behind a **typed event bus**, and all data-shape contracts behind **Zod schemas**. The existing plugin-registration spine is already the right shape; we add two new plugins at the **very top** (`event-bus`, `correlation`) and one **after `db`** (`queue`/pg-boss), then carve each existing plugin into a proper module with `MODULE.md`, barrel `index.ts`, and `events.ts`.

Module boundaries already exist *de facto* in `server/{jobs,pool,artifacts,streaming,reporting,lifecycle,hooks,maestro,pipelines,auth,api,config,db}`. The refactor formalizes them. **Pilot module: `hooks`** — smallest public surface, clear inputs/outputs, already Zod-validated, low-risk to rewrite twice if the pattern needs tuning.

---

## 2. Module Decomposition of `server/`

### 2.1 Module Map (post-refactor)

| # | Module | Purpose | Public API Surface | Events Emitted | Events Consumed | Queue Jobs Owned |
|---|--------|---------|---------------------|----------------|-----------------|-------------------|
| 0 | **config** | YAML load + Zod validation, single source of config truth | `getConfig(): AppConfig` | — | — | — |
| 0 | **event-bus** | In-process typed bus (publish/subscribe), per-module registries, correlation-id propagation | `createBus<TEvents>()`, `publish`, `subscribe`, `waitFor` | (meta) `bus.subscribed`, `bus.dead-letter` | — | — |
| 0 | **correlation** | AsyncLocalStorage context for `correlationId`, request tagging, log child-binding | `runWithContext(ctx, fn)`, `getContext()` | — | — | — |
| 1 | **db** | Drizzle client, schema, transaction helpers, **`events` append-only table** writer | `db`, `withTx(fn)`, `appendEvent(...)` | — | all (subscribes to bus, appends critical events to `events`) | — |
| 1 | **queue** (pg-boss) | Job registration, worker startup, scheduling, DLQ hooks | `enqueue(name, data, opts)`, `registerWorker(name, handler)`, `schedule(name, cron, data)` | `queue.job.failed`, `queue.job.succeeded`, `queue.dlq` | — | all persistent async work |
| 2 | **auth** | API key auth, bearer decoration, key CRUD | `validateKey`, `createKey`, `revokeKey`, routes | `auth.key.created`, `auth.key.revoked` | — | — |
| 2 | **pool** (devices) | Device lifecycle, state machine, health check, allocation mutex | `allocate`, `release`, `getDevice`, `getDevices`, `markRunning` | `device.booted`, `device.shutdown`, `device.health.failed`, `device.state.changed`, `device.allocated`, `device.released` | `job.completed`, `job.cancelled`, `job.failed` (trigger release) | `health-check`, `device-boot`, `device-reap` |
| 3 | **artifacts** | Storage paths, artifact rows, recording/screenshot/memory services | `createArtifact`, `ensureJobDir`, `getArtifactPath`, `RecordingService`, `ScreenshotService`, `MemoryService` | `artifact.created`, `recording.started`, `recording.stopped` | `job.started`, `job.completed` | — (lifecycle module owns cleanup jobs) |
| 3 | **streaming** | WebSocket broadcaster, device preview fanout, frame throttling | `broadcastJobMessage`, `subscribeJob`, `subscribeDevicePreview` | — | all job events → WS fanout | — |
| 4 | **maestro** | Hierarchy, screenshots, device info, query routes; Maestro CLI wrapper | `HierarchyService`, `DeviceInfoCollector`, `AppiumService`, routes | `maestro.hierarchy.fetched`, `maestro.device-info.collected` | `device.booted` (refresh metadata) | — |
| 4 | **hooks** (PILOT) | Lifecycle hooks loader, executor, CRUD routes, dry-run | `HookExecutor`, routes, `hookDefinitionSchema` | `hook.executed`, `hook.failed` | `device.booted`, `device.shutdown`, `test.before`, `test.after` | `hook-run` (when `timeoutMs > 5s` to keep request-path fast) |
| 5 | **jobs** | Job creation, queue placement, execution orchestration, cancellation | `createJob`, `cancelJob`, `getJob`, `onDeviceReleased` | `job.created`, `job.queued`, `job.started`, `job.step`, `job.log`, `job.completed`, `job.cancelled`, `job.failed` | `device.released` (trigger dispatch), `hook.failed` (fail test.before) | `job-execute`, `job-auto-link` |
| 6 | **reporting** | Webhook delivery with retry, flaky detection, JUnit, HTML reports, test history routes | `WebhookService` (now enqueues), `FlakyDetector`, routes | `webhook.delivered`, `webhook.failed`, `flaky.detected` | `job.completed`, `job.failed` | `webhook-deliver`, `flaky-analyze` |
| 7 | **pipelines** | Pipeline CRUD, YAML parser, executor, scheduler, secrets, git clone | `PipelineService`, `PipelineExecutor`, routes, WS | `pipeline.run.created`, `pipeline.stage.started/completed`, `pipeline.run.finished` | `job.completed` (advance stage) | `pipeline-run-execute`, `pipeline-scheduled-trigger` |
| 8 | **lifecycle** | Artifact compression, retention, disk pressure — all moved to pg-boss schedules | `LifecycleStats`, admin routes | `lifecycle.compression.ran`, `lifecycle.retention.ran`, `lifecycle.disk.checked` | — | `lifecycle-compress-daily`, `lifecycle-retention-daily`, `lifecycle-disk-hourly` |
| 9 | **api** | HTTP routes aggregation, error handler, multipart, Zod-validated handlers, OpenAPI generation | routes, `errorHandler`, Zod route schemas | — | — | — |
| 9 | **static** | SPA serving (unchanged) | — | — | — | — |

Notes on **`test-cases`, `test-suites`, `test-executions`, `labels`** — today these live under `api/*-routes.ts` as route files without a service layer. The refactor should extract each into its own module (`test-cases/`, `test-suites/`, `test-executions/`, `labels/`) with a service + events. These are not listed as "new" modules because the code exists; they just need unmounting from `api/`.

### 2.2 Pilot Module Recommendation: `hooks`

**Why `hooks`:**

| Criterion | `hooks` | `lifecycle` | `auth` | `reporting` | `jobs` |
|-----------|---------|-------------|--------|-------------|--------|
| Self-contained | ✓ (only reads `pool` via context) | ✓ | ✓ | Partial | ✗ (central) |
| Under real use | ✓ (wired into `onReady` + `job-service`) | ✓ (daily cron) | ✓ (every request) | ✓ | ✓ |
| Small public surface | ✓ (5 routes, one service) | ✓ | Medium | Medium | ✗ (huge) |
| Not on critical path | ✓ (job completes even if hook fails, unless `failOnError`) | ✓ | ✗ (auth blocks everything) | ✓ | ✗ |
| Has queue work | ✓ (hook execution, timeout-bounded) | ✓ (scheduled) | ✗ | ✓ (webhooks) | ✓ |
| Has events in/out | ✓ (4 inbound events, 2 outbound) | Few | Few | Few | Many |
| Existing Zod | ✓ (`hookDefinitionSchema`) | ✗ | Partial | ✗ | ✗ |
| Blast radius if pattern changes | Low (rewrite in a day) | Low | High | Medium | Very high |

`hooks` is the sweet spot: **real integration** (consumes bus events, enqueues work, persists to `events` table, exposes routes) but **small enough to rewrite twice** if the MODULE.md / barrel pattern needs tuning. `lifecycle` is a reasonable alternative if you want to pilot queue migration specifically (node-cron → pg-boss.schedule), but `hooks` also exercises pg-boss for timeout-bounded execution, so it covers more surface area.

**Not the pilot (reasons):**
- `jobs` — touches every other module; too risky first.
- `auth` — blocks every request; rollback would be painful.
- `pool` — state machine is load-bearing; refactor during a quieter phase.
- `pipelines` — newest code; least battle-tested; refactor after v3 pattern is proven.

---

## 3. Fastify Plugin Order After Refactor

### 3.1 Current Order (v2.x, actual) — with dependency bugs

```
1. config                    deps: —
2. (dependency-checker)      not a plugin; called as fn before pool
3. pool-plugin               deps: config
4. db                        deps: config
5. auth                      deps: config, db
6. websocket-plugin          deps: config, auth
7. artifact-plugin           deps: config, db, pool-plugin
8. reporting                 deps: config, db
9. job-plugin                deps: config, db, pool-plugin, websocket-plugin, artifact-plugin, reporting
10. lifecycle-plugin         deps: config, db
11. hooks-plugin             deps: config, pool-plugin
12. maestro-plugin           deps: config, pool-plugin
13. pipelines-plugin         deps: db-plugin, websocket-plugin, jobs-plugin   <-- BUG: name mismatch
14. api                      deps: config, db, pool-plugin, job-plugin, auth, reporting, maestro-plugin, hooks-plugin
15. static-plugin            deps: (implicit)
```

**Bugs to fix (tech debt):**
- `pipelines` declares `jobs-plugin` but `jobs/plugin.ts` sets `name: 'job-plugin'`. Silently unresolved. **Fix:** align names.
- `websocket-plugin` does not declare `pool-plugin` but the preview handler reaches into `fastify.pool` via the adapter factory. **Fix:** add `pool-plugin` to websocket deps.
- `lifecycle-plugin` writes `lifecycleStats` that `reporting.report-routes.ts` reads. No declared dep chain makes `api` wait for `lifecycle` readiness. **Fix:** either `reporting` depends on `lifecycle`, or `api` depends on `lifecycle` (simpler).
- `dependency-checker` is a function call in `buildApp`, not a plugin. No Fastify awareness of its readiness. **Fix:** promote to a plugin so it sits in the dependency graph.

### 3.2 Target Order (v3.0)

```
 0. config                    deps: —
 0. event-bus                 deps: —                              [NEW — before everything]
 0. correlation               deps: —                              [NEW — before everything]
 1. dependency-checker        deps: config                          (promoted to plugin)
 2. db                        deps: config
 3. queue (pg-boss)           deps: config, db                      [NEW — after db, before async]
 4. telemetry                 deps: event-bus, db                   [NEW — bus → events table]
 5. auth                      deps: config, db
 6. pool                      deps: config, event-bus               (emits device.* events)
 7. websocket                 deps: config, auth, pool, event-bus   (fan-out subscriber)
 8. artifacts                 deps: config, db, pool, event-bus
 9. reporting                 deps: config, db, queue, event-bus    (enqueues webhook-deliver)
10. hooks                     deps: config, pool, queue, event-bus
11. maestro                   deps: config, pool, event-bus
12. jobs                      deps: config, db, pool, websocket, artifacts, reporting, hooks, queue, event-bus
13. pipelines                 deps: db, websocket, jobs, queue, event-bus
14. lifecycle                 deps: config, db, queue               (replaces node-cron)
15. api                       deps: config, db, auth, pool, jobs, reporting, maestro, hooks, lifecycle, pipelines
16. static                    deps: api
```

**What changes:**

| Change | Why |
|--------|-----|
| `event-bus` at position 0 | Every downstream plugin publishes/subscribes; must exist first |
| `correlation` at position 0 | AsyncLocalStorage wraps request lifecycle from `onRequest` |
| `queue` inserted after `db` | pg-boss needs a PG pool; schema auto-creates in `pgboss` namespace |
| `telemetry` new plugin | Subscribes to all bus events, appends filtered set to `events` table |
| `pool` depends on `event-bus` | Emits `device.booted` itself instead of being called imperatively from `index.ts` |
| `websocket` declares `pool` | Fixes implicit dep bug |
| `lifecycle` depends on `queue` | No more `node-cron` — schedules registered via `boss.schedule()` |
| `api` declares `lifecycle`, `pipelines` | Fixes tech-debt undeclared deps |
| Names normalized | Strip `-plugin` suffix: `job-plugin` → `jobs`, `pool-plugin` → `pool`, etc. Align `dependencies: [...]` strings. |

**The `onReady` block in `server/index.ts`** (device.booted hook loop, device sync to DB, health checker start, reaper start) — each chunk moves into the module that owns it:

- `pool` onReady: `initPool()`, start health checker, start reaper, sync devices to DB, publish `device.booted` for each idle device
- `hooks` onReady: nothing (subscribes to `device.booted` events instead)
- `maestro` onReady: subscribe to `device.booted`, collect metadata (this is already how it works)

`index.ts` shrinks to just plugin registrations + `app.listen()`.

---

## 4. Data Flow: Before → After

### 4.1 Job Submit → Run → Complete

#### Before (current `job-service.ts`)

```
POST /api/jobs (multipart)
  └→ api/routes.ts → jobService.createJob()
       ├→ validateMetadata()                   [throws on invalid]
       ├→ db.insert(jobs)                      [row inserted]
       ├→ db.insert(jobFiles)
       ├→ queue.enqueue(queuedJob)             [in-memory, per-platform]
       └→ this.tryDispatch(platform).catch()   [fire-and-forget]

tryDispatch(platform) — mutex-guarded
  ├→ queue.peek()
  ├→ pool.allocate(platform, jobId)            [mutex, state: idle→allocated]
  ├→ queue.dequeue()
  ├→ pool.markRunning()                        [state: allocated→running]
  ├→ db.update(jobs.status=running)
  └→ executeJob(job, deviceId, signal).catch() [fire-and-forget]

executeJob(...)
  ├→ artifactService.ensureJobDir()
  ├→ devicePreviewManager.startPreview()       [try/catch logged]
  ├→ recordingService.startRecording()         [try/catch logged]
  ├→ memoryService.startSampling()             [Android only]
  ├→ jobBroadcaster.emit('status', running)
  ├→ hookExecutor.execute('test.before')       [throws on failOnError]
  ├→ executor.execute(maestro)                 [spawns maestro, streams stdout]
  │    └→ callbacks → jobBroadcaster.emit('step'/'log')
  ├→ saveJobResult()                           [db update]
  ├→ autoLinkService.linkJobToTestCases().catch()
  ├→ hookExecutor.execute('test.after').then().catch()
  ├→ webhookService.deliver(url, payload).catch()   [fire-and-forget, internal retry]
  ├→ (finally) stopRecording → createArtifact
  ├→ (finally) stopPreview
  ├→ (finally) stopSampling → createArtifact
  ├→ (finally) readdir screenshots → createArtifact (each)
  ├→ (finally) broadcaster.cleanup() after 5s
  ├→ (finally) executor.cleanupTempDir()
  ├→ (finally) rmFile(apkPath)
  ├→ (finally) pool.release()
  └→ (finally) tryDispatch(platform)           [direct call, not event]
```

**Problems:**
- Crash during `executeJob` leaves device in `running` state, tempdir + APK on disk, recording mp4 orphaned. Recovery = server restart, which re-boots device but job row stays `running` forever.
- `webhookService.deliver()` does its own retry in-process — no persistence, no DLQ, lost on crash.
- `hookExecutor.execute('test.after')` runs in-process after the job completes; if server shuts down between result save and hook completion, hook is lost.
- `autoLinkService.linkJobToTestCases()` is fire-and-forget; same story.
- `tryDispatch` after release is a direct method call — no way for other modules to react to "job finished" without modifying `job-service`.

#### After (v3.0)

```
POST /api/jobs (multipart)
  └→ api routes (Zod-validated body)
       └→ correlation.runWithContext({ correlationId: requestId }, async () => {
            └→ jobs.createJob(input)
                 ├→ zod.parse(input)                          [input validated]
                 ├→ db.withTx(async tx => {
                 │     ├→ insert jobs row
                 │     ├→ insert jobFiles
                 │     └→ appendEvent(tx, 'job.created',
                 │         { jobId, platform, correlationId })   [events table]
                 │ })
                 ├→ queue.enqueue('job-execute', { jobId },
                 │     { singletonKey: jobId, retryLimit: 0,
                 │       correlationId })                      [pg-boss]
                 ├→ bus.publish('job.created', { jobId, ... }) [in-proc]
                 └→ return { id, status: 'queued' }
          })

[pg-boss worker: job-execute]
  worker('job-execute', async (job) => {
    correlation.runWithContext({ correlationId: job.data.correlationId, jobId }, async () => {
      await jobs.executeJob(job.data.jobId)
    })
  })

jobs.executeJob(jobId)
  ├→ const device = await pool.allocate(platform, jobId)
  │      [mutex-guarded, emits device.allocated]
  │      [if null — throw retry-after; pg-boss reschedules]
  ├→ bus.publish('job.started', { jobId, deviceId, correlationId })
  │      └→ telemetry appends to events table
  │      └→ streaming fans out to WS (replaces direct broadcaster.emit)
  │      └→ artifacts subscribes → ensureJobDir, startRecording, startPreview
  │      └→ hooks subscribes → enqueue('hook-run', { event:'test.before' })
  │                             (await result if failOnError set; else fire-forget queue)
  ├→ const result = await maestroExecutor.execute({ jobId, flowDir, device, ... })
  │      └→ streams 'job.log' 'job.step' via bus
  ├→ bus.publish('job.completed', { jobId, status, summary, correlationId })
  │      └→ telemetry → events table (idempotent via (jobId, event_type, seq))
  │      └→ reporting subscribes → queue.enqueue('webhook-deliver', payload)
  │      └→ artifacts subscribes → stopRecording, createArtifact rows
  │      └→ pool subscribes → release(deviceId)
  │      └→ hooks subscribes → enqueue('hook-run', { event:'test.after' })
  │      └→ jobs self-enqueues → queue.enqueue('job-auto-link', { jobId })
  │      └→ pipelines subscribes → advance stage if job belongs to a run
  └→ return (worker ack)

[pg-boss worker: webhook-deliver]   — retries: 5, exponential, DLQ
  async (job) => await reporting.deliverWebhook(job.data)

[pg-boss worker: hook-run]          — retries: 0 (per-hook failOnError decides)
[pg-boss worker: job-auto-link]     — retries: 3
[pg-boss worker: pipeline-run]      — retries: 1
```

**Key improvements:**

| Aspect | Before | After |
|--------|--------|-------|
| Crash recovery | Job row stuck `running`; re-dispatch manual | pg-boss redelivers `job-execute`; worker resumes |
| Webhook delivery | In-proc retry, lost on crash | `webhook-deliver` queue with `retryLimit: 5`, `retryBackoff: true`, DLQ after exhaustion |
| Cron (pipelines) | `node-cron` in-proc per schedule | `boss.schedule(name, cronExpr, data)` |
| Cron (lifecycle) | `node-cron` in-proc daily/hourly | `boss.schedule('lifecycle-compress-daily', '0 3 * * *', {})` |
| Hook fire | Direct method call from jobs | Bus event triggers hooks subscriber; optionally queue for long timeouts |
| Auto-link | Inline `.catch()` in job-service | `job-auto-link` queue job; owned by `jobs` module but executed async |
| Cross-module reaction | Imperative direct calls | Bus subscribers; modules can adopt events without touching `jobs` |
| Observability | Logs only | `events` append-only table; every event carries `correlationId`; queryable |

### 4.2 WebSocket Subscription Replay vs Events Table

The per-job in-memory buffer (`JobBroadcaster.buffers` — last 200 messages) and the `events` table serve **different purposes** and **both should stay**:

| Concern | `JobBroadcaster` buffer | `events` table |
|---------|-------------------------|-----------------|
| Purpose | WS catch-up for reconnects during live run | Persistent audit + post-mortem + flaky analysis |
| Cardinality | Every `log`/`step`/`metrics`/`status` message (potentially 1000s/min) | Filtered business events (`job.created`, `job.started`, `job.completed`, `job.failed`, `device.*`, `hook.*`, `webhook.*`) |
| Retention | In-memory, cleaned 5s after job completes | Append-only, retained with TTL (30-90 days default) |
| Lookup cost | O(1) replay from memory | Indexed by `correlation_id`, `job_id`, `event_type`, `created_at` |
| Durability | Lost on restart | Durable |

**Decision:** Keep `JobBroadcaster` exactly as-is for WS replay. Add `events` table for business-level auditing. The broadcaster becomes a **subscriber** to the bus — it translates `job.log` bus events into WS `JobMessage` format and fans out. The **producer** stops calling `broadcaster.emit()` directly; it publishes to the bus, streaming subscribes.

Data flow for WS subscription:

```
WS /ws/jobs/:id connects
  ├→ broadcaster.subscribe(jobId, handler)
  │    ├→ replay buffered history (in-memory ring)   [same as today]
  │    └→ attach emitter listener                    [same as today]
  └→ heartbeat loop                                   [same as today]

[bus event] bus.publish('job.log', {...})
  └→ streaming subscriber
       └→ broadcaster.emit(jobId, { type:'log', data, timestamp })
             ├→ append to ring buffer
             └→ fanout to WS listeners
```

Buffer stays in-memory; it is just filled by a bus subscriber instead of direct calls from `job-service`.

### 4.3 Pipeline Cron Trigger

**Before:** `pipelines/scheduler.ts` holds `Map<id, node-cron.ScheduledTask>`, calls `pipelineService.triggerRun(pipelineId, 'schedule', vars)` inline. On server restart, `scheduler.start()` re-reads DB and re-registers tasks. **If the server is down at cron time, the schedule is missed.**

**After:**

```
On startup:
  pipelines.scheduler.start()
    └→ for each pipelineSchedules row:
         await boss.schedule(
           name: `pipeline-schedule-${id}`,
           cron: row.cronExpression,
           data: { scheduleId: id, pipelineId: row.pipelineId, variables: row.variables },
           options: { tz: 'UTC' }
         )

On schedule CRUD:
  addSchedule(scheduleId):
    └→ boss.schedule(name, cron, data)   [idempotent, upserts]
  removeSchedule(scheduleId):
    └→ boss.unschedule(name)

Worker:
  boss.work('pipeline-schedule-trigger', async (job) => {
    pipelines.triggerRun(job.data.pipelineId, 'schedule', job.data.variables)
  })
```

**Trigger ownership:** the worker is registered by the `pipelines` module in `pipelines/index.ts` (same place the scheduler lives today). No external loop; pg-boss handles cron polling on `pgboss.schedule`.

**Missed schedules:** pg-boss has `singletonMinutes` to prevent double-firing when a worker runs longer than the interval; combined with `teamSize`/`teamConcurrency` for throughput. Default behavior matches node-cron (don't backfill), which is what we want.

### 4.4 Webhook Delivery

**Before:** `WebhookService.deliver(url, payload)` loops with `fetch()` and exponential backoff + jitter in-process, up to `maxRetries`. If server restarts mid-retry, delivery is lost.

**After:**

```
bus.subscribe('job.completed', async (ev) => {
  if (!config.webhooks?.url) return
  await queue.enqueue('webhook-deliver', {
    url: config.webhooks.url,
    payload: { event:'job.completed', job: ev.job, ... },
    correlationId: ev.correlationId,
  }, {
    retryLimit: 5,
    retryBackoff: true,         // pg-boss exponential
    retryDelay: 1,              // seconds, doubled each attempt
    expireInSeconds: 3600,      // give up after 1h wall-clock
  })
})

worker('webhook-deliver', async (job) => {
  const { url, payload } = job.data
  await reporting.deliverOnce(url, payload)   // single attempt, throws on !ok
})

// pg-boss auto-moves to DLQ after retryLimit; we keep a DLQ consumer:
boss.work('__state__failed__webhook-deliver', async (job) => {
  bus.publish('webhook.dead-letter', { url, reason, attempts, ...job.data })
  // telemetry writes to events table
})
```

`WebhookService.deliver()` shrinks to `deliverOnce()` — a single HTTP call that throws on failure. Retry policy + durability move to pg-boss.

---

## 5. Contract Synchronization Across Server / CLI / Web

### 5.1 Where Shared Schemas Live

**Recommendation: per-module re-exports, not a separate `shared/` top-level.**

```
server/
├── jobs/
│   ├── schema.ts           # Zod schemas (input, output, event shapes)
│   ├── events.ts           # typed bus contracts (TS types derived from Zod)
│   ├── index.ts            # barrel: public API (service, routes, schemas, events)
│   └── ...
├── pool/
│   ├── schema.ts
│   ├── events.ts
│   ├── index.ts
│   └── ...
```

Each module's `index.ts` re-exports its `schema.ts` types + Zod objects. Other modules import from the barrel only (`import { JobCreateInput } from '../jobs/index.js'`), never from internals.

**Why not a separate `shared/` folder:**
- Creates a dumping ground that's nobody's responsibility.
- Hides module ownership — a schema should live with the module that produces/consumes it.
- The rare truly-cross-cutting type (`Platform`, `CorrelationId`) goes into `server/types/` which already exists.

**For CLI and Web consumption:** the server generates **OpenAPI 3.1** at build time from Zod schemas (via `zod-to-openapi` or `@asteasolutions/zod-to-openapi`). The spec becomes the contract both CLI and web read.

### 5.2 OpenAPI Generation Pipeline

```
# Build-time step (new npm script)
npm run openapi:generate
  └→ tsx scripts/generate-openapi.ts
       ├→ imports route modules (side-effect: each module registers schemas)
       ├→ OpenAPIRegistry collects all schemas
       └→ writes dist/openapi.json + contracts/openapi.json
```

### 5.3 Codegen Targets

| Target | Tool | Output | Commit? |
|--------|------|--------|---------|
| Go CLI types | `oapi-codegen` with `-generate types,client` | `cli/internal/client/generated.go` | **Yes, commit** — Go devs don't run npm |
| Web client | `openapi-typescript` + hand-written `apiFetch` wrapper | `web/src/lib/api/generated-types.ts` | Commit (diff-reviewable; CI verifies freshness) |
| OpenAPI JSON | `zod-to-openapi` emitter | `contracts/openapi.json` | Commit |

**Commit generated files** (do not `.gitignore`):
- Diff review catches breaking changes.
- `go build` doesn't need npm to have been run.
- CI runs `npm run openapi:generate && git diff --exit-code` to enforce freshness.

### 5.4 Build Order

```
npm run build:contracts
  ├→ tsc --noEmit (type-check Zod schemas)
  └→ npm run openapi:generate   → contracts/openapi.json

npm run build:server            → dist/ (depends on build:contracts)
npm run build:cli-types         → cli/internal/client/generated.go
npm run build:web-types         → web/src/lib/api/generated-types.ts

cd cli && go build              (reads checked-in generated.go)
npm run web:build               (reads checked-in generated-types.ts)
```

Top-level `npm run build` runs the first three in sequence. `go build` and `npm run web:build` stay independent; they consume committed generated files. CI validates: `npm run build:contracts && git diff --exit-code contracts/ cli/internal/client/generated.go web/src/lib/api/generated-types.ts`.

### 5.5 WebSocket Message Contract

OpenAPI doesn't cover WS. Use a **separate JSON Schema emitted from Zod**:

```
contracts/ws-messages.json      # JobMessage, DevicePreviewMessage, PipelineRunMessage
```

Go CLI: hand-rolled decoder matching the TS type. Web: re-use Zod types directly. Long-term: AsyncAPI spec if WS grows beyond 3-4 channels.

---

## 6. Database

### 6.1 New Tables

#### `events` (append-only audit)

```sql
CREATE TABLE events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      VARCHAR(128) NOT NULL,         -- 'job.created', 'device.booted', ...
  event_version   SMALLINT NOT NULL DEFAULT 1,   -- for schema evolution
  correlation_id  UUID,                          -- request/job trace id
  aggregate_type  VARCHAR(64),                   -- 'job', 'device', 'pipeline_run', 'hook'
  aggregate_id    UUID,                          -- row id of the aggregate
  payload         JSONB NOT NULL,                -- Zod-validated event shape
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX events_correlation_id_idx   ON events (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX events_event_type_idx       ON events (event_type, created_at DESC);
CREATE INDEX events_aggregate_idx        ON events (aggregate_type, aggregate_id, created_at DESC);
CREATE INDEX events_created_at_idx       ON events (created_at DESC);  -- for retention sweeps
```

**Append-only invariant:**
- No UPDATE or DELETE in application code. Retention handled by a single cleanup job (`lifecycle-events-retention`, pg-boss) that `DELETE FROM events WHERE created_at < now() - interval '90 days'`.
- Consider `PARTITION BY RANGE (created_at)` monthly once volume > 10M rows. Not needed at <50 tests/day; flag for later.

**Writer:** only the `telemetry` plugin writes to `events`. All other modules publish to bus; telemetry filters & persists. Centralizes the write path.

**What NOT to put in events:** per-line Maestro stdout (goes to WS + `jobs.maestroOutput`), memory samples (goes to `memory.json` artifact), frame data (never persisted). Only **state transitions** and **external effects**.

#### `pgboss` schema (auto-created by pg-boss)

pg-boss creates its own schema on first `boss.start()`. Tables include `pgboss.job`, `pgboss.schedule`, `pgboss.version`, `pgboss.archive`. **Isolate to its own schema** — configure `schema: 'pgboss'` (default) so it doesn't collide with Drizzle migrations.

Drizzle introspection should ignore `pgboss.*`. Add to `drizzle.config.ts`:

```typescript
export default defineConfig({
  schemaFilter: ['public'],   // exclude pgboss schema
  // ...
})
```

### 6.2 Migration Strategy

**Current:** `npx drizzle-kit push` (no generated migration files checked in).

**Recommendation for v3.0 refactor:**

| Phase | Approach | Rationale |
|-------|----------|-----------|
| Development | `drizzle-kit push` | Fast iteration while shapes settle |
| Freeze point (pre-pilot PR) | `drizzle-kit generate` → commit SQL | Lock schema shape; produce migration file for `events` table |
| Production | `drizzle-kit migrate` | Deterministic, reviewable |

For **this refactor specifically** (adds only `events` table, leaves existing tables alone), a single generated migration is sufficient. Later milestones can switch to generated-only if the team wants. No urgency to change the current `push` workflow beyond the single `events` addition.

pg-boss bootstraps itself (`boss.start()` runs its own migrations). No Drizzle interaction needed.

---

## 7. Testing Strategy

### 7.1 Unit Tests — "Test as Spec"

Every module's `__tests__/` folder has **one file per public operation**, describe-blocks named by **operation + condition**, not by implementation detail:

```typescript
// server/hooks/__tests__/hook-executor.test.ts
describe('HookExecutor.execute', () => {
  describe('when event has no registered hooks', () => {
    it('returns empty array', ...)
  })
  describe('when hook matches event and platform', () => {
    it('executes with expected environment variables', ...)
    it('emits hook.executed on success', ...)
    it('emits hook.failed on non-zero exit', ...)
  })
  describe('when failOnError=true and hook fails', () => {
    it('throws to caller', ...)
  })
  describe('when timeout exceeds timeoutMs', () => {
    it('kills the process and emits hook.failed with reason=timeout', ...)
  })
})
```

The **describe tree is the module's public spec**. A future reader — or LLM — learns the contract by reading test headings alone.

### 7.2 Integration Tests

| Scope | Where | Test |
|-------|-------|------|
| Per-module happy path | `server/<module>/__tests__/integration/` | Module wired into a mini-Fastify with real bus + test pg-boss |
| Cross-module job lifecycle | `server/__tests__/integration/job-lifecycle.test.ts` | Full: POST /api/jobs → pg-boss worker → pool allocate → fake maestro → bus events → webhook queued → DB asserted |
| Contract roundtrip | `server/__tests__/contracts/openapi-roundtrip.test.ts` | Regenerate openapi; assert Go/web types compile against it |

### 7.3 Bus in Tests — Real vs Mock

**Rule:**
- **Unit tests** of a single module: **real bus**, subscribe in test to assert emissions. Mocking `bus.publish` loses the subscribe-shape assertion and drifts when event names change.
- **Unit tests** of a consumer-only flow: spy on `bus.subscribe` or drive the subscriber directly.
- **Integration tests**: always real bus + real pg-boss (test container or inline Postgres).

The bus is a thin EventEmitter wrapper — mocking it buys nothing. Real bus also catches wiring bugs: "module X didn't subscribe to the event it promised in MODULE.md."

### 7.4 pg-boss in Tests

| Option | Verdict |
|--------|---------|
| In-memory shim (fake pg-boss) | **No** — would let tests pass when real pg-boss fails (schema quirks, tx behavior) |
| SQLite in-memory | **No** — pg-boss is PG-only (uses SKIP LOCKED, advisory locks) |
| Testcontainers (Docker PG per suite) | **Recommended for CI** — slow startup (~3s) but fully isolated |
| Shared local PG (`devicefarm_test` DB, truncate between tests) | **Recommended for local dev** — fast, one-time setup |

```typescript
// server/__tests__/helpers/queue.ts
export async function startTestQueue(db: Database) {
  const boss = new PgBoss({ ..., schema: 'pgboss_test' })
  await boss.start()
  await boss.clearStorage()    // reset between tests
  return boss
}
```

Most module unit tests should not need pg-boss at all — they publish events / call `queue.enqueue`, and the queue interface is mockable for shallow tests. Reserve real pg-boss for the handful of tests that verify retry/DLQ behavior.

---

## 8. Tech Debt Folded Into the Refactor

### 8.1 Phase 15 Operational Deps

| Debt | Where it surfaces | v3.0 phase that fixes it |
|------|-------------------|--------------------------|
| `lifecycle → api` undeclared dep | `server/index.ts`; `api` reads `lifecycleStats` via `reportRoutes` | **Phase: lifecycle migration** — when `lifecycle` migrates to pg-boss, its plugin is rewritten; add `lifecycle` to `api`'s declared deps |
| `file:../device-stream` coupling | `package.json` — `"@device-stream/*": "file:../device-stream/..."` | **Phase: contracts/build** — publish `@device-stream/*` as private packages (GitHub packages / internal npm); consume via `"^x.y.z"` |
| `installSimCapture` sibling-repo requirement | Boot script expects `../device-stream` checked out | Same phase — once published, installer fetches from registry |
| `job-plugin` vs `jobs-plugin` name mismatch in pipelines deps | `server/pipelines/plugin.ts` line 69 | **Phase: pilot foundations** — trivially fixed when plugin names are normalized |
| `websocket-plugin` missing `pool` dep | `server/streaming/websocket-plugin.ts` | **Phase: streaming refactor** |

These belong in a **"build & ops hygiene"** phase (separate from the module refactor). Recommended slot: **after the pilot module ships** (proves the pattern) and **before the `pool`/`jobs` refactor** (which will depend on clean device-stream contracts).

### 8.2 CLI `deviceName` UUID Bug

**Root cause:** `cli/internal/client/types.go` `Job.DeviceName` expects `deviceName` in JSON; `server/api/routes.ts` job response includes `deviceId` (UUID) but no `deviceName`.

**Fix location:** **server response**, not CLI.
- The server has the info (`device.name` on every `devices` row).
- Multiple clients benefit (web UI has the same gap today).
- CLI-side decode would require an extra round-trip to `GET /api/devices/:id`.

Patch: in `jobs/routes.ts` (new module barrel), the job-detail handler joins `devices` and returns both `deviceId` and `deviceName`. Zod output schema enforces the shape; codegen propagates to Go + web.

**Phase:** **jobs module refactor** (Phase 5 in the sequence below).

### 8.3 Nyquist Validation

Not an architectural change — it's a **process gate**. Hook it into the roadmap `success_criteria` of every phase (v3.0 phases MUST pass Nyquist validation before being marked complete). This is a roadmapper concern, not a code concern.

---

## 9. Build Order — Module Migration Sequence

Ordered by **risk, dependency, and learning value**:

| # | Phase | Why this slot | Rough size |
|---|-------|---------------|------------|
| 1 | **Foundations**: `event-bus`, `correlation`, `queue` (pg-boss), `telemetry`, `events` table | Nothing works without these. Small, no app code changes. Adds 4 plugins + 1 table. | S-M |
| 2 | **Pilot: `hooks` module** | Proves MODULE.md + barrel + events.ts + queue integration on the smallest real module. Blast radius low. | M |
| 3 | **Build & ops hygiene**: OpenAPI generation, Go/TS codegen, `file:../device-stream` → published packages, fix plugin dep declarations + name mismatches | Unblocks contract-driven CLI/web work; removes sibling-repo requirement. | M |
| 4 | **`lifecycle` migration** | Pure queue migration (node-cron → pg-boss.schedule). Validates pg-boss schedule API. Sets pattern for `pipelines/scheduler`. | S |
| 5 | **`reporting` migration** | Webhook → pg-boss; flaky-detector → bus subscriber. Exercises retry/DLQ in production path. | M |
| 6 | **`pool` (devices) module** | Emits `device.*` events; unblocks decoupling of `jobs`. State machine is critical — careful. | L |
| 7 | **`artifacts` module** | Subscribes to `job.*` events; no longer called imperatively by `jobs`. | M |
| 8 | **`streaming` module** | Subscribes to bus, translates to WS messages; replaces direct broadcaster calls in jobs. | M |
| 9 | **`jobs` module** (keystone) | Refactor to publish events instead of imperatively calling dependencies. Removes all `.catch(() => {})` patterns. Includes `deviceName` fix. | L |
| 10 | **`maestro` module** | Extract from route files; subscribe to `device.booted` for metadata collection. | M |
| 11 | **`pipelines` module** | Scheduler → pg-boss; executor subscribes to `job.completed`. | L |
| 12 | **`auth` module** | Smaller refactor — Zod for API key routes, publish `auth.key.*` events. Late because low ROI. | S |
| 13 | **`api` module + route aggregation** | Last: every module exposes routes via its own barrel; `api` becomes thin aggregator + error handler + multipart. | M |
| 14 | **CLI (Go) refactor** | Switch to codegen from OpenAPI; consolidate client package; align with new `deviceName` shape. | M |
| 15 | **Web (SvelteKit) refactor** | Switch to codegen types; route-local schemas; align WS message handling. | M |
| 16 | **Test migration** | Per-module tests-as-spec rewrite; add cross-module integration + contract roundtrip tests. | Incremental across phases 2-13 |

**Rationale for ordering:**
- Foundations first — nothing else compiles without bus/queue.
- Pilot before any big module so MODULE.md conventions can be adjusted cheaply.
- Contracts/codegen before CLI & web so those refactors consume generated types.
- `pool` before `jobs` (pool is a dep of jobs — events must flow downward).
- `jobs` is the keystone — most visible change; do it once everything it subscribes to exists.
- `api` last — it depends on every module's routes being in place.
- CLI + web are leaf consumers of the contract; they refactor once the server-side schema is stable.

---

## 10. Integration Points

### 10.1 External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| PostgreSQL | Drizzle (public schema) + pg-boss (pgboss schema) | Same connection pool, different schemas |
| `@device-stream/*` | Peer dep of `pool`/`artifacts` | Move to published packages (see 8.1); expose via `pool.driver` so jobs never imports directly |
| Maestro CLI | `child_process.spawn` from `jobs/maestro-executor.ts` | Keep as-is; wrap stdout parsing in a stream that publishes bus events |
| Appium | HTTP client in `maestro` module | Unchanged |
| Webhook targets | HTTPS POST via pg-boss worker | Single-attempt HTTP per queue retry; retry policy owned by pg-boss |

### 10.2 Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `jobs` ↔ `pool` | Direct method for state changes; events for reactions | State-changing ops stay synchronous; reactions via bus |
| `jobs` ↔ `artifacts` | Events (`job.started`, `job.completed`) | Artifacts no longer called imperatively from inside `executeJob` |
| `jobs` ↔ `streaming` | Events (`job.log`, `job.step`, `job.status`) | Streaming becomes pure subscriber + WS fanout |
| `jobs` ↔ `reporting` | Events | Webhooks enqueue in subscriber, not in-line |
| `pipelines` ↔ `jobs` | Direct call for `createJob`; events for completion | Pipeline executor creates child job, subscribes to its completion event scoped by `correlationId` |
| `hooks` ↔ `pool`/`jobs` | Events | Hooks consume `device.*` and `test.*` events |
| `api` ↔ all modules | Direct import of module barrel (service methods, Zod schemas) | `api` is an aggregator; never reaches into module internals |
| `lifecycle` ↔ all | pg-boss schedules; no direct coupling | Each scheduled job targets its module's public API |

### 10.3 Correlation ID Propagation

```
HTTP request
  ├→ api onRequest hook: generate correlationId (or read X-Correlation-Id header)
  ├→ correlation.runWithContext({ correlationId, requestId }, async () => {
  │    ├→ route handler
  │    │    ├→ logger.child({ correlationId }) via bindings
  │    │    └→ service call
  │    │         ├→ db.insert / bus.publish / queue.enqueue
  │    │         │    (all read correlationId from ALS)
  │    │         └→ pg-boss job data includes correlationId
  │    └→ response
  │ })
  └→ response headers: X-Correlation-Id (echo back)

Worker path:
  pg-boss worker
    └→ correlation.runWithContext({ correlationId: job.data.correlationId }, handler)
         └→ all downstream publishes/inserts inherit the id
```

AsyncLocalStorage in Node 20+ is cheap (<1µs per context hop). Safe to use liberally.

---

## 11. Scaling Considerations

Project scale is small (<50 tests/day). Scaling concerns are **single-node correctness**, not throughput.

| Scale | Adjustments |
|-------|-------------|
| Current (<50 tests/day) | Everything on one Mac Mini. No changes post-refactor. |
| 10× (500 tests/day) | pg-boss `teamSize`/`teamConcurrency` tunable per queue name; add monitoring dashboard from `events` table |
| 100× (5000 tests/day) | Consider dedicated Postgres host; partition `events` by month; multi-node requires distributed device pool (out of scope per PROJECT.md) |

**First bottleneck:** device pool capacity (fixed by hardware), not software. Refactor makes it easier to measure — `events` table has start/finish timestamps per job, enabling utilization queries.

**Second bottleneck:** webhook target latency. pg-boss retries decouple this from the job critical path.

---

## 12. Anti-Patterns (Specific to This Refactor)

### 12.1 Using the bus as an RPC

**Mistake:** `await bus.publish('device.allocate', ...)` expecting a return value.
**Why wrong:** publish is fire-and-forget; multiple subscribers; no return channel.
**Do instead:** for request/response use the module's direct API (`pool.allocate(...)` returns the device). Use the bus only for notifications.

### 12.2 Publishing per-log-line to the bus

**Mistake:** every Maestro stdout line → `bus.publish('job.log', ...)` → every subscriber runs.
**Why wrong:** bus fanout cost per line; `events` table overflow; WS-only data.
**Do instead:** log lines flow directly from the Maestro executor into `JobBroadcaster`. Only **state transitions** go on the bus (`job.started`, `job.step.finished`, `job.completed`).

### 12.3 Subscribing to `job.*` from inside `jobs`

**Mistake:** `jobs` subscribes to its own events to trigger side-effects.
**Why wrong:** loops; unclear ownership; defeats the point of events.
**Do instead:** if `jobs` needs a reaction, do it synchronously in the producing method. Events are for *other* modules.

### 12.4 Using pg-boss for sub-second work

**Mistake:** enqueue a job that runs in 50ms.
**Why wrong:** pg-boss polls (default 2s); adds latency; writes to DB unnecessarily.
**Do instead:** small synchronous work stays in-proc. Queue only work that needs (a) durability, (b) retry, (c) throttling/concurrency control, or (d) scheduling.

### 12.5 Decorator as service locator

**Mistake:** module A reaches into `fastify.thingFromModuleB.internalMethod()`.
**Why wrong:** current v2.x pattern; tight coupling; hard to test.
**Do instead:** import module B's barrel (`import { thing } from '../b/index.js'`). Decorators only hold the module's **public API**. Ideally phase out decorator-based lookup entirely post-refactor.

---

## 13. Sources

- [timgit/pg-boss — GitHub](https://github.com/timgit/pg-boss) — queue library, schedule API, DLQ behavior
- [pg-boss — npm](https://www.npmjs.com/package/pg-boss) — current version, Postgres-only design
- [Scheduled Jobs with pg-boss — LogSnag](https://logsnag.com/blog/deep-dive-into-background-jobs-with-pg-boss-and-typescript) — cron scheduling pattern
- Internal: `server/index.ts` — plugin registration order (read in full)
- Internal: `server/jobs/job-service.ts` — current job pipeline (read in full)
- Internal: `server/db/schema.ts` — 25 existing tables (read in full)
- Internal: `.planning/PROJECT.md` — v3.0 milestone scope, pillars, constraints
- Internal: `server/hooks/plugin.ts`, `server/pipelines/scheduler.ts`, `server/lifecycle/lifecycle-plugin.ts` — cron usage patterns to replace
- Internal: `server/streaming/job-broadcaster.ts` — ring buffer semantics to preserve
- Internal: `cli/internal/client/types.go` — `deviceName` UUID bug location

---

*Architecture research for: Device Farm v3.0 Spec-Driven refactor*
*Researched: 2026-04-16*
*Next consumer: roadmapper (module map → phase structure; build order → phase sequence; integration points → phase success criteria)*
