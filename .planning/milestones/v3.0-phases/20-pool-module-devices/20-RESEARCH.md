# Phase 20: Pool Module (Devices) - Research

**Researched:** 2026-04-21
**Domain:** Fastify plugin refactor, pg-boss lifecycle ownership, event emission at state-machine boundaries, module conventions MOD-01..06
**Confidence:** HIGH (codebase references verbatim; three prior module migrations — hooks / lifecycle / reporting — as precedent; zero external-library research required)

---

## Summary

Phase 20 is the fourth v3.0 module migration (after hooks/lifecycle/reporting). Unlike those three — which were *scheduled producers* (lifecycle) or *queue consumers* (hooks, reporting) — pool is an **imperative state machine with recurring background work** (health-checker every 30s, reaper every 60s) whose ownership lives wrongly in `server/index.ts:151-216`. Phase 20 moves that ownership into the pool plugin body, makes `VALID_TRANSITIONS`-gated transitions emit typed `device.*` envelopes via a new `server/pool/events.ts`, and ships MOD-01..06 artifacts mirroring Phase 19 exactly (`MODULE.md` + `index.ts` barrel + `events.ts` + `queue.ts` + `internal/module.ts` factory + thin plugin rewire + tests-as-spec).

The architectural template is **Phase 18 lifecycle** (ownership of a recurring concern + graceful shutdown + singleton-aggregate events), NOT Phase 19 reporting (which centers on a retry/DLQ queue; pool has neither). Queue usage in pool is deliberately minimal: `DEVICE_REAP` replaces the raw `setInterval` via `boss.schedule('device.reap', '* * * * *', …)` with `singletonKey` to prevent overlap (matches lifecycle exactly). `DEVICE_BOOT` is declared as a queue-name constant reserved for future on-demand boot but is NOT registered as a pg-boss queue in Phase 20 (zero-consumer queues trip pg-boss's "Queue not found" on first send; register in Phase 23 when jobs keystone consumes it).

The cross-module wiring story is: pool is **a publisher only**. `jobs`, `maestro`, `hooks` already have deep imports into `server/pool/*.ts` today; Phase 20 does NOT rewire them (that's Phase 21/23/24 scope per CONTEXT.md deferred). What Phase 20 DOES deliver is the event emission surface (`device.state.changed` / `device.allocated` / `device.released` / `device.health.failed`) so those downstream phases have something to subscribe to via `fastify.bus.on(...)` or `fastify.onPersisted(...)`.

**Primary recommendation:** Copy Phase 19 reporting's plan structure (7 plans, 73min total) with pool-specific adjustments: add a dedicated "health-checker + reaper ownership migration" plan since Phase 19 had no equivalent (reporting owned no `server/index.ts` startup code). Keep all Android/iOS driver files untouched (out of CONTEXT scope). Use singleton UUID `POOL_AGGREGATE_ID` for health-checker/reaper emissions where there's no single device; use `deviceId` as `aggregateId` for per-device events.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

From CONTEXT §domain (Phase Boundary) — these are structural MUST-haves, not discretion:

1. `VALID_TRANSITIONS`-gated state changes (`Device.transition`) fire `device.state.changed` envelopes with `{deviceId, from, to, correlationId}`; `PoolManager.acquire` / `release` publish `device.allocated` and `device.released`; `HealthChecker` on-failure publishes `device.health.failed`.
2. `server/index.ts` stops starting `healthChecker` + the process reaper directly; `pool` owns both via `registerWorkersAndSubscribers` (or equivalent lifecycle hook called from the pool plugin body).
3. `websocket` plugin declares `pool` as a Fastify dependency; the device-preview handler reaches pool state only through the public barrel (`server/pool/index.ts`), not deep imports.
4. Pool module fully migrated: `server/pool/MODULE.md` (9 fixed H2 sections + runnable example), `server/pool/index.ts` barrel, `server/pool/events.ts` (Zod schemas + emit helpers + event-name constants + registry), `server/pool/queue.ts` (`device.boot` + `device.reap` queues via Phase 18 wrapper), `server/pool/internal/module.ts` factory, tests-as-spec `*.spec.ts` files; each state-machine invariant documented in MODULE.md has a matching test.
5. Nyquist delta ≤ −2pp vs Phase 15 baseline (48.29% lines); `npm run dep-check` clean for pool/internal/*; downstream (`jobs`, `maestro`, `hooks`) consume `device.*` events via `fastify.bus.on(...)` — no deep imports of `server/pool/*` internals from NEW code (existing deep imports are Phase 21/23/24 scope, OUT OF SCOPE).

### Claude's Discretion

All implementation choices at Claude's discretion — pure infrastructure phase. References:

- **Phase 16 (`server/hooks/`)** — canonical MOD-01..06 pattern (MODULE.md shape, barrel re-export via `internal/module.js`, events.ts Zod + emit helpers, factory).
- **Phase 18 (`server/lifecycle/`)** — reference for a module that (a) owns a scheduled/recurring concern (health check = lifecycle's compression/retention analogue), (b) emits via the same persistEnvelope pattern, (c) graceful-shuts via `onClose`.
- **Phase 19 (`server/reporting/`)** — reference for a module that subscribes to bus events AND emits terminal events (pattern for `device.health.failed`).
- **Phase 15 substrate**: `server/queue/plugin.ts` `send()` wrapper, `server/bus/helpers.ts`, `server/events/` persistence, `server/correlation/` ALS.
- **Phase 17 pipeline**: Zod→OpenAPI for any new routes (none strictly required; device preview WS uses existing ws-schemas).

### Deferred Ideas (OUT OF SCOPE)

- `device.booted` metadata consumer side (Maestro hierarchy / device-info subscriber) — Phase 24 scope.
- `device.*` webhook fan-out (reporting subscriber for device events) — downstream; current reporting subscribes only to `job.completed`.
- Android/iOS driver internal refactor (kebab-case, schema extraction) — out of scope; drivers stay as-is unless incidental to events wiring.
- `jobs` and `artifacts` consumer rewiring to read `device.*` from bus — Phase 21/23 scope.
- Consolidating duplicated `persistEnvelope` across hooks/lifecycle/reporting/pool (4th sample point reached in this phase) — Phase 27+.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| (none direct) | Module-level refactor covered by MOD-01..MOD-09 established in Phase 16 | This phase does not close new REQ IDs; it satisfies ROADMAP §Phase 20 Success Criteria 1–4 directly. Module conventions inherited from Phase 16 pilot (hooks). |
| MOD-01 | MODULE.md with 9 fixed sections | Template: `server/reporting/MODULE.md` (114 lines, Phase 19 canonical). See §Plan Decomposition / §Code Examples. |
| MOD-02 | Public barrel + dep-cruiser enforcement | Template: `server/reporting/index.ts` (75 lines, 1-line internal/ re-export). Rule: `no-deep-imports-into-pool-internal` (see §Dep-Cruiser Rule). |
| MOD-03 | `events.ts` with Zod schemas + emit helpers + event-name constants | Template: `server/reporting/events.ts` (132 lines, 4 events + registry). See §Events Surface Design. |
| MOD-06 | Factory `createPoolModule(deps)` returning module surface | Template: `server/reporting/internal/module.ts`. See §Factory Design. |
| MOD-08 | Invariants listed in MODULE.md; 1 test per invariant | See §Invariants Enumeration — 7 invariants proposed. |
| QUEUE-06 | `queue.ts` colocated per module | Template: `server/lifecycle/queue.ts`. See §Queue Semantics. |
</phase_requirements>

---

## Standard Stack

No new dependencies. All substrate already installed.

### Core (already installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pg-boss` | `^12.15.0` | Queue + scheduler for `device.reap` (via `fastify.queue.schedule`). | Project pillar (ADR-001). |
| `@fastify/request-context` | `^6.2.1` | ALS for correlationId propagation from `emit` helpers to envelope. | Project standard since Phase 15. |
| `fastify-plugin` | latest | `fp(...)` wrapper with `{name, dependencies}`. | All v3.0 plugins. |
| `zod` | `^4.3.6` | Schema validation for `events.ts` + `schemas.ts` payloads. | SPEC-01/03. |
| `async-mutex` | latest | `PoolManager.allocateMutex` + per-device `Device.mutex` — **UNCHANGED**, already in code. | Existing allocation serialisation (device.ts:23, pool-manager.ts:17). |
| `pino` | — | `logger.child({module: 'pool'})` per MOD-07. | Project standard. |
| `drizzle-orm` | 0.45.x | `db.insert(events)` from persistEnvelope (already imported by reporting/lifecycle/hooks). | Project standard. |

### Supporting (NOT changed by Phase 20)

| Library | Version | Status | Note |
|---------|---------|--------|------|
| `@device-stream/android` | file: workspace | UNCHANGED | Driver implementation; pool consumes interface only. |
| `@device-stream/ios-simulator` | file: workspace | UNCHANGED | Driver implementation; pool consumes interface only. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Phase 18-style `registerWorkersAndSubscribers` | Inline registration in `poolPlugin()` body | Breaks MOD-06 factory symmetry with hooks/lifecycle/reporting. Use the factory. |
| `emit device.state.changed` inside `Device.transition()` | Emit from caller (PoolManager methods) | `Device` is a plain class (EventEmitter), no bus access. Keep domain event emit at the caller; `Device` fires local `'stateChange'` EventEmitter event (unchanged) AND returns `{from, to}` so caller emits the typed domain event. See §Emission Points. |
| Three separate health events (`device.health.failed.zombie`, `.timeout`, `.maxRetries`) | Single `device.health.failed` with `reason` field | Thin-payload rule (EVENTS-04). Single event with discriminator. |
| Register `device.boot` queue even without consumer | Defer until Phase 23 jobs keystone consumes it | pg-boss does not require a worker before `createQueue`, BUT declaring an unused queue adds operational noise and costs a queue-name slot. **Defer registration** but still export the QUEUE_NAMES constant for forward-compat. See §Queue Semantics. |

**Installation:**
```bash
# Zero new npm installs — all deps already in package.json
```

---

## Architecture Patterns

### Recommended Project Structure (post-Phase-20)

```
server/pool/
├── MODULE.md                     # MOD-01 (NEW, ~120 lines)
├── index.ts                      # MOD-02 barrel (NEW, ~60 lines)
├── plugin.ts                     # MODIFIED: thin wirer (~55 lines, was 48)
├── events.ts                     # MOD-03 (NEW, ~150 lines)
├── queue.ts                      # QUEUE-06 (NEW, ~80 lines)
├── schemas.ts                    # UNCHANGED (Phase 17 SPEC-06)
├── ws-schemas.ts                 # UNCHANGED (Phase 17 SPEC-07)
├── types.ts                      # UNCHANGED (DeviceDriver interface)
├── device.ts                     # MODIFIED: transition() returns {from,to}
├── pool-manager.ts               # MODIFIED: emits device.* on transitions
├── health-checker.ts             # MODIFIED: emits device.health.failed
├── process-tracker.ts            # UNCHANGED (reaper moves to module lifecycle)
├── zombie-detector.ts            # UNCHANGED
├── device-info-collector.ts      # UNCHANGED
├── internal/
│   └── module.ts                 # MOD-06 factory (NEW, ~180 lines)
├── android/                      # UNCHANGED (driver impl)
├── ios/                          # UNCHANGED (driver impl)
└── __tests__/
    ├── device-state.spec.ts      # RENAMED from .test.ts + extended
    ├── allocation.spec.ts        # RENAMED from .test.ts + extended
    ├── health-checker.spec.ts    # RENAMED from .test.ts + extended
    ├── process-tracker.spec.ts   # RENAMED from .test.ts
    ├── zombie-detector.spec.ts   # RENAMED from .test.ts
    ├── cleanup.spec.ts           # RENAMED from .test.ts
    ├── events.spec.ts            # NEW (MOD-03 registry + emit helpers)
    ├── module.spec.ts            # NEW (MOD-06 factory shape + idempotency)
    └── lifecycle-ownership.spec.ts  # NEW (healthChecker + reaper start/stop on onClose)
```

### Pattern 1: Factory + thin plugin wirer

Every v3.0 module follows this shape. Copy `server/reporting/plugin.ts` (71 lines) verbatim with s/reporting/pool/ substitutions.

**What:** `createPoolModule(deps)` constructs the module; `poolPlugin(fastify)` wires it into Fastify.
**When to use:** Every module. Phase 16 canonical, reinforced by Phases 18 + 19.
**Example:**
```typescript
// Source: server/reporting/plugin.ts:46-78 (Phase 19 canonical)
async function poolPlugin(fastify: FastifyInstance): Promise<void> {
  const config = fastify.config;
  const logger = fastify.log as unknown as pino.Logger;
  const processTracker = new ProcessTracker(logger);

  const module = createPoolModule({
    fastify,
    db: fastify.db,
    config,
    logger,
    processTracker,
  });

  // Register platform drivers (unchanged from current plugin.ts:26-31)
  if (config.pool.android.enabled) {
    module.pool.registerDriver('android', new DeviceStreamAndroidDriver(config.pool.android, logger));
  }
  if (config.pool.ios.enabled) {
    module.pool.registerDriver('ios', new DeviceStreamIosDriver());
  }

  fastify.decorate('pool', module.pool);
  fastify.decorate('processTracker', processTracker);
  fastify.decorate('healthChecker', module.healthChecker);
  fastify.decorate('poolModule', module);

  await module.registerWorkersAndSubscribers();  // starts healthChecker + reaper schedule

  fastify.addHook('onClose', async () => {
    await module.shutdown();
  });

  fastify.log.info('Pool plugin registered: healthChecker + reaper owned by module');
}

export default fp(poolPlugin, {
  name: 'pool-plugin',
  dependencies: ['config', 'db', 'queue', 'event-bus'],
});
```

### Pattern 2: Emit at caller, not inside `Device.transition`

**What:** Keep `Device` class pure — no bus/fastify awareness. Caller (PoolManager / HealthChecker) owns the domain-event emit after `device.transition(next)` succeeds.
**When to use:** When a domain entity is shared across modules or lives below the plugin layer.
**Example:**
```typescript
// Source: inspired by server/reporting/queue.ts:111-152 (emit-after-action pattern)
// NEW in server/pool/pool-manager.ts — allocate() after device.allocate() success:

async allocate(platform: Platform, jobId: string): Promise<DeviceInfo | null> {
  return this.allocateMutex.runExclusive(async () => {
    for (const [, device] of this.devices) {
      if (device.platform === platform && device.state === DeviceState.Idle) {
        try {
          const prevState = device.state;
          await device.allocate(jobId);  // throws on invalid transition
          // Emit AFTER state mutation succeeds (Pitfall: never emit before mutation)
          this.emit.stateChanged(device.id, { from: prevState, to: DeviceState.Allocated });
          this.emit.allocated(device.id, { deviceId: device.id, jobId, platform });
          this.logger.info({ deviceId: device.id, jobId, platform }, 'Device allocated');
          return device.toInfo();
        } catch (err: any) {
          this.logger.error({ deviceId: device.id, error: err.message }, 'Failed to allocate');
          continue;
        }
      }
    }
    return null;
  });
}
```

### Pattern 3: Device.transition returns `{from, to}` for caller emit

**What:** Keep the existing `EventEmitter`-style `emit('stateChange', {from, to})` on `Device` (it's used by tests and potentially by drivers); extend `transition()` to RETURN `{from, to}` so the caller has a single source of truth.
**When to use:** When you want to emit both a local class-level event AND a module-level domain event on the same transition.

```typescript
// MODIFIED server/pool/device.ts:43-51
transition(newState: DeviceState): { from: DeviceState; to: DeviceState } {
  const allowed = VALID_TRANSITIONS[this._state];
  if (!allowed.includes(newState)) {
    throw new InvalidTransitionError(this._state, newState);
  }
  const from = this._state;
  this._state = newState;
  this.emit('stateChange', { from, to: newState });   // unchanged: local EE event
  return { from, to: newState };                      // NEW: return for caller domain-emit
}
```

### Anti-Patterns to Avoid

- **Emitting BEFORE state mutation:** If `device.transition()` throws, we've lied about state. Always emit AFTER mutation succeeds. (Research REQ-01.)
- **Holding `allocateMutex` across domain-event emit:** `bus.emit` is synchronous but `persistEnvelope` fire-and-forgets a DB insert. Release mutex before any awaited work. See §Emission Points for exact ordering.
- **Deep-importing from `server/pool/internal/*`:** `no-deep-imports-into-pool-internal` dep-cruiser rule fails CI. See §Dep-Cruiser Rule.
- **Re-using the reaper's setInterval:** Move to `boss.schedule('device.reap', '* * * * *', …)` so the reaper runs on the pg-boss worker fiber with restored ALS and shares the graceful-shutdown drain path (QUEUE-07).
- **Registering `device.boot` queue without a consumer:** pg-boss's `createQueue` is fine but `queue.work(DEVICE_BOOT, …)` must exist to consume. Without a consumer, enqueued jobs sit stuck. Defer queue registration to Phase 23. Export the NAME constant.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cron-like 60s reaper loop | `setInterval(reapOrphans, 60_000)` (current code at `process-tracker.ts:198-204`) | `fastify.queue.schedule(DEVICE_REAP, '* * * * *', {}, {singletonKey: DEVICE_REAP})` + `fastify.queue.work(DEVICE_REAP, handler)` | Singleton protection, graceful drain, correlationId per fire (Phase 18 Option B). |
| 30s health-checker loop | `setInterval(checkAll, 30_000)` (current at `health-checker.ts:217-222`) | **Keep as `setInterval`** — health check is tight-loop ops work, not durable; pg-boss would add Postgres polling cost. Wrap start/stop in `registerWorkersAndSubscribers` / `shutdown` instead. | Durability isn't needed (health state is ephemeral); reducing external I/O is valuable. Phase 18 lifecycle has no analogue that does this. **Claude's recommendation: keep setInterval in HealthChecker; move ownership only.** |
| ALS correlationId propagation into emitted envelopes | Thread `correlationId` through PoolManager method params | `createEventHelpers` factory reads ALS via `asyncLocalStorage.getStore()` (server/bus/helpers.ts:79-108) | TRACE-04: never thread manually. |
| Singleton event aggregate UUID | Hard-code a literal UUID and hope | Use UUIDv5 derived from `'pool'` under RFC 4122 §4.3 URL namespace, matching Phase 18 `LIFECYCLE_AGGREGATE_ID` + Phase 19 `REPORTING_AGGREGATE_ID` patterns | Envelope schema requires valid UUID (envelope.ts:27). Singleton UUID makes event-table filtering by `aggregateType='pool'` + `aggregateId=POOL_AGGREGATE_ID` possible. |
| persistEnvelope middleware in module factory | Write from scratch | Copy verbatim from `server/reporting/internal/module.ts:85-118` (10-line block) | Fourth sample point — Phase 27+ consolidates. Stay consistent with hooks/lifecycle/reporting copies for consolidation PR to catch. |
| Event-name string literals | `bus.emit('device.allocated', ...)` everywhere | `DEVICE_EVENT_NAMES.ALLOCATED` constant object | Eslint `no-direct-bus-emit-outside-events-ts` rule + consolidation. |

**Key insight:** The hardest part of this phase is NOT the event emission — it's the health-checker + reaper lifecycle ownership migration. The current wiring at `server/index.ts:210+213+246+250` is FOUR distinct calls. Moving them to the pool module's lifecycle requires: (1) `registerWorkersAndSubscribers` calls `healthChecker.start(30_000)` + `boss.schedule(DEVICE_REAP, ...)`; (2) `shutdown` calls `healthChecker.stop()` + `boss.offWork(reaperWorkerId)` + `processTracker.stop()` (in onClose, not shutdown flow); (3) `server/index.ts` dead-code removal.

---

## Common Pitfalls

### Pitfall 1: Emission ordering with async-mutex

**What goes wrong:** Emit `device.allocated` inside `allocateMutex.runExclusive(...)`. `persistEnvelope` synchronously fires `<type>.envelope` for onPersisted subscribers. A subscriber that enqueues a pg-boss job (`fastify.queue.send`) awaits Postgres round-trip. Mutex held through the round-trip = serialized allocations across unrelated jobs.
**Why it happens:** `bus.emit` itself is synchronous (Node EE), BUT the persistEnvelope middleware fires on the same callstack, which in turn triggers onPersisted subscribers which can do async work. Any caller that awaits within the subscriber blocks the mutex.
**How to avoid:** Emit INSIDE the mutex (order matters — state must be consistent when subscribers see it). Subscribers MUST NOT be awaited on the emit path — they run via `ee.emit` (sync fire-and-forget). The persistEnvelope's `db.insert` is already `void (async () => {...})()` fire-and-forget. Risk is LOW in practice; document the rule in MODULE.md invariants: "Subscribers to device.* events must not block the emit call stack."
**Warning signs:** Allocation latency spikes under concurrent job submission; pg-boss send RPS drops below expected.

### Pitfall 2: `device.health.failed` state-transition timing

**What goes wrong:** HealthChecker detects unhealthy device, calls `device.transition(DeviceState.Error)`, then emits `device.health.failed`. If `transition()` throws (e.g., device already in Error — no Error→Error transition), we'd emit `device.health.failed` anyway, or skip it. Current code at `health-checker.ts:64-71` + `89-92` has inconsistent handling.
**Why it happens:** `VALID_TRANSITIONS[Error] = [Booting, Offline]` — so a second health check on a device already in Error state will throw. Current code wraps in `try/catch` but with inconsistent emit points.
**How to avoid:** Emit `device.health.failed` BEFORE attempting the state transition (or check current state first). Document: `device.health.failed` fires on EVERY health probe that returns unhealthy, regardless of whether the device's state actually changes. Make `device.state.changed` conditional on transition success.
**Warning signs:** Missing events for devices that get stuck in Error; duplicate events for devices that flip between health states.

### Pitfall 3: Reaper + allocation race

**What goes wrong:** Reaper scans orphans via `ps axo`, finds a PID matching a just-allocated device (transient race), kills it.
**Why it happens:** `ProcessTracker.scanOrphans()` filters by `trackedPids` Set, but the new device's PID is registered only AFTER `driver.boot()` returns. Allocation starts a boot via some future path (Phase 23), reaper wakes up between boot spawn and `processTracker.register(pid)`, scans, sees untracked qemu PID, kills it.
**How to avoid:** Current pool-manager.ts:82-99 registers PID BEFORE `device.transition(Idle)` — good pattern. Reaper's existing filter (`!trackedPids.has(pid) && !trackedPids.has(pgid)`) already guards this. Document the invariant: "`processTracker.register(pid)` MUST be called before the device transitions out of Booting." Test: add `process-tracker.spec.ts` assertion.
**Warning signs:** Spurious "Zombie emulator detected" logs for freshly-booted devices; boot failures immediately after replaceDevice().

### Pitfall 4: `device.booted` NOT emitted by Phase 20

**What goes wrong:** Reviewer expects `device.booted` because hooks plugin listens for it (hooks-plugin.ts:163-192 `app.hookExecutor.execute('device.booted', ...)`). Phase 20 doesn't wire this — CONTEXT.md explicitly defers to Phase 24 Maestro.
**Why it happens:** CONTEXT §Specifics says "`device.booted` (if emitted on boot completion for `maestro` Phase 24 consumer; otherwise defer)". Success Criterion 1 lists only `device.state.changed`, `device.allocated`, `device.released`, `device.health.failed`. `device.booted` is derivable from `state.changed {from: Booting, to: Idle}` — but NOT emitted as its own event in Phase 20.
**How to avoid:** Document the derivation rule in MODULE.md: "Consumers wanting `device.booted` semantics SHOULD subscribe to `device.state.changed` and filter `payload.from === 'booting' && payload.to === 'idle'`." Phase 24 may add `device.booted` as a convenience alias if the filter pattern proves painful.
**Warning signs:** Hooks-plugin's `device.booted` path in `server/index.ts:168-190` continues to work through Phase 20 via the existing imperative `app.hookExecutor.execute(...)` call; Phase 20 doesn't touch that code path.

### Pitfall 5: pg-boss queue registration order on boot

**What goes wrong:** `registerWorkersAndSubscribers` calls `boss.createQueue(DEVICE_REAP)` + `queue.schedule(DEVICE_REAP, ...)` + `queue.work(DEVICE_REAP, handler)`. If `createQueue` is called AFTER `schedule`, pg-boss throws "Queue device.reap not found" (lifecycle RESEARCH §Pitfall 2, reporting RESEARCH §Pitfall 2).
**Why it happens:** pg-boss v12 requires queue to exist before schedule/work/send.
**How to avoid:** Copy the order from `server/lifecycle/queue.ts:100-108`:
  1. `await fastify.boss.createQueue(DEVICE_REAP, queueOpts)`
  2. `await fastify.queue.schedule(DEVICE_REAP, '* * * * *', {}, {singletonKey: DEVICE_REAP})`
  3. `const workerId = await fastify.queue.work(DEVICE_REAP, handler)` → push to `workerIds`
**Warning signs:** "Queue device.reap not found" on server boot.

### Pitfall 6: ALS store shape drift

**What goes wrong:** New pool specs use `Map<string, unknown>` form (`asyncLocalStorage.run(new Map([['correlationId', cid]]), ...)`) — legacy pattern from Phase 15-era tests.
**Why it happens:** Copy-paste from old pool tests; some existing hooks/lifecycle specs still use the Map form.
**How to avoid:** CONTEXT.md §Specifics explicitly says "new pool specs must NOT use legacy Map form." Use canonical plain-object shape per Phase 19 `server/reporting/__tests__/correlation.spec.ts`:
```typescript
await asyncLocalStorage.run(
  { correlationId: cid, currentEventId: null, actor: 'test' } as never,
  async () => { /* test body */ },
);
```
**Warning signs:** Test passes locally but fails in CI with `correlationId: null` in envelope; `alsMixin` logs with null correlationId.

### Pitfall 7: Physical device detection timing

**What goes wrong:** `poolManager.detectPhysicalDevices()` is called inside `initPool()` (pool-manager.ts:64). If a physical device is detected AFTER initPool (user plugs in during session), it's never added. Phase 20 doesn't change this — but reviewer might expect events for hot-plug.
**Why it happens:** `detectPhysicalDevices` is a one-shot scan. No watcher.
**How to avoid:** Out of scope for Phase 20. Document in MODULE.md §Non-Goals. A future phase could add `device.detected` event + adb-watch loop.
**Warning signs:** None — existing behaviour preserved.

### Pitfall 8: fastify-zod-openapi v5 `required` emission bug

**What goes wrong:** Known pre-existing Phase 17/18/19 failing test (`server/__tests__/plugin-order.spec.ts`, `server/api/__tests__/routes.test.ts`, `server/api/__tests__/artifact-routes.test.ts`, `server/auth/__tests__/auth-plugin.test.ts`). STATE.md documents this as "fastify-zod-openapi v5 `required` emission bug, pool-plugin-order substring-match bug".
**Why it happens:** External library bug, Phase 17 Plan 17-01 left it pending.
**How to avoid:** Document in Phase 20 deferred-items.md exclusion set. Do NOT let it block Phase 20 Nyquist.
**Warning signs:** `npm test` shows 4 pre-existing failures; match them against the Phase 18/19 exclusion set.

### Pitfall 9: `fastify.pool` decorator back-compat

**What goes wrong:** Existing consumers (`server/api/routes.ts:332+342+348+351+434`, `server/jobs/plugin.ts:86`, `server/maestro/plugin.ts:56-57,76,198`, `server/hooks/plugin.ts:163`) all read `fastify.pool.getDevice(...)` / `.getDevices()` / `.getDeviceMap()` / `.getDriver(...)`. If the factory changes the decorator's surface, all of these break.
**Why it happens:** The pool plugin decorates `fastify.pool` with `PoolManager` instance today (plugin.ts:35). Factory pattern wraps PoolManager inside `module.pool` — decorate the same way.
**How to avoid:** The factory returns `{ pool: PoolManager, healthChecker: HealthChecker, emit, bus, registerWorkersAndSubscribers, shutdown }`. Plugin decorates `fastify.pool = module.pool` (same surface). All 7 existing call sites continue to work unchanged.
**Warning signs:** Typecheck errors across api/jobs/maestro/hooks if PoolManager's getDevice/getDeviceMap methods are renamed.

### Pitfall 10: Singleton UUID collision

**What goes wrong:** Pick a UUID for `POOL_AGGREGATE_ID` that happens to collide with a real deviceId.
**Why it happens:** DeviceIds are `randomUUID()`; collision chance is negligible but not zero.
**How to avoid:** Use the UUIDv5 pattern Phase 18/19 use — `LIFECYCLE_AGGREGATE_ID = 'a9c1a64b-f0c7-54fb-8153-d48ca3f6e97e'` (derived from `'lifecycle'` under URL namespace); `REPORTING_AGGREGATE_ID = 'bca46f4f-d5bd-5d65-bf73-0a59a7f3c6d7'` (from `'reporting'`). Derive `POOL_AGGREGATE_ID` from `'pool'` same way. UUIDv5 is deterministic and namespace-distinct from v4 randomUUID.
**Note:** For per-device events (`device.state.changed`, `.allocated`, `.released`), use `aggregateId = deviceId` (NOT POOL_AGGREGATE_ID). POOL_AGGREGATE_ID is ONLY for `device.health.failed` when the failure is not attributable to a single device, which is rare — in practice, every `device.health.failed` HAS a deviceId. Recommendation: **always use `aggregateId = deviceId` for `device.*` events**. POOL_AGGREGATE_ID may still be exported for future pool-wide telemetry events (e.g., `pool.initialized`).

---

## Code Examples

All verified against current repo.

### Example 1: events.ts registry (MOD-03)

```typescript
// NEW: server/pool/events.ts (mirrors server/reporting/events.ts:1-132)
import { z } from 'zod';

