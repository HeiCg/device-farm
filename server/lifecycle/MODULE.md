# Lifecycle Module

## Purpose

Run durable housekeeping tasks on pg-boss schedules: video compression (daily), expired-artifact retention (daily), disk-pressure-driven cleanup (hourly). Replaces v2.0's `node-cron` + `async-mutex` scheduling with queue-layer overlap protection (`policy: 'stately'` + `singletonKey`) and per-fire correlationId traceability. Tasks are pure functions invoked by worker handlers; worker handlers emit persisted telemetry events for observability.

## Public API

Exports from `server/lifecycle/index.ts` (the ONLY legitimate import surface outside this module — enforced by `dependency-cruiser` rule `no-deep-imports-into-lifecycle-internal`):

- `lifecyclePlugin` — Fastify plugin (thin wrapper around `createLifecycleModule`).
- `createLifecycleModule(deps): LifecycleModule` — factory returning `{stats, emit, bus, registerSchedulesAndWorkers, shutdown}`.
- `LifecycleStats` type — stats decorator shape (back-compat with `/health` endpoint).
- `lifecycleRegistry`, `LIFECYCLE_EVENT_NAMES`, `makeLifecycleEmitters` — per-module event registry + typed emit helpers.
- `LIFECYCLE_COMPRESS_DAILY_QUEUE_NAME`, `LIFECYCLE_RETENTION_DAILY_QUEUE_NAME`, `LIFECYCLE_DISK_HOURLY_QUEUE_NAME` — queue-name constants.
- `COMPRESS_CRON`, `RETENTION_CRON`, `DISK_CRON` — cron expression constants.
- `registerLifecycleSchedulesAndWorkers` — queue registration factory used by the plugin.
- `lifecycleJobPayloadSchema` + `LifecycleJobPayload` — Zod payload shape (SPEC-01 / SPEC-03).
- `compressionResultSchema`, `retentionResultSchema`, `diskPressureResultSchema` + 3 `*Parsed` derived TS types — task-result schemas (SPEC-01 / SPEC-03).

## Events Emitted

All four events are **persisted** (terminal operational telemetry per TRACE-08); aggregate `'lifecycle'`:

- `lifecycle.compression.completed` — `{compressed, savedBytes, durationMs}`. Fired after a successful compression fire.
- `lifecycle.retention.completed` — `{deleted, freedBytes, durationMs}`. Fired after a successful retention fire.
- `lifecycle.disk.checked` — `{currentUsageBytes, maxBytes, deleted, freedBytes, durationMs}`. Fired after a successful disk-pressure fire.
- `lifecycle.task.failed` — `{task: 'compression'|'retention'|'disk-pressure', error, durationMs}`. Fired when any task throws; handler re-throws for pg-boss retry accounting.

## Events Consumed

None. Lifecycle is a scheduled producer only — no bus subscriptions in Phase 18. Deferred to future phases if event-driven housekeeping is introduced.

## Queue Produced

All three use `policy: 'stately'` + `singletonKey: <queue-name>` so a second fire is DROPPED at the queue boundary when the first is still in-flight (RESEARCH §Pitfall 1). `retryLimit: 1`, `retryBackoff: true`, `retryDelay: 30`.

