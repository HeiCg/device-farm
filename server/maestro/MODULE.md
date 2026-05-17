# Maestro Module

## Purpose

Own Maestro integration: hierarchy fetching (Maestro CLI / device-stream / native / Appium), device metadata collection (`adb getprop` / `xcrun simctl`), and Appium driver lifecycle. Subscribes to `device.booted` from the pool's bus to trigger boot-time metadata refresh — replacing the imperative `onReady` device-iteration loop that previously lived in `server/maestro/plugin.ts:55-72` (deleted in Plan 24-03).

Maestro is a no-queue module (no pg-boss surface) — same shape as Phase 22 streaming. Two transient events emitted; one cross-module event consumed.

## Public API

Exports from `server/maestro/index.ts` (the ONLY legitimate import surface outside this module — enforced by the `dependency-cruiser` rule `no-deep-imports-into-maestro-internal` added in Phase 24 Plan 24-00 as the 8th forbidden rule).

- **Plugin:** `maestroPlugin` (default, name `'maestro-plugin'`, dependencies `['config', 'db', 'event-bus', 'pool-plugin']`)
- **Factory (canonical v3.0):** `createMaestroModule(deps)` + types `MaestroModule`, `CreateMaestroModuleDeps`
- **Back-compat classes (decorators on fastify still consume these):** `HierarchyService`, `AppiumService`, `DeviceInfoCollector`
- **Events surface:** `maestroRegistry`, `MAESTRO_EVENT_NAMES`, `MAESTRO_AGGREGATE_ID`, `makeMaestroEmitters` + types `MaestroRegistry`, `MaestroEmitters`, `MaestroEventName`, payload schemas `maestroHierarchyFetchedPayload`, `maestroDeviceInfoCollectedPayload`

Fastify decorators exposed by the plugin:

- `fastify.maestroModule: MaestroModule` (NEW canonical surface)
- `fastify.hierarchyService: HierarchyService` (back-compat — Phase 22/23 convention)
- `fastify.appiumService: AppiumService` (back-compat)
- `fastify.deviceInfoCollector: DeviceInfoCollector` (back-compat)

## Events Emitted

| Name                              | Persisted | Aggregate     | When fired                                                          |
|-----------------------------------|-----------|---------------|---------------------------------------------------------------------|
| `maestro.hierarchy.fetched`       | NO        | maestro       | After `HierarchyService.getHierarchy` resolves (route-side, Plan 24-03 wiring) |
| `maestro.device-info.collected`   | NO        | maestro       | After `device.booted` handler completes `DeviceInfoCollector.collect` |

Both transient per TRACE-08 (high-frequency derivable signals; events-table bloat unjustified — `pino` logs carry the same observability for these signals).

`MAESTRO_AGGREGATE_ID = ceb331df-a288-5be5-b801-cbdfc4deec4a` is the v5 UUID derived from `'maestro'` under the URL namespace (RFC 4122 §4.3) — reserved for future module-wide telemetry. Currently unused by the 2 events above (they always carry a specific `deviceId` as `aggregateId`).

## Events Consumed

| Name             | Source        | Action                                                                         |
|------------------|---------------|--------------------------------------------------------------------------------|
| `device.booted`  | `pool` module | Run `DeviceInfoCollector.collect`, mutate `Device.metadata`, emit `maestro.device-info.collected` |

Subscription deferred to `fastify.addHook('onReady', ...)` per Pitfall 2 (Phase 23 inheritance) — `fastify.poolModule.bus` is decorated by the pool plugin at registration step ~7, but the maestro plugin runs at step ~14; deferral keeps the wiring agnostic to plugin-order shifts.

## Queue Produced

None.

## Queue Consumed

None. Maestro is a no-queue module (matches Phase 22 streaming).

## Invariants

1. **Cross-module subscription is deferred to `onReady`** — never registered in plugin body. `fastify.poolModule.bus` may not exist at maestro plugin registration time; reading it during `onReady` is the only safe pattern.
2. **`device.booted` handler swallows `DeviceInfoCollector` errors** — logs `warn`; never re-throws. Subscriber failures must not propagate (Phase 21 invariant inheritance — the bus must not become a vector for cross-module crashes).
3. **`Device.metadata` mutation happens BEFORE the `maestro.device-info.collected` emission** — subscribers see the mutated device-state when they consume the new event. Without this ordering, a downstream consumer reading `fastify.pool.getDevice(id).metadata` post-event could observe stale state.
4. **`shutdown` is idempotent** — closes Appium sessions + unsubscribes; double-call is safe (no throws, no double-close).
5. **No producer outside the maestro module may directly call `hierarchyService.getHierarchy` / `appiumService.createSession` / `deviceInfoCollector.collect`** — all calls go through decorators (`fastify.maestroModule.*` or back-compat shorthand). Internal-imports from `server/maestro/internal/**` are forbidden structurally by the dep-cruiser rule.