import { createEventHelpers } from '../bus/helpers.js';
import type { TypedBus } from '../bus/bus.js';
import type { EventRegistry } from '../bus/types.js';
import type { Envelope } from '../events/envelope.js';
import { deviceStateSchema, platformSchema } from './schemas.js';

export const POOL_EVENT_NAMES = {
  STATE_CHANGED:  'device.state.changed',
  ALLOCATED:      'device.allocated',
  RELEASED:       'device.released',
  HEALTH_FAILED:  'device.health.failed',
} as const;

export type PoolEventName = typeof POOL_EVENT_NAMES[keyof typeof POOL_EVENT_NAMES];

/** Singleton UUID for pool-wide telemetry (reserved; per-device events use deviceId). */
export const POOL_AGGREGATE_ID = '<UUIDv5 derived from "pool" under URL namespace>' as const;

// ---------- Payload schemas ----------

export const deviceStateChangedPayload = z.object({
  deviceId: z.string().uuid(),
  from: deviceStateSchema,
  to: deviceStateSchema,
});

export const deviceAllocatedPayload = z.object({
  deviceId: z.string().uuid(),
  jobId: z.string(),
  platform: platformSchema,
});

export const deviceReleasedPayload = z.object({
  deviceId: z.string().uuid(),
  jobId: z.string().nullable(),
  platform: platformSchema,
});

