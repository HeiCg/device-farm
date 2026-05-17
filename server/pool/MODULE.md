# Pool Module

## Purpose

Own the device pool: the `Device` state machine (`VALID_TRANSITIONS`-gated; 7 states across 2 platforms), the allocation mutex (`PoolManager.allocateMutex`), the 30-second in-process `HealthChecker` probe loop, and the `device.reap` pg-boss schedule (every minute; replaces v2.0's raw `setInterval` reaper). Emits 4 typed events — `device.state.changed`, `device.allocated`, `device.released`, `device.health.failed` — so Phase 21+ modules (`artifacts`, `jobs`, `maestro`, `hooks`, `streaming`) can react to device lifecycle without reaching into pool internals.

The module is a **publisher only** in Phase 20. No bus subscribers live here. Downstream phases add the consumer side: Phase 21 (`artifacts` subscribes to `device.state.changed` filtered on Running→Cleanup for recording upload); Phase 23 (`jobs` keystone consumes `device.allocated` / `device.released` as saga signals); Phase 24 (`maestro` subscribes to `device.state.changed` filtered on Booting→Idle for hierarchy/device-info collection).

## Public API

Exports from `server/pool/index.ts` (the ONLY legitimate import surface outside this module — enforced by `dependency-cruiser` rule `no-deep-imports-into-pool-internal` added in Phase 20 Plan 20-00):

- `poolPlugin` — Fastify plugin (thin wrapper around `createPoolModule`).
- `createPoolModule(deps): PoolModule` — factory returning `{pool, healthChecker, emit, bus, registerWorkersAndSubscribers, shutdown}`.
- `PoolManager` class — back-compat. `fastify.pool: PoolManager` decorator read by api/jobs/maestro/hooks/streaming.
- `HealthChecker` class — back-compat. `fastify.healthChecker: HealthChecker` decorator.
- `ProcessTracker` class — back-compat. `fastify.processTracker: ProcessTracker` decorator.
- `Device`, `InvalidTransitionError` — entity class + error.
- Events: `poolRegistry`, `POOL_EVENT_NAMES`, `POOL_AGGREGATE_ID`, `makePoolEmitters`, and 4 payload schemas (`deviceStateChangedPayload`, `deviceAllocatedPayload`, `deviceReleasedPayload`, `deviceHealthFailedPayload`).
- Queue: `DEVICE_REAP_QUEUE_NAME`, `DEVICE_BOOT_QUEUE_NAME`, `REAP_CRON`, `registerPoolQueues`.
- Schemas (from Phase 17): `deviceStateSchema`, `platformSchema`, `deviceMetadataSchema`, `deviceSummarySchema`, `deviceListSchema`, type `DeviceSummary`.
- Types: `PoolModule`, `CreatePoolModuleDeps`, `PoolRegistry`, `PoolEmitters`, `PoolEventName`, `RegisterPoolQueuesDeps`, `PoolQueueRegistration`, `OrphanInfo`, `KillResult`.

Fastify decorators exposed by the plugin:
- `fastify.pool: PoolManager`
- `fastify.processTracker: ProcessTracker`
- `fastify.healthChecker: HealthChecker`
- `fastify.poolModule: PoolModule`

## Events Emitted

- `device.state.changed` — **NOT persisted**. Fires on every `VALID_TRANSITIONS`-allowed transition. Payload: `{deviceId, from, to}`. High-frequency — skipping events-table persistence per TRACE-08 (derivable from Phase 21+ consumers if needed; flip the registry flag to turn it on).
- `device.allocated` — **NOT persisted**. Fires from `PoolManager.allocate()` INSIDE `allocateMutex`, AFTER `device.allocate(jobId)` succeeds. Payload: `{deviceId, jobId, platform}`.
- `device.released` — **NOT persisted**. Fires from `PoolManager.release()` AFTER `device.release()` returns. Payload: `{deviceId, jobId: string | null, platform}` — `jobId` captured BEFORE `device.release()` clears `currentJobId`, so consumers can link the release to its originating job.
- `device.health.failed` — **PERSISTED** (TRACE-08 operational telemetry). Fires from `HealthChecker` on EVERY failed probe regardless of whether the state actually transitions. Payload: `{deviceId, platform, reason, failureCount, willReplace, lastError}` where `reason` is one of `'unhealthy' | 'zombie' | 'max-retries' | 'timeout'` (discriminator). Phase 27 trace-tree endpoint surfaces persisted rows.

All 4 events share `aggregateType: 'pool'` and use `aggregateId: deviceId` (per-device, NOT `POOL_AGGREGATE_ID`). `POOL_AGGREGATE_ID = '2a120cd5-4bd3-5f65-a9e5-870ec709e44a'` (stable v5 UUID derived from `'pool'` under the URL namespace, mirroring Phase 18 `LIFECYCLE_AGGREGATE_ID` + Phase 19 `REPORTING_AGGREGATE_ID` pattern) is **reserved** for future pool-wide telemetry (e.g. `pool.initialized`) but NOT used by the 4 events above.

Derivable alias: consumers wanting `device.booted` semantics subscribe to `device.state.changed` filtered on `payload.from === 'booting' && payload.to === 'idle'`. Phase 24 (Maestro) may add `device.booted` as a convenience alias if this filter pattern proves painful in practice.

## Events Consumed

**None in Phase 20** — pool is a publisher-only module. Phase 20 CONTEXT §Deferred Ideas + RESEARCH §Summary both explicitly document this.

Downstream consumer phases:
- Phase 21 Artifacts Module — subscribes to `device.state.changed` (filter on Running→Cleanup) to trigger recording upload.
- Phase 23 Jobs Keystone — subscribes to `device.allocated` / `device.released` as saga transition signals.
- Phase 24 Maestro Module — subscribes to `device.state.changed` (filter on Booting→Idle) for hierarchy/device-info collection.
- Phase 27 API Aggregator — surfaces `device.health.failed` persisted rows via `GET /api/events?correlationId=...` trace-tree endpoint.

## Queue Produced

- `device.reap` — `policy: 'stately'`, `retryLimit: 1`, `retryBackoff: true`, `retryDelay: 30`. Schedule: `'* * * * *'` (every minute) via `fastify.queue.schedule(DEVICE_REAP_QUEUE_NAME, REAP_CRON, {}, {singletonKey: DEVICE_REAP_QUEUE_NAME})`. Registered by `registerPoolQueues` from `server/pool/queue.ts`. Payload: empty object `{}` (the worker invokes `processTracker.reapOrphans()` with no input). `singletonKey + policy:'stately'` prevents overlap if a reap cycle runs long (e.g. slow `ps axo` on macOS).
- `device.boot` — **RESERVED NAME ONLY**. The constant `DEVICE_BOOT_QUEUE_NAME = 'device.boot'` is exported for Phase 23 forward-compat but NOT registered as a pg-boss queue in Phase 20. Phase 23 jobs keystone owns the on-demand-boot consumer.

## Queue Consumed

- `device.reap` — worker handler (self-loop — producer + consumer both in pool module) calls `processTracker.reapOrphans()`. ALS is restored from envelope.correlationId BEFORE the handler fires (Phase 15 substrate `server/queue/plugin.ts`); scheduled fires per Plan 18-00 Option B generate a fresh correlationId per fire (envelope stored with `correlationId: null`).

## Invariants

Every invariant below has at least one test (MOD-08). Test file citations point to the canonical spec file under `server/pool/__tests__/`:

- **(a) `VALID_TRANSITIONS`-only state changes** — `Device.transition(newState)` throws `InvalidTransitionError` when `newState` is not in `VALID_TRANSITIONS[this._state]`. Test: `device-state.spec.ts` `[Invariant MOD-08 (a)]`.
- **(b) Every successful transition emits exactly one `device.state.changed` envelope** — the 6 call sites in `pool-manager.ts` + the 4 failure code paths in `health-checker.ts` + restart/replace paths all invoke `emit.stateChanged` AFTER the transition. Tests: `allocation.spec.ts` `[SC1]`, `events.spec.ts` `[Invariant MOD-08 (b)]`.
- **(c) `PoolManager.allocate()` is mutex-protected** — concurrent allocate calls for the same platform serialise via `allocateMutex.runExclusive`; exactly one `device.allocated` envelope per successful allocation. Test: `allocation.spec.ts` `[SC1]` concurrency test.
- **(d) `device.health.failed` fires on every failed probe** — regardless of whether the device state changes (RESEARCH §Pitfall 2). `reason` discriminator identifies the failure path (`unhealthy` / `zombie` / `max-retries` / `timeout`). Test: `health-checker.spec.ts` `[SC1]` per-reason tests.
- **(e) Reaper never kills allocated-device PIDs** — `processTracker.scanOrphans()` filters by `!trackedPids.has(pid) && !trackedPids.has(pgid)`; the reaper worker body preserves this guard. Test: `process-tracker.spec.ts` `[Invariant MOD-08 (e)]`.
- **(f) `processTracker.register(pid)` called BEFORE `device.transition(Idle)`** — prevents the register/reap race (RESEARCH §Pitfall 3). Test: `allocation.spec.ts` `[Invariant MOD-08 (f)]` (spy-order assertion).
- **(g) `poolModule.shutdown()` is idempotent** — second call is no-op via `stopped` flag; no extra `healthChecker.stop()` or `offWork` calls. Test: `module.spec.ts` `[Invariant MOD-08 (g)]`.

## Non-Goals

- **`device.booted` as first-class event** — CONTEXT §Specifics + RESEARCH §Pitfall 4 defer to Phase 24 Maestro. Consumers filter `state.changed {booting→idle}` today.
- **`pool.shutdown()` migration into `module.shutdown`** — RESEARCH §Open Question 1 documents the timing constraint (current `server/index.ts` flow needs `pool.shutdown()` AFTER `jobService.shutdown()` but BEFORE `app.close()`). Keeping it imperative in `server/index.ts` with a TODO comment; Phase 23 jobs keystone may revisit.
- **Android/iOS driver internal refactor** — CONTEXT §Deferred. Drivers stay under `android/` + `ios/` sub-directories with their current kebab-case files.
- **Hot-plug device detection** — Phase 36 / Plan 36-01 replaced the one-shot `detectPhysicalDevices` scan with the `DeviceDiscoveryService` 5s poller emitting `device.discovered.added/removed/changed`. PoolManager subscribes via `adoptDiscoveredDevice` / `handleDiscoveryRemoval`. A push-based watcher (libimobiledevice / udev) is still deferred.
- **`device.*` webhook fan-out** — reporting module subscribes only to `job.completed` today. Adding device webhooks is downstream.
- **Consolidation of duplicated `persistEnvelope` middleware** — 4th sample point reached with pool (hooks + lifecycle + reporting + pool). Phase 27+ consolidation trigger noted in all 4 factory files; do NOT consolidate yet.
- **Registering `device.boot` pg-boss queue in Phase 20** — Phase 23 jobs keystone owns the consumer; registering without a consumer traps sends (RESEARCH §Anti-Patterns).
- **Rewiring existing deep imports** (`jobs/plugin.ts` → `pool/pool-manager.ts`, etc.) — CONTEXT §Deferred Ideas. New code MUST use the barrel; existing deep imports are Phase 21/23/24 cleanup scope.

## Dependencies

Declared in `server/pool/plugin.ts` `dependencies: ['config', 'db', 'queue', 'event-bus']`:

- `config` — reads `fastify.config.pool.{android, ios}` for driver enablement + `max_instances` + platform-specific boot options.
- `db` — writes `events` rows via the `persistEnvelope` middleware (persisted: `device.health.failed` only).
- `queue` — registers the `device.reap` schedule + worker via `fastify.boss.createQueue` + `fastify.queue.schedule` + `fastify.queue.work`; `offWork`s on shutdown.
- `event-bus` — structural dependency: pool maintains its own per-module `TypedBus<PoolRegistry>` but `fastify.bus` + `fastify.onPersisted` decorators from the bus plugin are required for downstream subscriber wiring (Phases 21/23/24) + the `subscriber.spec.ts` DB-gated proof uses `fastify.onPersisted`.

---

### Runnable Example

```typescript
// Inside a Fastify plugin that has already registered config + db + queue + event-bus + pool:
import {
  POOL_EVENT_NAMES,
  POOL_AGGREGATE_ID,
  DEVICE_REAP_QUEUE_NAME,
} from 'server/pool/index.js';

// Listen for device.state.changed via the module's per-module bus:
app.poolModule.bus.on(POOL_EVENT_NAMES.STATE_CHANGED, (payload) => {
  app.log.info(
    { deviceId: payload.deviceId, from: payload.from, to: payload.to },
    'Device state changed',
  );
});

// Listen for device.health.failed via the persisted side-channel (same payload + envelope):
app.onPersisted('device.health.failed', (envelope) => {
  app.log.warn(
    { deviceId: envelope.aggregateId, reason: envelope.payload.reason },
    'Device health failed — persisted event row in events table',
  );
});

// Query the events table by correlation for operational debug:
// SELECT * FROM events WHERE aggregate_type = 'pool' AND correlation_id = $1 ORDER BY occurred_at;
```

Phase 27 (MOD-09) will add CI-level typechecking of this snippet. For Phase 20, reviewer spot-checks the block.