## Non-Goals

- **Test rewrite to tests-as-spec style** (DEFERRED-24-A). Phase 30 Test Migration Cleanup owns the rewrite of `hierarchy-service.spec.ts` + `appium-service.spec.ts` beyond the Plan 24-05 `.test → .spec` rename.
- **persistEnvelope consolidation** (DEFERRED-24-B — 8TH SAMPLE POINT). The 10-line `persistEnvelope` middleware in `internal/module.ts` is the 8th verbatim copy across hooks/lifecycle/reporting/pool/artifacts/streaming/jobs/maestro. Phase 27+ extracts to `server/bus/persist-envelope.ts`. Do NOT consolidate here — scope creep.
- **Appium driver queue-managed lifecycle** (DEFERRED-24-C). `AppiumService` spawns/tears down drivers on demand inside HTTP routes today. A future phase may move Appium driver lifecycle behind a pg-boss queue with explicit ownership transfer + driver pooling. Phase 24 retains the on-demand surface verbatim.
- **`hookExecutor.execute('device.booted', ...)` loop in `server/index.ts:167-191` RETAINED.** Different surface — `hookExecutor` is the user-facing shell-hooks trigger system; the bus subscription Phase 24 introduces is the metadata-refresh substrate. RESEARCH §Anti-Patterns explicitly preserves this loop. Future hooks→bus migration may consolidate (Phase 27+). `lifecycle-ownership.spec` test (e) asserts the loop is still present (guard against accidental deletion).
- **Cross-module `causationId` thread on subscriber-side re-emit** (DEFERRED-24-D). The `device.booted` subscriber receives a payload (not envelope), so the `maestro.device-info.collected` re-emit carries its own `correlationId` from ALS but does not explicitly set `causationId = pool-envelope.id`. Phase 27+ envelope-aware emit helpers will close this gap.

## Dependencies

Plugin dependencies (declared in `server/maestro/plugin.ts`): 4 entries.

- `config` — for `AppiumService` server URL + session timeout
- `db` — for `persistEnvelope` middleware (currently short-circuits on `persisted:false` for both events; kept for symmetry + future-proofing per RESEARCH §Plugin Dependencies)
- `event-bus` — substrate convention; `createEventHelpers` + ALS reads
- `pool-plugin` — to read `fastify.poolModule.bus` in `registerSubscribers` (`onReady`)

Module dependencies (consumed via fastify decorators in the factory):

- `fastify.pool` — `getDevice(id)` and `getDeviceMap()` for metadata cache mutation
- `fastify.poolModule.bus` — subscribe to `device.booted`
- `fastify.config` — Appium server URL + session timeout
- `fastify.db` — `persistEnvelope` writes (no-op for transient events)
- `fastify.log` — child logger named `'maestro'` (MOD-07)

Plugin name `'maestro-plugin'` PRESERVED for back-compat with `plugin-order.spec` + any dependency-array references (RESEARCH §Open Question 3).

## Runnable Example

```typescript
// Subscribe to maestro.device-info.collected from any module:
import type { FastifyInstance } from 'fastify';

export function watchDeviceInfo(fastify: FastifyInstance) {
  fastify.addHook('onReady', async () => {
    const maestroBus = fastify.maestroModule.bus;
    maestroBus.on('maestro.device-info.collected', (payload) => {
      fastify.log.info(
        { deviceId: payload.deviceId, model: payload.model, os: payload.osVersion },
        'Device metadata collected',
      );
    });
  });
}

// Example fired event (envelope on the bus):
// {
//   "type": "maestro.device-info.collected",
//   "v": 1,
//   "ts": "2026-05-08T19:47:12.138Z",
//   "correlationId": "7f4c3e90-2c8f-47c1-9c8a-3d3c8f7e4a12",
//   "aggregateType": "maestro",
//   "aggregateId": "...deviceId...",
//   "payload": { "deviceId": "...", "osVersion": "14", "model": "Pixel 6" }
// }
```

References to RESEARCH pitfalls: Pitfall 2 (`onReady` deferral). See `.planning/phases/24-maestro-module/24-RESEARCH.md`.