export const deviceHealthFailedPayload = z.object({
  deviceId: z.string().uuid(),
  platform: platformSchema,
  reason: z.enum(['unhealthy', 'zombie', 'max-retries', 'timeout']),
  failureCount: z.number().int().nonnegative(),
  willReplace: z.boolean(),      // true if replacement boot triggered
  lastError: z.string().nullable(),
});

// ---------- Registry ----------
//
// Persisted policy per TRACE-08:
//   state.changed: NOT persisted (high-frequency; pg-boss-like bloat)
//   allocated/released: NOT persisted (derivable from state.changed)
//   health.failed: persisted (operational telemetry; low freq + debug value)

export const poolRegistry = {
  [POOL_EVENT_NAMES.STATE_CHANGED]: { schema: deviceStateChangedPayload, persisted: false, aggregateType: 'pool' },
  [POOL_EVENT_NAMES.ALLOCATED]:     { schema: deviceAllocatedPayload,    persisted: false, aggregateType: 'pool' },
  [POOL_EVENT_NAMES.RELEASED]:      { schema: deviceReleasedPayload,     persisted: false, aggregateType: 'pool' },
  [POOL_EVENT_NAMES.HEALTH_FAILED]: { schema: deviceHealthFailedPayload, persisted: true,  aggregateType: 'pool' },
} as const satisfies EventRegistry;