- `lifecycle.compress.daily` — cron `'0 3 * * *'` (daily at 3 AM UTC). Runs `runCompressionTask`.
- `lifecycle.retention.daily` — cron `'0 3 * * *'` (daily at 3 AM UTC). Runs `runRetentionTask` CONCURRENTLY with compression — deletes expired artifacts (orthogonal to compression's artifact set).
- `lifecycle.disk.hourly` — cron `'0 * * * *'` (hourly on the hour). Runs `runDiskPressureTask`.

## Queue Consumed

Same three queues (self-loop: producer + consumer in same module). Workers are registered in `server/lifecycle/queue.ts` via `registerLifecycleSchedulesAndWorkers`. Each worker handler restores ALS correlationId from the per-fire envelope (Phase 15 substrate `fastify.queue.work`) then invokes the respective pure task body.

## Invariants

- **(a) No overlapping fires** — `policy: 'stately'` + `singletonKey` drops duplicate sends at the queue layer. Test: `__tests__/queue.spec.ts` (`[Invariant a]` / `[RESEARCH §Pitfall 1]`).
- **(b) Per-fire correlationId** — every scheduled fire gets a fresh UUID; consecutive fires observe DIFFERENT ids. Test: `__tests__/correlation.spec.ts` (`[Invariant b]` / `[QUEUE-08 SC2 + Option B]`).
- **(c) Worker failure does not crash the plugin** — task throws → handler emits `lifecycle.task.failed` then re-throws for pg-boss retry. Covered structurally by the try/catch in each of the 3 worker handlers in `queue.ts`; operational verification is `__tests__/graceful-shutdown.spec.ts` (`[Invariant c]`) which asserts no unhandled rejections after shutdown.
- **(d) `fastify.lifecycleStats` updates after each successful run** — back-compat for `server/api/routes.ts:439` /health endpoint. Exercised structurally by `__tests__/module.spec.ts` (`[Invariant d]`) + graceful-shutdown.spec.ts.
- **(e) Graceful shutdown drains in-flight within timeout** — `boss.stop({graceful: true, timeout: 30_000})` owned by queue plugin; lifecycle's onClose calls `module.shutdown()` which `offWork`s the 3 workers. Test: `__tests__/graceful-shutdown.spec.ts` (`[Invariant e]` / `[SC4]`).

## Non-Goals

- **Event-driven housekeeping** (e.g. cleanup-on-job-completed) — future phase.
- **DLQ surface for retry-exhausted lifecycle jobs** — Phase 19 (EVENTS-07, QUEUE-05) handles repo-wide DLQ pipeline; `lifecycle.task.failed` events will flow through it without code change here.
- **Removing `node-cron` from `package.json`** — Phase 25 (`server/pipelines/scheduler.ts` still imports it; full dependency removal is the pipelines module refactor).
- **Changing the three task bodies' signatures or logic** — Phase 18 is pure substrate + wiring; `runCompressionTask` / `runRetentionTask` / `runDiskPressureTask` behave identically to v2.0.

## Dependencies

Declared in `server/lifecycle/plugin.ts` `dependencies: ['config', 'db', 'queue', 'event-bus']`:

- `config` — reads `fastify.config.storage.artifacts` for retention_days / compress_after_days / max_storage_gb.
- `db` — reads `fastify.db` for artifact queries (task bodies) + INSERTs into `events` table (persistEnvelope middleware).
- `queue` — uses `fastify.boss.createQueue` + `fastify.queue.schedule` + `fastify.queue.work`.
- `event-bus` — persistEnvelope side-channel fires `<type>.envelope` events that the bus's `onPersisted` subscribers observe.

The `api-plugin` depends on `lifecycle-plugin` (Phase 17 Plan 17-07 added that declaration to `server/api/plugin.ts:dependencies`) so that `server/api/routes.ts:439` can read `fastify.lifecycleStats` at /health time without a registration race.

---

### Runnable Example

```typescript
// Inside a Fastify plugin that has already registered db + queue + event-bus + lifecycle:
import {
  createLifecycleModule,
  LIFECYCLE_COMPRESS_DAILY_QUEUE_NAME,
} from 'server/lifecycle/index.js';

// Direct factory usage (rare — the lifecyclePlugin does this for you):
const module = createLifecycleModule({
  fastify: app,
  db: app.db,
  config: app.config,
  logger: app.log,
});
await module.registerSchedulesAndWorkers();

// Listen for the terminal lifecycle.compression.completed event:
app.lifecycleModule.bus.on('lifecycle.compression.completed', (payload) => {
  app.log.info(
    { compressed: payload.compressed, savedBytes: payload.savedBytes, durationMs: payload.durationMs },
    'Compression fire completed',
  );
});

// Inspect the lifecycle queue name:
app.log.info({ queue: LIFECYCLE_COMPRESS_DAILY_QUEUE_NAME }, 'lifecycle.compress.daily');
```

Phase 27 (MOD-09) will add CI typechecking for this snippet. Phase 18 leaves it reviewer-spot-checked.