export type PoolRegistry = typeof poolRegistry;

export function makePoolEmitters(
  bus: TypedBus<PoolRegistry>,
  onEmit?: (envelope: Envelope) => void,
) {
  const emit = createEventHelpers(bus, onEmit);
  return {
    stateChanged:  emit(POOL_EVENT_NAMES.STATE_CHANGED),
    allocated:     emit(POOL_EVENT_NAMES.ALLOCATED),
    released:      emit(POOL_EVENT_NAMES.RELEASED),
    healthFailed:  emit(POOL_EVENT_NAMES.HEALTH_FAILED),
  };
}

export type PoolEmitters = ReturnType<typeof makePoolEmitters>;
```

### Example 2: queue.ts with device.reap (QUEUE-06)

```typescript
// NEW: server/pool/queue.ts (mirrors server/lifecycle/queue.ts:1-221)
import type pino from 'pino';
import type { FastifyInstance } from 'fastify';

import { QUEUE_NAMES } from '../queue/names.js';
import type { ProcessTracker } from './process-tracker.js';

export const DEVICE_REAP_QUEUE_NAME = QUEUE_NAMES.DEVICE_REAP;
export const DEVICE_BOOT_QUEUE_NAME = QUEUE_NAMES.DEVICE_BOOT;  // reserved; not registered in Phase 20

export const REAP_CRON = '* * * * *';  // every minute (was setInterval 60_000)

export interface RegisterPoolQueuesDeps {
  fastify: FastifyInstance;
  processTracker: ProcessTracker;
  logger: pino.Logger;
}

export interface PoolQueueRegistration {
  workerIds: string[];
}

export async function registerPoolQueues(deps: RegisterPoolQueuesDeps): Promise<PoolQueueRegistration> {
  const { fastify, processTracker, logger } = deps;
  const workerIds: string[] = [];

  // device.reap — recurring orphan-process cleanup
  await fastify.boss.createQueue(DEVICE_REAP_QUEUE_NAME, {
    policy: 'stately',
    retryLimit: 1,
    retryBackoff: true,
    retryDelay: 30,
  } as never);

  await fastify.queue.schedule(
    DEVICE_REAP_QUEUE_NAME,
    REAP_CRON,
    {} as never,
    { singletonKey: DEVICE_REAP_QUEUE_NAME },
  );

  const reapWorkerId = await fastify.queue.work<unknown>(
    DEVICE_REAP_QUEUE_NAME,
    async (_payload, jobId) => {
      const log = logger.child({ queue: DEVICE_REAP_QUEUE_NAME, jobId });
      try {
        await processTracker.reapOrphans();
      } catch (err) {
        log.error({ err }, 'Reaper fire failed');
        throw err;
      }
    },
  );
  workerIds.push(reapWorkerId);

  logger.info({ reapWorkerId, queues: [DEVICE_REAP_QUEUE_NAME] }, 'Pool schedules + workers registered');
  return { workerIds };
}
```

### Example 3: internal/module.ts factory (MOD-06)

```typescript
// NEW: server/pool/internal/module.ts (~180 lines, mirrors reporting/internal/module.ts)
// Abbreviated; see §Factory Design for full signature.

export interface CreatePoolModuleDeps {
  fastify: FastifyInstance;
  db: Database;
  config: AppConfig;
  logger: pino.Logger;
  processTracker: ProcessTracker;
}

export interface PoolModule {
  pool: PoolManager;
  healthChecker: HealthChecker;
  emit: PoolEmitters;
  bus: TypedBus<PoolRegistry>;
  registerWorkersAndSubscribers: () => Promise<void>;  // start health-checker + reaper schedule
  shutdown: () => Promise<void>;                        // stop both + offWork
}

export function createPoolModule(deps: CreatePoolModuleDeps): PoolModule {
  const logger = deps.logger.child({ module: 'pool' });
  const bus = new TypedBus(poolRegistry);
  const persistEnvelope = makePersistEnvelope({ db: deps.db, bus, logger });
  const emit = makePoolEmitters(bus, persistEnvelope);

  const pool = new PoolManager(deps.config, deps.processTracker, logger, emit);  // emit injected
  const healthChecker = new HealthChecker(pool, deps.processTracker, logger, emit);  // emit injected

  let workerIds: string[] = [];
  let stopped = false;

  return {
    pool,
    healthChecker,
    emit,
    bus,
    registerWorkersAndSubscribers: async () => {
      // Start health checker (30s interval — setInterval, NOT pg-boss)
      healthChecker.start(30_000);
      // Register reaper schedule via pg-boss
      const registration = await registerPoolQueues({
        fastify: deps.fastify,
        processTracker: deps.processTracker,
        logger,
      });
      workerIds = registration.workerIds;
      logger.info({ workerIds }, 'Pool module workers+subscribers registered');
    },
    shutdown: async () => {
      if (stopped) return;
      stopped = true;
      healthChecker.stop();
      for (const id of workerIds) {
        try { await deps.fastify.boss.offWork(id); }
        catch (err) { logger.warn({ err, workerId: id }, 'offWork failed'); }
      }
      workerIds = [];
      // pool.shutdown() is called from server/index.ts shutdown(), NOT here —
      // pool.shutdown() kills emulator processes which must drain BEFORE app.close().
      // Keep pool.shutdown invocation imperative in server/index.ts for now;
      // module shutdown only owns healthChecker + reaper stop. Defer full pool.shutdown
      // migration to a follow-up or document the split in MODULE.md Non-Goals.
      logger.info('Pool module shutdown complete');
    },
  };
}
```

### Example 4: dep-cruiser rule addition

```javascript
// MODIFIED: .dependency-cruiser.cjs — add 4th forbidden rule mirroring reporting
{
  name: 'no-deep-imports-into-pool-internal',
  comment:
    'Nothing outside server/pool/** may reach into server/pool/internal/**. ' +
    'Public API comes from server/pool/index.ts barrel. Phase 20 MOD-02. ' +
    'Mirrors Phase 16 hooks + Phase 18 lifecycle + Phase 19 reporting rules.',
  severity: 'error',
  from: {
    pathNot: '^server/pool/',
  },
  to: {
    path: '^server/pool/internal/',
  },
},
```

---

## Emission Points — Exact File:Line Answers

### Question 1 answer: Where does each event fire?

| Event | Fires from | Current line | Ordering rule |
|-------|-----------|--------------|---------------|
| `device.state.changed` | Caller of `device.transition(next)`, AFTER success | `pool-manager.ts:39,101,181,224,238,306` (6 transition call sites) + `device.ts:55,61` (via device.allocate/release) + `health-checker.ts:65,90,92,141-144,153,163,191,193` (13 sites) | Emit AFTER `transition()` returns. `transition()` modified to return `{from, to}` for single source of truth. |
| `device.allocated` | `pool-manager.ts:205-207` — inside `allocateMutex.runExclusive` callback, AFTER `await device.allocate(jobId)` succeeds | line 205 | Emit INSIDE mutex, after state mutation. Payload: `{deviceId, jobId, platform}`. |
| `device.released` | `pool-manager.ts:249` — after `device.release()` returns | line 249 | Emit AFTER `release()` returns (Cleanup → Idle succeeded). Payload: `{deviceId, jobId: null, platform}`. Note: jobId captured before `release()` clears it. |
| `device.health.failed` | `health-checker.ts:64-71` (Running→Error path), `75-82` (zombie path), `89-97` (max-retries path) | 3 emission sites in health-checker | Emit on EVERY failed probe, with `reason` discriminator (`unhealthy`, `zombie`, `max-retries`, `timeout`). Persisted=true. |

**Atomicity with `allocateMutex`:** The existing mutex in `pool-manager.ts:17` wraps the entire allocate() body. Emitting `device.allocated` inside the mutex is SAFE — subscribers fire via `ee.emit` (sync fanout) and `persistEnvelope` fire-and-forgets the DB write. No subscriber should block the mutex. Document in MODULE.md invariant (g).

**Atomicity with per-device mutex (`device.ts:36`):** `device.allocate(jobId)` itself is wrapped in `device.mutex.runExclusive(...)`. This mutex only serializes concurrent `allocate()` calls on the SAME device instance — the outer pool-level mutex already prevents concurrent allocates across devices. Emit happens in PoolManager AFTER the per-device allocate resolves, so the device mutex is released before emit. Safe.

---

## Health-Checker Ownership Migration — Question 2 Answer

### Current `server/index.ts` wiring (verified against current file)

| Line | Call | Purpose |
|------|------|---------|
| 210 | `app.healthChecker.start(30000)` | 30s interval health probe loop |
| 211 | `app.log.info('Health checker started (30s interval)')` | Log |
| 214 | `app.processTracker.startReaper(60000)` | 60s orphan scan/reap interval |
| 215 | `app.log.info('Process reaper started (60s interval)')` | Log |
| 246 | `app.healthChecker.stop()` | Graceful shutdown — clearInterval |
| 247 | `app.log.info('Health checker stopped')` | Log |
| 250 | `app.processTracker.stop()` | Graceful shutdown — clearInterval |
| 251 | `app.log.info('Process reaper stopped')` | Log |

### Migration plan (exact diff shape)

**server/index.ts AFTER Phase 20:**
- Lines 210-215 deleted (4 lines of wiring + 4 lines of logs).
- Lines 246-251 deleted (same — shutdown half).
- The `onReady` hook still exists for `app.pool.initPool()` + device.booted hook firing + DB sync (lines 164-207). These stay — they are NOT Phase 20 scope (DB-sync is Phase 23+, device.booted hook is Phase 24+).

**server/pool/plugin.ts AFTER Phase 20:** Calls `module.registerWorkersAndSubscribers()` which does:
  ```typescript
  healthChecker.start(30_000);                   // was server/index.ts:210
  await registerPoolQueues({...});                // starts boss.schedule(DEVICE_REAP, '* * * * *', ...) — replaces setInterval in process-tracker.startReaper
  ```

**server/pool/internal/module.ts `shutdown()` AFTER Phase 20:** Called from `fastify.onClose`:
  ```typescript
  healthChecker.stop();                          // was server/index.ts:246
  for (const id of workerIds) await fastify.boss.offWork(id);   // drains reaper worker
  ```

**process-tracker.ts migration:** `startReaper(intervalMs)` + `stop()` methods REMOVED (their bodies migrate to queue.ts worker handler). Public methods kept: `register`, `unregister`, `killProcess`, `killAll`, `reapOrphans`, `scanOrphans`, `getTrackedPids`. This is a breaking API change — but ProcessTracker is pool-internal (not exported from barrel), so no external consumer breaks. Current `server/artifacts/recording-service.ts:11` imports `ProcessTracker` type — remove that import path and switch to `import type { ProcessTracker } from '../pool/index.js'` once barrel exports the type.

### Test impact

- `server/pool/__tests__/process-tracker.test.ts` may test `startReaper`/`stop` — migrate to test the queue.ts factory instead.
- `server/pool/__tests__/health-checker.test.ts` lines 66-67 (`checker.stop()` in afterEach) — UNCHANGED; healthChecker keeps setInterval.
- NEW `server/pool/__tests__/lifecycle-ownership.spec.ts`: assert (a) factory start wires healthChecker + reaper schedule, (b) shutdown stops both, (c) server/index.ts no longer references healthChecker or startReaper (grep-based assertion in plugin-order.spec.ts).

---

## Device Preview Handler Barrel Compliance — Question 3 Answer

### Current state (grep-verified)

- `server/websocket/` directory exists but contains **only `__tests__/`** — no source files.
- The device-preview handler lives in `server/streaming/device-preview.ts` + `server/streaming/websocket-plugin.ts`.
- `server/streaming/websocket-plugin.ts:174` already declares `dependencies: ['config', 'auth', 'pool-plugin']` (Phase 17 Plan 17-07 added this).
- `server/streaming/device-preview.ts` does NOT import anything from `server/pool/*` directly. It takes a logger and manages its own `DevicePreviewManager`.
- **The "deep import" concern in CONTEXT §integration-points is historic** — Phase 17 already fixed the dep-graph declaration. Phase 20 just has to maintain the discipline.

### What the barrel needs to expose for websocket/streaming

Currently `server/streaming/*` does NOT import from `server/pool/*` at all (grep verified: no matches for `from.*pool/` in `server/streaming/**`). The "device preview" concern is self-contained in streaming.

**However**, the barrel MUST expose:
- `PoolManager` type (for `fastify.pool: PoolManager` declaration in `server/pool/plugin.ts:12`)
- `HealthChecker` type (for `fastify.healthChecker` decorator type)
- `ProcessTracker` type (for back-compat with `server/artifacts/recording-service.ts:11`)
- `DeviceInfoCollector` class (for `server/maestro/plugin.ts:22`)
- `poolPlugin` default (for `server/index.ts:3`)
- `createPoolModule` + `PoolModule` + `CreatePoolModuleDeps` types (MOD-06)
- `POOL_EVENT_NAMES`, `POOL_AGGREGATE_ID`, `makePoolEmitters`, 4 payload schemas, `poolRegistry`, `PoolRegistry`, `PoolEmitters`, `PoolEventName` (MOD-03)
- `DEVICE_REAP_QUEUE_NAME`, `DEVICE_BOOT_QUEUE_NAME`, `registerPoolQueues` (QUEUE-06)
- Existing schemas: `deviceListSchema`, `deviceSummarySchema`, `deviceStateSchema`, `platformSchema`, `deviceMetadataSchema` (already consumed via `server/api/routes.ts:13`)
- `DeviceState` enum? — NO, this lives in `server/types/index.ts` which is a global-types file, not pool-internal. Keep it there; consumers import from `../types/index.js`.

### No additional Fastify `dependencies` needed

`server/streaming/websocket-plugin.ts:174` already has `pool-plugin` as dep. `server/jobs/plugin.ts:120` has `pool-plugin`. `server/artifacts/artifact-plugin.ts:57` has `pool-plugin`. `server/maestro/plugin.ts:353` has `pool-plugin`. All good — the dep-graph is correct.

---

## Queue Semantics — Question 4 Answer

### Decision matrix

| Queue | Register in Phase 20? | Consumer | Rationale |
|-------|----------------------|----------|-----------|
| `device.reap` (QUEUE_NAMES.DEVICE_REAP = `'device.reap'`) | **YES** | `registerPoolQueues` factory (this phase) | Replaces `processTracker.startReaper(60000)` raw setInterval. Exercises `boss.schedule` pattern. `singletonKey: 'device.reap'` + `policy: 'stately'` prevents overlap if a reap cycle runs long (pg-boss drops the duplicate). |
| `device.boot` (QUEUE_NAMES.DEVICE_BOOT = `'device.boot'`) | **NO** — name constant only | Future Phase 23 jobs keystone (on-demand device boot) | (a) Current code boots synchronously in `initPool()` (pool-manager.ts:49-109) — no queue needed. (b) Registering a queue without a consumer traps jobs. (c) Exporting the NAME constant gives Phase 23 a forward-compat hook without Phase 20 risk. **Recommendation:** Add `DEVICE_BOOT: 'device.boot'` to `QUEUE_NAMES` in `server/queue/names.ts` + export `DEVICE_BOOT_QUEUE_NAME` from `server/pool/queue.ts`, but do NOT call `createQueue` / `schedule` / `work` for it in Phase 20. |

### Rationale against option (c) "use singletonKey for double-boot prevention"

Success Criterion 3 in ROADMAP mentions both queues, but CONTEXT §specifics clarifies: "`DEVICE_BOOT = 'device.boot'`, `DEVICE_REAP = 'device.reap'`" — it names the CONSTANTS, not the registered queues. QUEUE-03 (the singletonKey REQ — "`job.execute` and `recording.upload` usam `singletonKey`") is Phase 23 scope per REQUIREMENTS.md Traceability table. Phase 20 is NOT chartered to close QUEUE-03. Registering `device.boot` in Phase 20 with singletonKey defers to Phase 23 is no-op plumbing.

### What Phase 20 ships for queues

- `QUEUE_NAMES.DEVICE_REAP = 'device.reap'` + `QUEUE_NAMES.DEVICE_BOOT = 'device.boot'` added to `server/queue/names.ts`.
- `server/pool/queue.ts` exports `DEVICE_REAP_QUEUE_NAME` + `DEVICE_BOOT_QUEUE_NAME` aliases + `REAP_CRON = '* * * * *'` + `registerPoolQueues(deps)` factory.
- `registerPoolQueues` registers ONLY `device.reap` (createQueue + schedule + work). `device.boot` is a NAME export only, NO runtime registration. Document in MODULE.md Queue Produced section: "`device.boot` is a reserved queue name for Phase 23 on-demand boot; not registered in Phase 20."

---

## Pattern Validation vs Phase 18 Lifecycle — Question 5 Answer

Phase 18's `createLifecycleModule(deps)` is the closest architectural analogue. Exact mapping:

| Phase 18 lifecycle | Phase 20 pool | Difference |
|--------------------|---------------|------------|
| `CreateLifecycleModuleDeps: {fastify, db, config, logger}` | `CreatePoolModuleDeps: {fastify, db, config, logger, processTracker}` | pool injects `ProcessTracker` (the reaper consumer). |
| `LifecycleModule: {stats, emit, bus, registerSchedulesAndWorkers, shutdown}` | `PoolModule: {pool, healthChecker, emit, bus, registerWorkersAndSubscribers, shutdown}` | pool exposes class instances via module surface (MUST for plugin decorator back-compat — Pitfall 9). |
| `registerSchedulesAndWorkers` registers 3 pg-boss schedules | `registerWorkersAndSubscribers` starts 1 setInterval + registers 1 pg-boss schedule | pool has mixed-timing ownership (in-process 30s + pg-boss 1min). |
| `shutdown` `offWork`s 3 worker ids | `shutdown` calls `healthChecker.stop()` + `offWork`s 1 reaper worker id | Same idempotent-stopped pattern. |
| `stats` decorator (back-compat with `/health` endpoint) | No analogue — pool doesn't have a stats decorator | — |
| `persistEnvelope` 10-line duplicate | Same 10-line duplicate (4th sample point — Phase 27+ consolidation trigger) | Identical. |

Phase 18's `module.registerSchedulesAndWorkers` source:
```typescript
// server/lifecycle/internal/module.ts:112-126
registerSchedulesAndWorkers: async () => {
  const registration = await registerLifecycleSchedulesAndWorkers({
    fastify: deps.fastify,
    db: deps.db,
    config: deps.config,
    emit,
    stats,
    logger,
  });
  workerIds = registration.workerIds;
  logger.info({ workerIds, queueCount: workerIds.length }, 'Lifecycle schedules and workers registered');
},
```

Phase 20's `module.registerWorkersAndSubscribers` will look:
```typescript
registerWorkersAndSubscribers: async () => {
  healthChecker.start(30_000);
  const registration = await registerPoolQueues({
    fastify: deps.fastify,
    processTracker: deps.processTracker,
    logger,
  });
  workerIds = registration.workerIds;
  logger.info({ workerIds, healthCheckerRunning: true }, 'Pool workers and subscribers registered');
},
```

---

## Invariants Enumeration — Question 6 Answer

Each invariant → 1 test per MOD-08. Seven proposed (vs lifecycle's 5 + reporting's 6):

| # | Invariant | Source | Test target |
|---|-----------|--------|-------------|
| **(a)** | Only `VALID_TRANSITIONS`-allowed state changes succeed; disallowed throws `InvalidTransitionError` | `server/types/index.ts:41-49` + `server/pool/device.ts:43-51` | `__tests__/device-state.spec.ts` — extend current tests to assert every non-allowed pair throws. |
| **(b)** | Every successful transition emits exactly one `device.state.changed` envelope with `{deviceId, from, to, correlationId}` | `pool-manager.ts` (new emit call) + all 6 transition call sites | `__tests__/events.spec.ts` — spy on bus.on('device.state.changed'), trigger each allowed transition, assert exactly 1 envelope per transition. |
| **(c)** | `pool.allocate()` is mutex-protected; concurrent calls for the same platform produce EXACTLY 1 allocation + EXACTLY 1 `device.allocated` envelope | `pool-manager.ts:200` + existing test `__tests__/allocation.test.ts:98-116` | `__tests__/allocation.spec.ts` — extend existing concurrency test to assert envelope count. |
| **(d)** | `device.health.failed` emission → device transitions to `Error` (non-zombie) or `Offline` (zombie/max-retries) | `health-checker.ts:64-71, 75-82, 89-97` | `__tests__/health-checker.spec.ts` — extend to assert envelope emit + state post-emission for each reason enum. |
| **(e)** | Reaper never kills a PID registered to an allocated device | `process-tracker.ts:115-161` — `!trackedPids.has(pid) && !trackedPids.has(pgid)` filter | `__tests__/process-tracker.spec.ts` — seed trackedPids with allocated-device pid, assert reapOrphans skips it. |
| **(f)** | `processTracker.register(pid)` called BEFORE device transitions out of `Booting` | `pool-manager.ts:98-101` (register before transition) | `__tests__/allocation.spec.ts` — spy on register + transition, assert call order via `mockOrder`. |
| **(g)** | Pool module `shutdown` is idempotent; second call is no-op | `internal/module.ts` `stopped` flag | `__tests__/module.spec.ts` — call shutdown() twice, assert second call doesn't `offWork` or `healthChecker.stop()` again. |

Optional 8th if scope allows:
| **(h)** | Pool module factory returns STABLE references across calls — `module.pool === module.pool` (same instance for plugin decorator lifetime) | `internal/module.ts` construction | `__tests__/module.spec.ts`. |

---

## Nyquist + dep-cruiser — Question 7 Answer

### Baseline

- Phase 15 baseline: 48.29% lines coverage (`.planning/nyquist-baseline.json`).
- Phase 19 close: 56.48% lines (+8.19pp above baseline — very healthy).
- Budget: delta ≥ −2pp (same as Phase 16/18/19). Running room: 56.48% current → 46.29% floor → ~10pp room. Phase 20 can land comfortably.

### Files Phase 20 touches (coverage impact assessment)

| File | Lines (approx) | Current coverage? | Phase 20 change | Coverage delta risk |
|------|---------------|-------------------|-----------------|---------------------|
| `server/pool/device.ts` | 80 | HIGH (device-state.test has 8 tests hitting most lines) | Signature tweak `transition()` returns `{from,to}` | Very low |
| `server/pool/pool-manager.ts` | 336 | MEDIUM (allocation.test hits main paths, physical-device + replaceDevice are cold) | +6 emit call sites | Low |
| `server/pool/health-checker.ts` | 234 | MEDIUM (health-checker.test covers happy path) | +3 emit call sites | Low (adds tested lines via events.spec) |
| `server/pool/process-tracker.ts` | 212 | MEDIUM | Remove `startReaper`/`stop` (coverage lost on removal); net neutral | Low |
| `server/pool/events.ts` (NEW) | 150 | N/A | Created with tests-as-spec `events.spec.ts` | Positive (+1.5pp est.) |
| `server/pool/queue.ts` (NEW) | 80 | N/A | Created with tests-as-spec | Neutral-positive |
| `server/pool/internal/module.ts` (NEW) | 180 | N/A | Created with tests-as-spec `module.spec.ts` | Positive (+1pp est.) |
| `server/pool/plugin.ts` | 48 → ~55 | UNCOVERED (plugin body rarely tested) | Thin wirer | Neutral |
| `server/pool/MODULE.md` + `index.ts` | N/A | N/A | Docs + barrel (excluded from coverage) | None |

**Net expected delta:** +1 to +3pp (similar to Phase 19's +8.19pp arc). Well within the −2pp budget.

### dep-cruiser rule (exact addition)

Append to `.dependency-cruiser.cjs` `forbidden` array after reporting rule (line 64), BEFORE `no-direct-bus-emit-outside-events-ts`:

```javascript
{
  name: 'no-deep-imports-into-pool-internal',
  comment:
    'Nothing outside server/pool/** may reach into server/pool/internal/**. ' +
    'Public API comes from server/pool/index.ts barrel. Phase 20 MOD-02. ' +
    'Mirrors Phase 16 hooks + Phase 18 lifecycle + Phase 19 reporting rules — ' +
    'see RESEARCH §Open Question Q5 (copy-paste reporting rule + s/reporting/pool/).',
  severity: 'error',
  from: {
    pathNot: '^server/pool/',
  },
  to: {
    path: '^server/pool/internal/',
  },
},
```

Add corresponding dep-cruiser fixture in `__fixtures__/dep-cruiser/bad-pool-deep-import.ts` and extend `dep-cruiser.spec.ts` — mirror Phase 19 Plan 19-00 Task 0.4 exactly.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 3.x (server), go test (CLI — not touched this phase) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run server/pool/__tests__/` |
| Full suite command | `npm test` |
| Estimated runtime | ~5s quick (all pool specs are mock-based, no DB) / ~90s full |

### Phase Requirements → Test Map

Each ROADMAP success criterion → concrete verifier:

| SC | Behavior | Test Type | Automated Command | File Exists? |
|----|----------|-----------|-------------------|-------------|
| **SC1** | Every allowed transition in `VALID_TRANSITIONS` fires `device.state.changed` | unit+integration | `npx vitest run server/pool/__tests__/events.spec.ts` | ❌ Wave 0 (NEW) |
| **SC1** | `acquire`/`release` publish `device.allocated`/`device.released` | unit | `npx vitest run server/pool/__tests__/allocation.spec.ts -t "device.allocated"` | ❌ Wave 0 (rename+extend) |
| **SC1** | Health failures publish `device.health.failed` | unit | `npx vitest run server/pool/__tests__/health-checker.spec.ts -t "device.health.failed"` | ❌ Wave 0 (rename+extend) |
| **SC2** | `server/index.ts` no longer starts health checker or reaper | grep (integration-test via plugin-order.spec extension) | `grep -n "healthChecker.start\|startReaper" server/index.ts` returns 0 matches | ❌ plugin-order.spec.ts extension |
| **SC2** | `pool` plugin owns both | test | `npx vitest run server/pool/__tests__/lifecycle-ownership.spec.ts` | ❌ Wave 0 (NEW) |
| **SC2** | `websocket` declares `pool` as dep | code-inspection (plugin-order.spec covers) | Existing assertion at `server/__tests__/plugin-order.spec.ts:61` | ✅ |
| **SC2** | Device preview handler reaches pool only via barrel | dep-cruiser | `npm run dep-check` (rule `no-deep-imports-into-pool-internal`) | ❌ Wave 0 (rule add) |
| **SC3** | Pool module fully migrated — MODULE.md 9 sections | code-inspection (phase-close verify script) | Ad-hoc grep of `server/pool/MODULE.md` H2 headings | ❌ (MODULE.md NEW) |
| **SC3** | `events.ts` + `queue.ts` + factory + barrel exist | code-inspection + unit | `npx vitest run server/pool/__tests__/module.spec.ts` + `events.spec.ts` | ❌ Wave 0 (all NEW) |
| **SC3** | State-machine invariants each have a test | test (7 invariants above) | `npx vitest run server/pool/__tests__/ -t "\\[Invariant"` | ❌ (extend existing + new) |
| **SC3** | No hybrid state in `main` | code-inspection | `grep -n "app.healthChecker.start\|app.processTracker.startReaper" server/index.ts` returns 0 | ❌ plugin-order.spec assertion |
| **SC4** | Nyquist passes; coverage delta ≤ −2pp | tool-run | `npm run nyquist:capture && npm run nyquist:check` exits 0 | ✅ (scripts exist) |
| **SC4** | Downstream consumers can reach `device.*` via bus | code-inspection | NEW `subscription.spec.ts` — subscribe to each event, trigger, assert receive | ❌ (optional — Phase 21/23/24 will exercise at consume time) |

### Sampling Rate

- **Per task commit:** `npx vitest run server/pool/__tests__/`
- **Per wave merge:** `npm test` (full)
- **Phase gate:** Full suite green before `/gsd:verify-work` + `npm run nyquist:check`

### Wave 0 Gaps

These must be scaffolded BEFORE Wave 1 implementation plans land:

- [ ] `server/queue/names.ts` extended with `DEVICE_BOOT` + `DEVICE_REAP` constants (plan 20-00 Task 0.1)
- [ ] `.dependency-cruiser.cjs` + `no-deep-imports-into-pool-internal` rule (plan 20-00 Task 0.2)
- [ ] `__fixtures__/dep-cruiser/bad-pool-deep-import.ts` fixture + `dep-cruiser.spec.ts` extension (plan 20-00 Task 0.2)
- [ ] Skeleton `server/pool/internal/module.ts` stub (plan 20-00 Task 0.3) — body lands in Wave 1
- [ ] Rename 6 existing `server/pool/__tests__/*.test.ts` → `*.spec.ts` via `git mv` (plan 20-05 close-out — match Phase 19 pattern)
- [ ] NEW test files in scope (5 specs authored across Wave 1/2):
  - `server/pool/__tests__/events.spec.ts` — MOD-03 registry + emit shape
  - `server/pool/__tests__/module.spec.ts` — MOD-06 factory shape + idempotent shutdown
  - `server/pool/__tests__/lifecycle-ownership.spec.ts` — healthChecker + reaper migration
  - Optional: `server/pool/__tests__/subscription.spec.ts` — prove downstream `bus.on('device.*')` receives envelopes

*(Framework install not needed — vitest already configured.)*

---

## Plan Decomposition Suggestion — Question 10 Answer

Target 7 plans mirroring Phase 19's 73min arc. Pool has slightly more moving pieces (healthChecker migration is unique), so estimate +10-15min.

| Plan | Wave | Depends | Est. | Scope |
|------|------|---------|------|-------|
| **20-00** | 0 | — | 12min | Wave 0 substrate: QUEUE_NAMES extension, dep-cruiser rule + fixture, MODULE.md + index.ts + events.ts + internal/module.ts stubs, frontmatter on 20-VALIDATION. Matches 19-00 (13min). |
| **20-01** | 1 | 20-00 | 10min | `events.ts` full body (MOD-03): registry + emit helpers + 4 payload schemas + POOL_AGGREGATE_ID UUIDv5 + `events.spec.ts`. Matches 19-01 (12min). |
| **20-02** | 1 | 20-00 | 12min | `device.ts` + `pool-manager.ts` + `health-checker.ts` modifications to emit events at the 12 call sites listed in §Emission Points. Extend `device-state.test.ts` → `device-state.spec.ts` with envelope assertions for invariants (a)(b). Parallel with 20-01 since events.ts has no direct dependency on pool-manager edits. Matches Phase 19 parallelism. |
| **20-03** | 2 | 20-01, 20-02 | 15min | `createPoolModule` factory + thin plugin.ts rewire + `queue.ts` with `registerPoolQueues`. Delete server/index.ts lines 210-215 + 246-251. Add `module.spec.ts` + `lifecycle-ownership.spec.ts`. Matches 19-03 (9min + more scope = 15min). |
| **20-04** | 2 | 20-03 | 8min | DB-gated integration spec: subscription proof — `bus.on('device.*', handler)` receives envelope with correct payload shape for each event type. ALS-canonical-shape spec (plain-object form per CONTEXT.md §specifics). Matches 19-04 (6min). |
| **20-05** | 3 | 20-03, 20-04 | 10min | MODULE.md (~130 lines, 9 fixed sections) + extend barrel to full surface + rename 6 `.test.ts` → `.spec.ts` via `git mv`. Nyquist capture + `check` gate. Matches 19-06 (7min). |
| **20-06** | 3 | 20-05 | 5min | Phase close: plugin-order.spec additive assertions (3-4: server/index.ts no longer references healthChecker.start/startReaper; pool-plugin dependencies set correctly), deferred-items.md for fastify-zod-openapi v5 + pool-plugin substring bugs (inherited exclusion), final cleanups. Matches 19-05 post-renumber (17min → 5min since less HTTP surface). |

**Total estimate:** 72min (vs 73min for Phase 19). Parallel execution (20-01 || 20-02) + (20-04 parallel with 20-03 tail) keeps critical path ≤45min.

Alternative: fold 20-04 into 20-03 (-1 plan, -5min) if parallelism is already maxed. 6 plans total.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `server/index.ts` owns healthChecker + reaper setIntervals | Module-owned lifecycle via `registerWorkersAndSubscribers` + `shutdown` | This phase | `server/index.ts` Phase 20 delete 8 lines; back-compat decorators preserved. |
| Raw `setInterval` reaper | `boss.schedule('device.reap', '* * * * *', ...)` | This phase | Correlation-ID per fire, singleton dedup, graceful drain. |
| No typed device.* events | 4 typed events via `makePoolEmitters` | This phase | Downstream modules can subscribe via bus. |
| `persistEnvelope` copied 3× (hooks, lifecycle, reporting) | 4× (add pool) | This phase | Phase 27+ consolidation trigger reached. |
| `.test.ts` file naming | `.spec.ts` (MOD-04) | This phase (renames) | Blame preserved via `git mv` 100% similarity. |

**Deprecated/outdated:**
- `ProcessTracker.startReaper(intervalMs)` method — body migrates to queue.ts worker handler; method removed.
- `ProcessTracker.stop()` method (the reaper-specific half) — same migration.
- Direct `app.healthChecker.start(30000)` in `server/index.ts:210` — moved to module factory.
- Direct `app.processTracker.startReaper(60000)` in `server/index.ts:214` — replaced by pg-boss schedule.

---

## Open Questions

1. **Should `pool.shutdown()` move into module.shutdown() too?**
   - What we know: `pool.shutdown()` kills all emulator processes. Currently called from `server/index.ts:279` imperatively BEFORE `app.close()`.
   - What's unclear: If we move it into `fastify.onClose`, it fires in reverse-plugin-registration order AFTER jobs/webhooks complete. That matches graceful-shutdown semantics but subtly changes timing — current flow waits for running jobs (line 257-272) before `pool.shutdown()`. If pool.shutdown fires via onClose, it runs AFTER `app.jobService.shutdown()` — might be fine but is a behaviour change.
   - Recommendation: **DEFER.** Phase 20 moves healthChecker + reaper ownership only. `pool.shutdown()` stays imperative in `server/index.ts` with a `TODO(Phase 23 jobs keystone)` comment. Document as Non-Goal in MODULE.md.

2. **`device.booted` event — emit it or not?**
   - What we know: CONTEXT §specifics says "`device.booted` (if emitted on boot completion for `maestro` Phase 24 consumer; otherwise defer)". Current `server/index.ts:168-190` imperatively fires `app.hookExecutor.execute('device.booted', ...)` — this is the HOOK execution path, not the bus.
   - What's unclear: If Phase 20 adds `device.booted` to the registry, hooks can switch from imperative executor to bus subscribe, simplifying Phase 24.
   - Recommendation: **Emit `device.booted`** as a 5th event. Cost is minimal (1 schema + 1 emit site in `pool-manager.ts:101` after initial boot + in `replaceDevice` after replacement boot). Consumers who want boot semantics can subscribe directly instead of filtering `state.changed`. This is a judgment call — if Phase 20 scope feels tight, defer.

3. **`device.shutdown` event?**
   - What we know: Hooks listen for `device.shutdown` (MODULE.md `Events Consumed` deferred section).
   - What's unclear: Current `pool.shutdown()` doesn't emit anything per-device.
   - Recommendation: **DEFER** to Phase 24 Maestro (same cluster as `device.booted` consumer-side rewiring).

4. **Persist `device.state.changed` events?**
   - What we know: Phase 20 marks them NOT persisted to avoid events-table bloat. But Phase 27+ trace-tree UI may want them.
   - What's unclear: Volume: ~6 transitions per job × many jobs = high write rate.
   - Recommendation: **NOT persisted in Phase 20.** Document rationale in MODULE.md Events Emitted. If Phase 27 needs them, change the registry flag — no schema change.

5. **Register `device.boot` queue or not?**
   - What we know: Phase 20 CONTEXT §specifics names both constants. REQUIREMENTS.md Traceability shows QUEUE-03 (singletonKey for job.execute / recording.upload) is Phase 23 scope.
   - Resolved in §Queue Semantics: **Export NAME constant only, do NOT register the queue in Phase 20.** Leave createQueue to Phase 23.

---

## Sources

### Primary (HIGH confidence — verbatim code references)

- `server/pool/pool-manager.ts` (current body, lines 14-336)
- `server/pool/device.ts` (current body, lines 1-80)
- `server/pool/health-checker.ts` (current body, lines 1-235)
- `server/pool/process-tracker.ts` (current body, lines 1-213)
- `server/pool/zombie-detector.ts` (current body, lines 1-117)
- `server/pool/plugin.ts` (current body, lines 1-48)
- `server/pool/schemas.ts` + `ws-schemas.ts` + `types.ts` (current bodies, unchanged)
- `server/types/index.ts` (VALID_TRANSITIONS at lines 41-49)
- `server/index.ts` (lines 114-216 pool wiring + 218-311 shutdown flow)
- `server/lifecycle/internal/module.ts` (Phase 18 canonical factory, lines 1-142)
- `server/lifecycle/plugin.ts` (Phase 18 thin wirer, lines 1-60)
- `server/lifecycle/events.ts` (Phase 18 registry, lines 1-123)
- `server/lifecycle/queue.ts` (Phase 18 schedule factory, lines 1-222)
- `server/lifecycle/MODULE.md` (Phase 18 canonical docs)
- `server/reporting/internal/module.ts` (Phase 19 canonical factory, lines 1-265)
- `server/reporting/plugin.ts` (Phase 19 thin wirer, lines 1-79)
- `server/reporting/events.ts` (Phase 19 registry, lines 1-132)
- `server/reporting/queue.ts` (Phase 19 worker+DLQ factory, lines 1-209)
- `server/reporting/MODULE.md` (Phase 19 canonical docs)
- `server/reporting/index.ts` (Phase 19 canonical barrel, lines 1-76)
- `server/hooks/MODULE.md` (Phase 16 canonical)
- `server/hooks/index.ts` (Phase 16 barrel)
- `server/hooks/internal/module.ts` (Phase 16 factory, lines 1-149)
- `server/queue/names.ts` (QUEUE_NAMES registry, lines 1-53)
- `server/queue/plugin.ts` (send/work/schedule wrapper, lines 1-244)
- `server/bus/plugin.ts` (TypedBus + onPersisted + persistEnvelope, lines 1-151)
- `server/bus/helpers.ts` (createEventHelpers, lines 1-115)
- `server/events/envelope.ts` (envelope schema, lines 1-33)
- `server/correlation/plugin.ts` (ALS store defaultStoreValues, lines 1-58)
- `.dependency-cruiser.cjs` (current forbidden rules, lines 1-99)
- `.planning/REQUIREMENTS.md` (MOD-01..MOD-10 + Traceability table)
- `.planning/STATE.md` (cumulative metrics, Phase 18/19 runtime data)
- `.planning/nyquist-baseline.json` (48.29% lines baseline)
- `.planning/phases/18-lifecycle-migration-node-cron-pg-boss/18-RESEARCH.md` (Phase 18 research template)
- `.planning/phases/19-reporting-migration-webhooks-dlq/19-CONTEXT.md` (Phase 19 context precedent)
- `.planning/phases/19-reporting-migration-webhooks-dlq/19-VALIDATION.md` (validation template)
- `.planning/phases/19-reporting-migration-webhooks-dlq/19-06-PLAN.md` (Phase 19 close-out plan frontmatter)
- `.planning/config.json` (workflow.nyquist_validation: true)

### Secondary (MEDIUM confidence)

- Phase 18 RESEARCH.md §pg-boss Schedule API (lines 136-190) — verified by source reading of installed pg-boss 12.15.0 types.

### Tertiary (LOW confidence)

- None. All claims cross-verified against current repo + committed Phase 15-19 artifacts.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps; all substrate committed and exercised in 3 prior migrations.
- Architecture patterns: HIGH — Phase 18 + 19 are direct analogues; ~80% code is copy-paste-with-s/reporting/pool/.
- Pitfalls: HIGH — pitfalls 1, 5, 6, 8 are cross-referenced from prior phase RESEARCH; 2, 3, 4, 7, 9, 10 derived from current pool code inspection.
- Invariants: HIGH — enumerated from existing VALID_TRANSITIONS + mutex code + reaper filter + STATE.md evidence.
- Plan decomposition: HIGH — mirrors Phase 19's 7-plan, 73min arc with one adjustment (+healthChecker migration plan).
- Queue semantics: MEDIUM — Phase 20 scope-confined decision to defer `device.boot` registration is a judgment call; Phase 23 review may revisit.

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 (30 days — stable; substrate frozen)
