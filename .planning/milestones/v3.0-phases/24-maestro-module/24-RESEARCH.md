# Phase 24: Maestro Module — Research

**Researched:** 2026-05-08
**Domain:** Module migration to canonical MOD-01..09 shape + cross-module pool extension (`device.booted` 5th event) + DeviceInfoCollector relocation + bus-driven device-metadata refresh
**Confidence:** HIGH (all decisions are template-driven from Phase 16-23 closes; only domain-specific call-outs are the 5th pool event emission site and the DeviceInfoCollector cross-module relocation)

## Summary

Phase 24 is the smallest module migration of v3.0: 3 services (HierarchyService, AppiumService, DeviceInfoCollector), 2 transient events (`maestro.hierarchy.fetched`, `maestro.device-info.collected`), and 1 cross-module pool extension (`device.booted` joining the existing 4-event poolRegistry). The Phase 16-23 template (MODULE.md + barrel + events.ts + internal/ + factory + thin plugin + tests-as-spec + dep-cruiser N-th rule + plugin-order.spec extension + .test→.spec renames) applies verbatim — all wave shapes, persistEnvelope sample-point bookkeeping, onReady cross-module subscription pattern, and Nyquist gate budgets are reused without deviation.

Two domain-specific findings drive the plan:

1. **`device.booted` is currently a `HookEvent`, not a bus event.** The string `'device.booted'` already exists in `server/hooks/schemas.ts` as one of four `HookEvent` literal-union members (`device.booted | device.shutdown | test.before | test.after`). The current "boot completion" signal is the imperative loop in `server/index.ts:151-189` (inside `app.addHook('onReady')`), which iterates `app.pool.getDevices()` and calls `app.hookExecutor.execute('device.booted', ...)` per idle device. This is the call site that must die in 24-03. The bus event added to `poolRegistry` is named identically (`device.booted`) but lives in a separate namespace (`pool` aggregateType, hooks consume their own typed hook-event union — no name collision because the bus and the hook executor are different surfaces).

2. **`PoolManager.initPool()` is the canonical boot-completion site.** Current `device.state.changed` emissions fire at `Booting → Idle` transitions in three locations: `pool-manager.ts:62` (addDevice), `pool-manager.ts:126` (initPool inner loop, AFTER successful boot or already-healthy detection), `pool-manager.ts:207` (detectPhysicalDevices), and `pool-manager.ts:366` (replaceDevice). All four are the legitimate emission sites for `device.booted` since each represents a Booting→Idle that signals "device is now usable." A 5th emission site (HealthChecker recovery from Error→Idle) is OUT of scope per Phase 20 invariants — health.failed is the recovery channel. **Primary recommendation:** emit `device.booted` from PoolManager AFTER each `transition(DeviceState.Idle)` at the 4 sites above, exactly mirroring the `device.state.changed` emission shape (RESEARCH §Pitfall 2 from Phase 20 still applies — emit AFTER mutation success).

**Primary recommendation:** Mirror Phase 22 streaming substrate-first 5-6 plan shape (smallest no-queue module). Wave 0 substrate (events stub + 8th dep-cruiser rule + pool device.booted entry placeholder), Wave 1 events body (2 maestro events + pool device.booted body), Wave 2 emission wiring + DeviceInfoCollector git-mv, Wave 3 createMaestroModule factory + thin plugin + subscriber, Wave 4 DB-gated subscriber + correlation specs, Wave 5 phase close. ~50min total per Phase 22/23 tempo.

## User Constraints

(See CONTEXT.md for the full text — copied verbatim per downstream-consumer protocol.)

### Locked Decisions

- **Module shape:** Restructure `server/maestro/` into the canonical MODULE.md + barrel index.ts + events.ts + internal/ + tests-as-spec + `createMaestroModule(deps)` shape.
- **Event emission triggers:** Move device-metadata refresh from imperative onReady wiring in `server/index.ts` (and any route-level ad-hoc calls) onto a `device.booted` bus subscription.
- **Service relocation:** HierarchyService (server/maestro/hierarchy-service.ts), AppiumService (server/maestro/appium-service.ts), and DeviceInfoCollector (server/pool/device-info-collector.ts) all move behind the maestro barrel via `git mv` (preserve blame).
- **Pool 5th event:** Pool gets `device.booted` added (currently absent — verified by grep on `server/pool/events.ts`). 4 events → 5 events; emitted from PoolManager state machine at the Booting→Idle transition.
- **2 maestro events:** `maestro.hierarchy.fetched`, `maestro.device-info.collected`. Both transient/derivable (persisted:false per TRACE-08 — high-frequency, derivable from logs); aggregateType:'maestro'.
- **Subscriber wiring:** Maestro subscribes to `device.booted` via `fastify.addHook('onReady', ...)` (Phase 23 Pitfall 5 — cross-module bus subscriptions defer to onReady).
- **dep-cruiser:** 8th rule `no-deep-imports-into-maestro-internal` + fixture file.
- **plugin-order.spec:** additive block (Phase 20-23 pattern).
- **Renames:** `.test.ts → .spec.ts` for the 2 existing test files (`appium-service.test.ts`, `hierarchy-service.test.ts`).
- **Out of scope:** route-file refactors (api/routes/*.ts) — only ensure no route file reaches into maestro/internal/. Route handlers may still call maestro decorators (`fastify.maestroModule.fetchHierarchy(...)`) — that is the public surface.
- **Test extraction beyond rename:** waits for Phase 30 Test Migration Cleanup.
- **Wave structure:** 5-6 plans mirroring Phase 22/23 substrate-first pattern.
- **Nyquist gate:** -2pp budget.

### Claude's Discretion

- All implementation choices follow the locked Phase 16-23 template:
  - MODULE.md: 9 H2 sections in canonical order + Runnable Example.
  - index.ts barrel: MOD-02 strict 1-line internal/ re-export with inline `type` modifier.
  - internal/: holds `module.ts` (factory), `hierarchy-service.ts` + `appium-service.ts` + `device-info-collector.ts` (relocated), `subscribers.ts`.
  - events.ts: 2 events, both transient (persisted:false per TRACE-08); aggregateType:'maestro'.
  - queue.ts: omitted or comment-only (maestro owns no pg-boss queues — same shape as Phase 22 streaming).
  - plugin.ts: thin Fastify plugin; dependencies array determined by what services need (likely `['config','db','event-bus','pool-plugin']`).
  - Pool extension: add `device.booted` to POOL_EVENT_NAMES + poolRegistry as transient event (similar shape to existing `device.allocated`). Emit from pool's state machine where the booting→idle transition is signalled.
  - DeviceInfoCollector relocation: `git mv server/pool/device-info-collector.ts server/maestro/internal/device-info-collector.ts` to preserve blame; update imports in pool/ and elsewhere.
  - Tests-as-spec: `appium-service.test.ts` + `hierarchy-service.test.ts` → `.spec.ts` rename; new specs for events, module factory, subscriber chain (DB-gated for the device.booted → fetch round-trip), correlation, lifecycle-ownership grep-guards.

### Deferred Ideas (OUT OF SCOPE)

- **DEFERRED-24-A: Maestro test rewrite to tests-as-spec style** — Phase 30 Test Migration Cleanup owns the rewrite of hierarchy-service.spec.ts + appium-service.spec.ts beyond the .test→.spec rename (matches Phase 22 deferral pattern).
- **DEFERRED-24-B: persistEnvelope 8th sample point** — maestro module factory will repeat the 10-line persistEnvelope block (8th copy after hooks/lifecycle/reporting/pool/artifacts/streaming/jobs). Phase 27+ extracts to shared helper.
- **DEFERRED-24-C: Appium driver lifecycle ownership** — AppiumService spawns/tears down drivers on demand; Phase 24 keeps that surface intact. A future phase may move Appium driver lifecycle behind queue-managed sessions.

## Phase Requirements

No direct phase requirements (REQUIREMENTS.md has zero MOD/EVENTS/QUEUE/TRACE keys mapped to Phase 24). The module-level refactor is covered by MOD-01..MOD-09 conventions established by Phase 15-16 and re-applied verbatim across Phases 18-23. There is no per-requirement traceability matrix to populate.

## Standard Stack

### Core (zero new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| fastify | already pinned | Plugin host for `createMaestroModule` factory + thin plugin wirer | Substrate plugin shape locked since Phase 15 |
| zod | already pinned | Payload schemas for the 2 maestro events + pool device.booted addition | SPEC-01..03 colocated schemas |
| drizzle-orm | already pinned | persistEnvelope writes to `events` table (only fires for persisted:true entries — neither maestro event persists) | Phase 16+ pattern |
| pino | already pinned | `logger.child({ module: 'maestro' })` per MOD-07 | Substrate convention |
| @fastify/request-context | already pinned | ALS for correlationId in subscriber-side ALS reads | Phase 22 streaming subscriber pattern |
| dependency-cruiser | already pinned | 8th forbidden rule `no-deep-imports-into-maestro-internal` | MOD-02 enforcement |

### Supporting (Phase 16-23 substrate already provides)

| Library / Module | Version | Purpose | When to Use |
|------------------|---------|---------|-------------|
| `server/bus/helpers.ts` `createEventHelpers` | substrate | Wraps TypedBus.emit + envelope stamping (ALS correlationId) + onEmit side-channel | All maestro emit helpers route through this |
| `server/bus/bus.ts` `TypedBus` | substrate | Per-module event bus instance | One per module (maestroBus) |
| `server/queue/plugin.ts` `fastify.queue.send` | substrate | NOT used in this phase (no queue surface) | Maestro owns no queues — `queue.ts` omitted/comment-only |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Bus-driven device-metadata refresh | Imperative onReady loop (current state) | Cross-module imperative coupling — exactly what Phase 24 deletes per CONTEXT.md decisions |
| Single combined `maestro.metadata.collected` event | 2 separate `maestro.hierarchy.fetched` + `maestro.device-info.collected` | CONTEXT.md locked — 2 events. Hierarchy fetch is on-demand HTTP route trigger; device-info collection is boot-time bus-trigger; semantically different lifecycles. |
| Promote `device-info-collector.ts` to its own pool/maestro-shared package | git mv into `server/maestro/internal/` | Locked decision: it's a maestro concern (uses adb getprop / xcrun simctl — Maestro-style metadata, not device lifecycle state). |

**Installation:**
```bash
# No new dependencies. All required libraries ship with substrate.
```

## Architecture Patterns

### Recommended Project Structure

```
server/maestro/
├── MODULE.md                          # 9 fixed H2 sections + Runnable Example
├── index.ts                           # MOD-02 strict 1-line internal/ re-export
├── plugin.ts                          # thin Fastify wirer (replaces 354-line current plugin.ts)
├── events.ts                          # 2 maestro.* events + makeMaestroEmitters
├── schemas.ts                         # (existing — DeviceMetadata zod schema if Phase 24 wants it)
└── internal/
    ├── module.ts                      # createMaestroModule(deps) factory + persistEnvelope (8th sample)
    ├── hierarchy-service.ts           # git mv from server/maestro/hierarchy-service.ts
    ├── appium-service.ts              # git mv from server/maestro/appium-service.ts
    ├── device-info-collector.ts       # git mv from server/pool/device-info-collector.ts
    └── subscribers.ts                 # device.booted handler → DeviceInfoCollector.collect + emit
```

### Pattern 1: Substrate-First Wave Shape (Phase 22/23 template)

**What:** 6-plan layout: Wave-0 substrate → Wave-1 events body → Wave-2 emission wiring → Wave-3 factory + plugin rewire + git mv → Wave-4 DB-gated proofs → Wave-5 phase close.
**When to use:** Always for module migrations under v3.0 — proven across Phases 16/18/19/20/21/22/23.
**Source:** `.planning/phases/22-streaming-module/22-CONTEXT.md` §Decisions; `.planning/phases/23-jobs-module-keystone/23-CONTEXT.md` §Wave Shape.

```
24-00 Wave-0 substrate (10 min):
  - server/maestro/events.ts placeholder (MAESTRO_EVENT_NAMES, empty registry)
  - server/maestro/queue.ts comment-only (no queue per CONTEXT)
  - server/maestro/internal/module.ts throw-stub (resolvable for dep-cruiser)
  - server/maestro/MODULE.md placeholder
  - server/maestro/index.ts barrel (1 line internal re-export)
  - .dependency-cruiser.cjs 8th rule + __fixtures__/dep-cruiser/bad-maestro-deep-import.ts
  - server/maestro/__tests__/events.spec.ts EVENTS-03 stub
  - server/pool/events.ts: add POOL_EVENT_NAMES.BOOTED + placeholder schema entry (poolRegistry stays at 4 entries; Plan 24-01 adds 5th)

24-01 events body (10 min):
  - server/maestro/events.ts full body (2 events + payload schemas + makeMaestroEmitters)
  - server/pool/events.ts: deviceBootedPayload schema + poolRegistry 5th entry (transient) + makePoolEmitters returns 5 helpers
  - events.spec full body (5 tests: name/registry/persistence/payload accept-reject)
  - pool/events.spec extension (1 test for the new entry — preserve Phase 20's existing 8 tests)

24-02 pool emission wiring (5 min):
  - server/pool/pool-manager.ts: 4 emit.booted call sites
    (addDevice line 62, initPool inner loop line 126, detectPhysicalDevices line 207, replaceDevice line 366) — AFTER each transition(Idle) success
  - pool/__tests__/subscriber.spec extension: 1 test asserting device.booted fires alongside state.changed

24-03 factory + plugin rewire + git mv (15 min):
  - git mv server/pool/device-info-collector.ts server/maestro/internal/device-info-collector.ts (preserves blame)
  - git mv server/maestro/hierarchy-service.ts server/maestro/internal/hierarchy-service.ts
  - git mv server/maestro/appium-service.ts server/maestro/internal/appium-service.ts
  - server/pool/index.ts: REMOVE DeviceInfoCollector re-export (line 33); UPDATE pool MODULE.md (line 18 doc note)
  - server/maestro/internal/module.ts: createMaestroModule factory (8TH SAMPLE POINT for persistEnvelope)
  - server/maestro/internal/subscribers.ts: device.booted handler (DeviceInfoCollector.collect → mutate device.metadata + emit maestro.device-info.collected); deferred to onReady
  - server/maestro/plugin.ts: thin wirer; dependencies ['config','db','event-bus','pool-plugin'] (no queue dep since no queue.ts)
  - server/index.ts: DELETE imperative onReady metadata loop (lines 167-191) — preserve hookExecutor.execute('device.booted',...) loop separately (different surface — hooks-side device.booted hook executor stays imperative pending Phase 16 hooks bus migration; document carry-forward)

24-04 DB-gated proofs (10 min):
  - subscriber.spec: pool emits device.booted → maestro subscriber calls deviceInfoCollector.collect → mutates device.metadata + emits maestro.device-info.collected with correlationId in envelope
  - correlation.spec: ALS correlationId threads pool emit → maestro subscribe → maestro re-emit
  - lifecycle-ownership.spec: readFileSync grep-guards on server/index.ts (zero metadata-collection imperative loop) + server/maestro/plugin.ts (zero direct deviceInfoCollector.collect outside subscribers.ts)

24-05 phase close (10 min):
  - MODULE.md 9-section body + Runnable Example
  - index.ts barrel expansion (named exports)
  - server/maestro/__tests__/{hierarchy-service,appium-service}.test.ts → .spec.ts via git mv
  - server/__tests__/plugin-order.spec.ts additive block (3 positional + 1 structural reading maestro/plugin.ts dependencies literal)
  - .planning/phases/24-maestro-module/deferred-items.md
  - Nyquist gate
  - STATE.md + ROADMAP.md update
```

### Pattern 2: Cross-Module Subscriber Defers to onReady (Pitfall 5 from Phase 23)

**What:** Maestro subscribes to `fastify.poolModule.bus.on('device.booted', ...)` inside `fastify.addHook('onReady', ...)` rather than at plugin-body time.
**When to use:** Whenever Module A's plugin reads decorators from Module B and B registers AFTER A in plugin order (or vice versa).
**Why:** Plugin-order in `server/index.ts`: pool-plugin (step 8) → websocket (step 10) → artifact (step 11) → reporting (step 12) → job-plugin (step 13) → ... → maestroPlugin currently registers around step 14 (between hooks and pipelines). Even though pool registers BEFORE maestro, `onReady` is the canonical pattern that makes the wiring agnostic to position changes (Phase 19/21/22/23 all use this same pattern).
**Source:** `.planning/phases/23-jobs-module-keystone/23-CONTEXT.md` Pitfall 5; verified at `server/jobs/internal/module.ts:159-195` (pool subscriber wiring); `server/streaming/internal/module.ts:184-230` (streaming subscriber wiring); `server/artifacts/internal/module.ts` (3 onReady-deferred subscribers).

```typescript
// Source: server/streaming/internal/module.ts:183-230 (Phase 22 verified canonical)
async function registerSubscribers(): Promise<void> {
  const poolModule = (
    fastify as FastifyInstance & {
      poolModule?: { bus: TypedBus<EventRegistry> };
    }
  ).poolModule;
  if (!poolModule || !poolModule.bus) {
    log.warn('registerSubscribers: fastify.poolModule.bus not decorated; skipping');
    return;
  }
  unsubscribeDeviceBooted = poolModule.bus.on(
    'device.booted' as never,
    (async (raw: unknown) => {
      const payload = raw as { deviceId: string; emulatorId: string; port: number | null; platform: 'android' | 'ios' };
      try {
        const metadata = await deviceInfoCollector.collect(payload.platform, payload.emulatorId, payload.port);
        const rawDevice = fastify.pool.getDeviceMap().get(payload.deviceId);
        if (rawDevice) rawDevice.metadata = metadata;
        emit.deviceInfoCollected(payload.deviceId, {
          deviceId: payload.deviceId,
          osVersion: metadata.osVersion,
          model: metadata.model,
        });
      } catch (err) {
        log.warn({ err, deviceId: payload.deviceId }, 'Failed to collect device metadata on device.booted');
      }
    }) as never,
  );
}
```

### Pattern 3: 8th persistEnvelope Sample Point (DEFERRED-22-E carries forward)

**What:** Verbatim 10-line persistEnvelope helper duplicated in `server/maestro/internal/module.ts`. Reaches the 8th sample point (Phase 16 hooks → 18 lifecycle → 19 reporting → 20 pool → 21 artifacts → 22 streaming → 23 jobs → 24 maestro).
**When to use:** Every module factory under v3.0 until Phase 27+ consolidation lands.
**Why:** Carries forward the agreed deferral. DO NOT consolidate during Phase 24 (scope creep).
**Source:** `server/jobs/internal/module.ts:95-126` (7th sample); `server/streaming/internal/module.ts:106-137` (6th sample); `server/artifacts/internal/module.ts:96-...` (5th sample).

### Anti-Patterns to Avoid

- **Imperative metadata-collection loop in `server/index.ts`:** The 19-line block at lines 167-189 (`hookExecutor.execute('device.booted', ...)` + the surrounding logic) is partly retained because `hookExecutor.execute` is the hook-side trigger (Phase 16 module surface). The bus-side `deviceInfoCollector.collect(...)` calls in `server/maestro/plugin.ts:55-72` (the current onReady loop) are the part that DIES in Phase 24 — moved into `subscribers.ts`. **DO NOT confuse these two loops** — one is hook-event execution (stays), one is metadata collection (moves to bus subscriber).
- **Inserting `device.booted` emission inside HealthChecker recovery paths:** OUT of scope. HealthChecker emits `device.health.failed` (Phase 20) — never re-emits `device.booted`. If a device recovers from Error → Idle, that's a `device.state.changed` event (already emitted), not a fresh boot.
- **Promoting maestro events to persisted:true:** Both events are high-frequency (hierarchy fetched on every UI route hit; device-info on every reboot). TRACE-08 says transient. Persistence costs DB rows for derivable signals.
- **Adding `queue.ts` body:** Maestro owns no pg-boss queues (matches Phase 22 streaming). Either omit the file entirely or leave a single-line comment ("// Maestro owns no queue surface — see MODULE.md §Queue Produced/Consumed").
- **Consolidating persistEnvelope here:** DEFERRED-24-B locks the 8th sample point. Phase 27+ owns consolidation.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-module subscription wiring | A custom `onSubscriberReady` hook | `fastify.addHook('onReady', async () => {...})` (Pattern 2) | Already canonical across 4 phases; Pitfall 5 documented |
| Per-event correlationId stamping in handlers | Manual `randomUUID()` fallback inside subscriber handler | `createEventHelpers(bus, persistEnvelope)` from `server/bus/helpers.ts` (auto-reads ALS via the bus emit path) | Substrate already wires this — see `streaming/internal/module.ts:81-93` for the dual-shape ALS reader if subscribers need to read at handler time |
| device.booted bus event inserted as a 5th non-poolRegistry event under maestro | Maestro emitting "I noticed a boot" from outside the state machine | Pool emits — maestro subscribes | Pool owns the device state machine; emission must be authoritative + match Phase 20 §Pitfall 2 (emit AFTER mutation success) |
| Queue surface for hierarchy fetches | A `maestro.hierarchy.fetch` queue wrapper | Direct service call from route handler | Hierarchy is on-demand HTTP — request/response, not durable retry. CONTEXT.md locks "no queue" |
| Manual envelope persistence in maestro factory | Custom `db.insert(eventsTable)` in module.ts | The 8th persistEnvelope verbatim copy (DEFERRED-24-B) | Carries forward the deferral; consolidating here violates scope |
| Renaming and rewriting tests in one phase | New test file content + new file name | `git mv .test.ts .spec.ts` 100% similarity (rename only) | DEFERRED-24-A — Phase 30 owns the rewrite |

**Key insight:** Maestro's substrate is the lightest of any v3.0 module migration — no queues, no idempotency layer, no terminal events, only 2 transient bus events. The phase is ~80% mechanical pattern application + 20% domain-specific (the 5th pool event + DeviceInfoCollector relocation + the imperative onReady loop deletion). All "interesting" engineering happened in Phases 15-23.

## Common Pitfalls

### Pitfall 1: Pool emit ordering — emit AFTER state row updates

**What goes wrong:** If `device.booted` is emitted BEFORE `device.transition(DeviceState.Idle)` succeeds, downstream subscribers (maestro, hooks) may attempt to read device metadata while the device is still in `Booting` state, causing transient `getDevice()` returning `Booting` or even an exception if the transition throws (`InvalidTransitionError`).
**Why it happens:** Phase 20 already documented this for `device.allocated` (RESEARCH §Pitfall 2 from Phase 20 — `pool-manager.ts:233-244`). Phase 24 inherits the convention.
**How to avoid:** In every emission site (4 sites in `pool-manager.ts`), call `this.emit.booted(deviceId, payload)` AFTER the `transition(Idle)` returns successfully. Match the existing `device.state.changed` shape verbatim:
```typescript
const { from, to } = device.transition(DeviceState.Idle);
this.emit.stateChanged(device.id, { deviceId: device.id, from, to });
this.emit.booted(device.id, { deviceId: device.id, platform: device.platform, emulatorId: device.emulatorId, port: device.port });
```
**Warning signs:** Test for the round-trip device.booted → maestro subscriber → `pool.getDeviceMap().get(deviceId)` returns the Idle-state Device. If the test sees Booting state, ordering is wrong.
**Source:** `.planning/phases/20-pool-module-devices/20-CONTEXT.md` §Specifics ("emit AFTER device.transition() succeeds"); verified at `server/pool/pool-manager.ts:62, 126, 207, 366`.

### Pitfall 2: Cross-module bus subscription registers before peer plugin decorates

**What goes wrong:** If `maestro/plugin.ts` calls `fastify.poolModule.bus.on('device.booted', ...)` directly in its plugin body, and pool's `poolModule` decorator isn't fully constructed by the time maestro's body runs, the subscription throws (or worse — silently registers on undefined).
**Why it happens:** Plugin body executes synchronously during `await fastify.register(maestroPlugin)`. Pool plugin (`server/pool/plugin.ts`) decorates `fastify.poolModule` during ITS body — order in `server/index.ts` puts pool at step 8 and maestro likely at step 14, so pool decorator IS available BUT the canonical pattern across Phases 19-23 still defers to onReady to be agnostic to ordering changes.
**How to avoid:** Wrap subscription in `fastify.addHook('onReady', async () => { ... })` per Pattern 2 above. Inside the handler, defensively check `if (!poolModule?.bus) { log.warn(...); return; }` — matches `streaming/internal/module.ts:188-198` exactly.
**Warning signs:** A spec that boots `buildApp()` and immediately fires `pool.allocate()` → no subscriber response. If the subscriber is wired in plugin body, the `await fastify.ready()` step inside the spec MAY make it work — but the canonical pattern says "always onReady."
**Source:** `.planning/phases/23-jobs-module-keystone/23-CONTEXT.md` Pitfall 5; `server/streaming/internal/module.ts:184-230`; `server/artifacts/internal/module.ts` (3 onReady deferrals).

### Pitfall 3: `device.booted` namespace collision with hookEvent literal

**What goes wrong:** `'device.booted'` is already a string literal in `server/hooks/schemas.ts:14`: `export type HookEvent = 'device.booted' | 'device.shutdown' | 'test.before' | 'test.after';`. The hooks system uses `hookExecutor.execute('device.booted', context)` to fire user-defined shell commands. Phase 24's bus event has the same name on a different surface. Importing maestro's `MAESTRO_EVENT_NAMES.DEVICE_BOOTED = 'device.booted'` AND hooks's `HookEvent` literal in the same file creates type-narrowing confusion.
**Why it happens:** EVENTS-03 forces `noun.verbed` past-tense names. Both surfaces independently arrived at the same name.
**How to avoid:** The new event lives in `server/pool/events.ts` (POOL_EVENT_NAMES.BOOTED), not maestro. POOL_EVENT_NAMES already enforces aggregateType:'pool'. The hooks-side string remains literal. Specs that touch BOTH surfaces (e.g., a future hook-bus integration test) must qualify which one — but Phase 24 scope is bus-only.
**Warning signs:** TypeScript error `Type '"device.booted"' is not assignable to type 'PoolEventName'` in a spec that imported the wrong constant. Resolve by importing `POOL_EVENT_NAMES.BOOTED` from `server/pool/events.js` not the hookEvent literal.
**Source:** `server/hooks/schemas.ts:14` verified; `server/index.ts:175` (current `hookExecutor.execute('device.booted', ...)` call site STAYS — it's a different system).

### Pitfall 4: Forgetting to update `server/pool/index.ts` after DeviceInfoCollector git mv

**What goes wrong:** `server/pool/index.ts:33` currently re-exports `DeviceInfoCollector`. After `git mv` to `server/maestro/internal/device-info-collector.ts`, that line becomes a dangling import. Worse: `server/maestro/plugin.ts:22` currently imports from `'../pool/device-info-collector.js'` — must rewrite.
**Why it happens:** git mv preserves blame at the FILE level but doesn't update import paths.
**How to avoid:** Plan 24-03 task list MUST include:
1. `git mv server/pool/device-info-collector.ts server/maestro/internal/device-info-collector.ts`
2. Edit `server/pool/index.ts` — remove line 33 (`export { DeviceInfoCollector } ...`)
3. Edit `server/pool/MODULE.md` — remove/update line 18 (`DeviceInfoCollector class — back-compat`)
4. Update any consumer imports (currently only `server/maestro/plugin.ts:22`)
**Warning signs:** `npx tsc --noEmit` after the git mv produces "Cannot find module './device-info-collector.js'" from `server/pool/index.ts`.
**Source:** `server/pool/index.ts:33` verified; `server/pool/MODULE.md:18` verified ("DeviceInfoCollector class — back-compat. Consumed by server/maestro/plugin.ts:22").

### Pitfall 5: Test isolation for device.booted → maestro.* round-trip

**What goes wrong:** A DB-gated subscriber.spec that boots `buildApp()`, fires a fake pool emit, expects maestro to receive it — but the spec's per-module bus instance (poolModule.bus) is NOT the same instance maestro subscribes to if either module is double-instantiated, or if the spec creates its own `TypedBus` instead of reaching through `fastify.poolModule.bus`.
**Why it happens:** Each `createPoolModule(deps)` call creates a NEW TypedBus<PoolRegistry>. The spec must subscribe via `fastify.poolModule.bus.on(...)` AFTER fastify.ready() so the maestro plugin's onReady subscriber is wired to the same instance.
**How to avoid:** Mirror Phase 23 `subscriber.spec` pattern — `await app.ready()` before any emit; subscribe via the decorator surface, not raw bus construction.
**Warning signs:** Subscriber.spec passes for Phase 22/23 patterns but fails on Phase 24 with "Subscriber received 0 events" — usually means the spec is emitting on a different bus instance than maestro subscribed to.
**Source:** `server/jobs/__tests__/subscriber.spec.ts` (Phase 23 reference); `server/artifacts/__tests__/subscriber.spec.ts` (Phase 21).

### Pitfall 6: Pool extension scope creep (5th event triggers spec extension churn)

**What goes wrong:** Adding `device.booted` to poolRegistry triggers cascading spec edits: `pool/__tests__/events.spec.ts` (Phase 20 8 tests + N new), `pool/__tests__/subscriber.spec.ts` (Phase 20 verifies 4 events fire — must extend to 5), `pool/__tests__/correlation.spec.ts` (currently asserts health.failed envelope — independent, no change), `server/__tests__/plugin-order.spec.ts` (no change — pool plugin shape unchanged).
**Why it happens:** poolRegistry is part of pool's MODULE.md contract. Every spec that asserts "pool emits 4 events" needs the literal updated to 5.
**How to avoid:** Plan 24-01 MUST include a task that updates pool/events.spec.ts assertions verbatim (counts: `expect(Object.keys(poolRegistry)).toHaveLength(5)`, dotted-name array with 5 entries, makePoolEmitters returns 5-key object). Plan 24-02 extends pool/subscriber.spec for the 5th emission. Plan 24-05 extends pool/MODULE.md to document the 5th event.
**Warning signs:** Phase 24 plan ships, pool/events.spec.ts breaks because count assertion still says 4. Catch in CI via `npx vitest run server/pool/__tests__/`.
**Source:** `server/pool/__tests__/events.spec.ts` (Phase 20 Plan 20-01); `server/pool/__tests__/subscriber.spec.ts` (Phase 20 Plan 20-04).

## Code Examples

Verified patterns from existing v3.0 modules.

### Example 1: 2-event registry shape (mirror `streaming/events.ts` 1-event + `artifacts/events.ts` 3-event hybrid)

```typescript
// Source: server/streaming/events.ts (1-event template) + server/artifacts/events.ts (multi-event)
import { z } from 'zod';
import { createEventHelpers } from '../bus/helpers.js';
import type { TypedBus } from '../bus/bus.js';
import type { EventRegistry } from '../bus/types.js';
import type { Envelope } from '../events/envelope.js';
import { platformSchema } from '../pool/schemas.js'; // shared

export const MAESTRO_EVENT_NAMES = {
  HIERARCHY_FETCHED:    'maestro.hierarchy.fetched',
  DEVICE_INFO_COLLECTED: 'maestro.device-info.collected',
} as const;
export type MaestroEventName = typeof MAESTRO_EVENT_NAMES[keyof typeof MAESTRO_EVENT_NAMES];

// v5 UUID derived from 'maestro' (RFC 4122 §4.3); reserved for module-wide telemetry.
// Re-derive offline via uuidv5('maestro', '6ba7b811-9dad-11d1-80b4-00c04fd430c8')
// before committing — events.spec re-derives at test-time and asserts match.
export const MAESTRO_AGGREGATE_ID = '<COMPUTE_VIA_UUIDV5>' as const;

export const maestroHierarchyFetchedPayload = z.object({
  deviceId: z.string().uuid(),
  source: z.enum(['maestro-cli', 'device-server', 'native', 'appium']),
  elementCount: z.number().int().nonnegative(),
  fetchTimeMs: z.number().nonnegative(),
});

export const maestroDeviceInfoCollectedPayload = z.object({
  deviceId: z.string().uuid(),
  osVersion: z.string().nullable(),
  model: z.string().nullable(),
});

export const maestroRegistry = {
  [MAESTRO_EVENT_NAMES.HIERARCHY_FETCHED]:    { schema: maestroHierarchyFetchedPayload,    persisted: false, aggregateType: 'maestro' },
  [MAESTRO_EVENT_NAMES.DEVICE_INFO_COLLECTED]: { schema: maestroDeviceInfoCollectedPayload, persisted: false, aggregateType: 'maestro' },
} as const satisfies EventRegistry;
export type MaestroRegistry = typeof maestroRegistry;

export function makeMaestroEmitters(
  bus: TypedBus<MaestroRegistry>,
  onEmit?: (envelope: Envelope) => void,
) {
  const emit = createEventHelpers(bus, onEmit);
  return {
    hierarchyFetched:     emit(MAESTRO_EVENT_NAMES.HIERARCHY_FETCHED),
    deviceInfoCollected:  emit(MAESTRO_EVENT_NAMES.DEVICE_INFO_COLLECTED),
  };
}
export type MaestroEmitters = ReturnType<typeof makeMaestroEmitters>;
```

### Example 2: Pool 5th event addition (`device.booted`)

```typescript
// Source: server/pool/events.ts:48-145 — extend the existing constants/schemas/registry
export const POOL_EVENT_NAMES = {
  STATE_CHANGED: 'device.state.changed',
  ALLOCATED:     'device.allocated',
  RELEASED:      'device.released',
  HEALTH_FAILED: 'device.health.failed',
  BOOTED:        'device.booted',          // NEW (Phase 24)
} as const;

export const deviceBootedPayload = z.object({
  deviceId:   z.string().uuid(),
  platform:   platformSchema,
  emulatorId: z.string(),
  port:       z.number().int().nullable(),  // physical Android devices have null port
});

export const poolRegistry = {
  // ... existing 4 entries ...
  [POOL_EVENT_NAMES.BOOTED]: { schema: deviceBootedPayload, persisted: false, aggregateType: 'pool' },
} as const satisfies EventRegistry;

export function makePoolEmitters(
  bus: TypedBus<PoolRegistry>,
  onEmit?: (envelope: Envelope) => void,
) {
  const emit = createEventHelpers(bus, onEmit);
  return {
    stateChanged: emit(POOL_EVENT_NAMES.STATE_CHANGED),
    allocated:    emit(POOL_EVENT_NAMES.ALLOCATED),
    released:     emit(POOL_EVENT_NAMES.RELEASED),
    healthFailed: emit(POOL_EVENT_NAMES.HEALTH_FAILED),
    booted:       emit(POOL_EVENT_NAMES.BOOTED),   // NEW
  };
}
```

### Example 3: Pool emission site (mirror `device.allocated` shape — emit AFTER mutation)

```typescript
// Source: server/pool/pool-manager.ts:120-135 (the inner loop of initPool — ALREADY emits stateChanged AFTER transition)
// Phase 24 adds a single emit.booted call right after the existing emit.stateChanged

if (alreadyHealthy) {
  device.port = detectedPort;
  this.logger.info({ emulatorId, port: detectedPort }, 'Reusing already-running emulator');
} else {
  const result = await driver.boot(emulatorId);
  device.port = result.port;
  device.pid = result.pid;
  this.processTracker.register(device.id, result.pid);
}

const { from, to } = device.transition(DeviceState.Idle);
this.emit.stateChanged(device.id, { deviceId: device.id, from, to });
// NEW (Phase 24 Plan 24-02):
this.emit.booted(device.id, {
  deviceId: device.id,
  platform: device.platform,
  emulatorId: device.emulatorId,
  port: device.port,
});
this.logger.info({ deviceId: device.id, name, platform, emulatorId }, 'Device booted');
```

The same 4-line emit.booted addition repeats at:
- `pool-manager.ts:62` (addDevice) — port:null, emulatorId from constructor
- `pool-manager.ts:207` (detectPhysicalDevices) — port:null
- `pool-manager.ts:366` (replaceDevice) — port from result.port

### Example 4: Maestro factory + subscriber (composite — mirrors `streaming/internal/module.ts`)

```typescript
// Source: server/streaming/internal/module.ts:95-261 (canonical no-queue factory shape)
import { TypedBus } from '../../bus/bus.js';
import { events as eventsTable } from '../../db/schema.js';
import { maestroRegistry, makeMaestroEmitters, type MaestroRegistry, type MaestroEmitters } from '../events.js';
import { HierarchyService } from './hierarchy-service.js';
import { AppiumService } from './appium-service.js';
import { DeviceInfoCollector } from './device-info-collector.js';

export function createMaestroModule(deps: CreateMaestroModuleDeps): MaestroModule {
  const log = deps.logger.child({ module: 'maestro' });
  const appiumService = new AppiumService(log, { /* config */ });
  const hierarchyService = new HierarchyService(log, undefined, appiumService);
  const deviceInfoCollector = new DeviceInfoCollector(log);

  const bus = new TypedBus(maestroRegistry);
  const persistEnvelope = makePersistEnvelope({ db: deps.db, bus, logger: log }); // 8TH SAMPLE POINT
  const emit = makeMaestroEmitters(bus, persistEnvelope);

  let unsubscribeDeviceBooted: (() => void) | null = null;

  return {
    appiumService,
    hierarchyService,
    deviceInfoCollector,
    emit,
    bus,
    registerSubscribers: async () => {
      const poolModule = (deps.fastify as FastifyInstance & {
        poolModule?: { bus: { on: (n: string, h: (raw: unknown) => void) => () => void } };
      }).poolModule;
      if (!poolModule?.bus) {
        log.warn('poolModule.bus not decorated; device.booted subscriber not wired');
        return;
      }
      unsubscribeDeviceBooted = poolModule.bus.on('device.booted', async (raw: unknown) => {
        const payload = raw as { deviceId: string; platform: 'android' | 'ios'; emulatorId: string; port: number | null };
        try {
          const metadata = await deviceInfoCollector.collect(payload.platform, payload.emulatorId, payload.port);
          const rawDevice = deps.fastify.pool.getDeviceMap().get(payload.deviceId);
          if (rawDevice) rawDevice.metadata = metadata;
          emit.deviceInfoCollected(payload.deviceId, {
            deviceId: payload.deviceId,
            osVersion: metadata.osVersion,
            model: metadata.model,
          });
        } catch (err) {
          log.warn({ err, deviceId: payload.deviceId }, 'collect failed on device.booted');
        }
      });
    },
    shutdown: async () => {
      if (unsubscribeDeviceBooted) { unsubscribeDeviceBooted(); unsubscribeDeviceBooted = null; }
      await appiumService.closeAllSessions();
    },
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Imperative metadata-collection onReady loop in `server/maestro/plugin.ts:55-72` | Maestro subscriber on `device.booted` bus event | Phase 24 (this) | Cross-module coupling deletion; metadata refresh becomes event-driven |
| `DeviceInfoCollector` housed in `server/pool/` | Housed in `server/maestro/internal/` | Phase 24 (this) | Collector is a Maestro concern (uses adb getprop / xcrun simctl — Maestro-style metadata, not pool state machine) |
| Pool emits 4 events (state.changed/allocated/released/health.failed) | Pool emits 5 events (+ device.booted) | Phase 24 (this) | First poolRegistry extension since Phase 20 close |
| `hookExecutor.execute('device.booted', ...)` imperative loop in `server/index.ts:167-189` | UNCHANGED in Phase 24 (different surface — hooks-side) | Future phase (post-24) may consolidate hooks→bus migration | Hook executor is a separate user-facing trigger system; coexists with bus |
| `*.test.ts` files in `server/maestro/__tests__/` | `.spec.ts` rename via git mv | Phase 24 (this), with body rewrite deferred to Phase 30 | MOD-04 partial — file naming compliant, content rewrite pending |

**Deprecated/outdated within this project:**
- `server/maestro/plugin.ts` (354 lines, 12.5KB) — replaced by thin wirer in Phase 24 Plan 24-03. Routes move to a (likely) `server/maestro/routes.ts` (hierarchy + query + screenshot + info + state + appium-status — 6 routes); decorators (`fastify.hierarchyService`, `fastify.appiumService`, `fastify.deviceInfoCollector`) become `fastify.maestroModule.{hierarchyService, appiumService, deviceInfoCollector}` BUT may also retain back-compat decorators (mirror Phase 22 streaming's 3-decorator approach: `jobBroadcaster + devicePreview + streamingModule`).
- `server/pool/device-info-collector.ts` — moves via git mv. Pool module file count drops by 1.
- `server/pool/index.ts:33` `export { DeviceInfoCollector }` — line deleted in Plan 24-03.

## Open Questions

1. **Should maestro retain back-compat decorators (`fastify.hierarchyService`, etc.) or only expose `fastify.maestroModule`?**
   - What we know: Phase 22 streaming kept 2 back-compat decorators (`jobBroadcaster` + `devicePreview`) PLUS the new `streamingModule` (3 total). Reason: existing route handlers in `server/api/routes/*.ts` may call `fastify.jobBroadcaster.emit(...)` directly. Phase 23 jobs kept `fastify.jobService` shim for the same reason.
   - What's unclear: do route handlers outside `server/maestro/plugin.ts` reach `fastify.hierarchyService` / `fastify.appiumService` / `fastify.deviceInfoCollector` directly? A quick grep across `server/api/`, `server/jobs/`, `server/pipelines/` is the answer. If yes → keep 4 decorators (3 back-compat + maestroModule). If no → only `fastify.maestroModule` is needed.
   - Recommendation: Plan 24-03 first task = `grep -rn "fastify\.\(hierarchyService\|appiumService\|deviceInfoCollector\)" server/`. If any hits outside `server/maestro/`, retain back-compat. Default to retain (matches Phase 22/23 convention) — costs nothing.

2. **`device.booted` payload — include `name` field?**
   - What we know: existing `Device` class carries `name` (e.g., 'android-1', 'physical-Pixel 6'). Maestro subscribers may want to log the human-readable name.
   - What's unclear: payloads should be thin (EVENTS-04). DeviceInfoCollector subscriber re-fetches metadata anyway via `deps.fastify.pool.getDevice(deviceId)`. Including `name` in the payload bloats by ~30 chars per event.
   - Recommendation: thin payload — `{deviceId, platform, emulatorId, port}` only (matches `device.allocated` shape: `{deviceId, jobId, platform}`). Subscribers re-fetch via `pool.getDevice(deviceId)` if they need `name` (mirrors Phase 21 artifacts subscriber pattern).

3. **Plugin name: `'maestro-plugin'` (current) vs `'maestro'`?**
   - What we know: Phase 22 kept `'websocket-plugin'` for back-compat with 5+ dependency declarations. Phase 23 kept `'job-plugin'` for 12-plugin dep-string back-compat.
   - What's unclear: how many other plugin dependency arrays reference `'maestro-plugin'`? `grep -rn "'maestro-plugin'" server/` answers it.
   - Recommendation: keep `'maestro-plugin'` for symmetry with Phase 22/23 back-compat decisions. Renaming is scope creep.

4. **MAESTRO_AGGREGATE_ID v5 derivation — pre-compute and hardcode?**
   - What we know: Phase 18 LIFECYCLE_AGGREGATE_ID, Phase 19 REPORTING_AGGREGATE_ID, Phase 20 POOL_AGGREGATE_ID (`'2a120cd5-4bd3-5f65-a9e5-870ec709e44a'`), Phase 21 ARTIFACTS_AGGREGATE_ID, Phase 22 STREAMING_AGGREGATE_ID all derived via `uuidv5('<modulename>', '6ba7b811-9dad-11d1-80b4-00c04fd430c8')` (URL namespace). Spec re-derives at test-time, hardcoded literal is grep-friendly.
   - What's unclear: nothing — pure mechanical step.
   - Recommendation: Plan 24-01 task computes `uuidv5('maestro', URL_NAMESPACE)` offline (e.g., `node -e "console.log(require('uuid').v5('maestro', '6ba7b811-9dad-11d1-80b4-00c04fd430c8'))"`), hardcodes the literal in events.ts, and writes the events.spec assertion that re-derives at test time and asserts equality. Standard Phase 18-23 mechanical step.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `npx vitest run <path>` (single file) or `npx vitest run server/maestro/__tests__/events.spec.ts` |
| Full suite command | `npm test` (calls `vitest run`) — ~9-23s depending on DB-gated specs |

### Phase Requirements → Test Map

Phase 24 has no direct REQUIREMENTS.md keys. The mapping is to ROADMAP success criteria SC1/SC2/SC3.

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SC1 | HierarchyService/DeviceInfoCollector/AppiumService live behind barrel; no route reaches internals | structural (readFileSync grep + dep-cruiser) | `npx vitest run server/maestro/__tests__/lifecycle-ownership.spec.ts && npm run dep-check` | ❌ Wave 0 (lifecycle-ownership.spec.ts new) |
| SC2 | Device metadata refresh triggered by `device.booted` bus subscription, not onReady loop | unit + DB-gated integration | `npx vitest run server/maestro/__tests__/subscriber.spec.ts` | ❌ Wave 4 |
| SC3a | Phase 16 conventions (MODULE.md + barrel + events.ts + factory + tests-as-spec) | structural | `find server/maestro -name 'MODULE.md' && find server/maestro -name 'index.ts' && find server/maestro -name 'events.ts'` + `npx vitest run server/maestro/__tests__/module.spec.ts` | ❌ Wave 0 (module.spec.ts new) |
| SC3b | Emits `maestro.hierarchy.fetched` and `maestro.device-info.collected` | unit | `npx vitest run server/maestro/__tests__/events.spec.ts` | ❌ Wave 0 (events.spec.ts new) |
| SC3c | Nyquist passes; coverage delta ≤ -2pp | aggregate | `npm run nyquist:check` | ✅ (script exists; runs at phase close) |
| SC3d | dep-cruiser 8th rule fires on bad import | structural | `npx vitest run server/hooks/__tests__/dep-cruiser.spec.ts` (extended in Wave 0 with [MOD-02 maestro extension] block) | ✅ (existing spec, extension new) |
| SC3e | plugin-order.spec extension | DB-gated structural | `npx vitest run server/__tests__/plugin-order.spec.ts` | ✅ (existing — extended in Wave 5) |
| SC3f | correlationId threads pool emit → maestro subscribe → maestro re-emit | DB-gated integration | `npx vitest run server/maestro/__tests__/correlation.spec.ts` | ❌ Wave 4 |
| SC3g | Pool 5th event verified | unit | `npx vitest run server/pool/__tests__/events.spec.ts` (extended in Wave 1) | ✅ (existing — extended) |
| SC3h | Pool emission sites fire device.booted alongside state.changed | unit | `npx vitest run server/pool/__tests__/subscriber.spec.ts` (extended in Wave 2) | ✅ (existing — extended) |

### Sampling Rate
- **Per task commit:** `npx vitest run <relevant single-file path>` (~200-500ms for unit specs; ~5-15s for DB-gated)
- **Per wave merge:** `npx vitest run server/maestro/__tests__/ server/pool/__tests__/` (~10-25s including DB-gated)
- **Phase gate:** `npm test` full suite green BEFORE `/gsd:verify-work`; `npm run nyquist:check` exit 0; `npm run dep-check` shows no new violations vs. Phase 23 baseline (3 pre-existing artifacts→streaming/internal expected-known); `npx tsc --noEmit` shows 8-10 pre-existing errors unchanged (DEFERRED-15-A inherited).

### Wave 0 Gaps

- [ ] `server/maestro/__tests__/events.spec.ts` — covers SC3b (EVENTS-03 shape: 2 dotted past-tense names; registry persistence flags; aggregateType='maestro'; payload schemas accept/reject; makeMaestroEmitters returns 2 typed helpers; ALS correlationId envelope stamping)
- [ ] `server/maestro/__tests__/module.spec.ts` — covers SC3a (no-DB factory shape: deps construction, decorator surface, shutdown idempotency, subscriber lifecycle)
- [ ] `server/maestro/__tests__/subscriber.spec.ts` — covers SC2 (DB-gated: emit fake `device.booted` via fastify.poolModule.bus → maestro subscriber calls deviceInfoCollector.collect → device.metadata mutated → maestro.device-info.collected fired with correlationId in envelope)
- [ ] `server/maestro/__tests__/correlation.spec.ts` — covers SC3f (DB-gated: ALS correlationId threads end-to-end pool emit → maestro subscribe → maestro re-emit; envelope round-trip in events table for any persisted entry — but neither maestro event persists, so use the side-channel `${type}.envelope` listener for round-trip proof, mirror Phase 22 streaming envelope.spec)
- [ ] `server/maestro/__tests__/lifecycle-ownership.spec.ts` — covers SC1 (readFileSync grep-guards: zero `deviceInfoCollector\.collect\(` outside `server/maestro/internal/subscribers.ts`; zero `import .* from '\.\./pool/device-info-collector` anywhere; zero metadata-collection imperative loop in `server/index.ts` (after Plan 24-03 deletes lines 167-191 of the bus-side loop — the hookExecutor loop stays))
- [ ] `__fixtures__/dep-cruiser/bad-maestro-deep-import.ts` — fires the 8th rule via `@ts-expect-error import from '../../server/maestro/internal/module.js'`
- [ ] `.dependency-cruiser.cjs` — append 8th forbidden rule `no-deep-imports-into-maestro-internal` mirroring rules 5/6/7 verbatim
- [ ] `server/hooks/__tests__/dep-cruiser.spec.ts` — extend with `[MOD-02 maestro extension]` it-block (two-pass err+json pattern; matches Phase 20-23 extensions)
- [ ] `server/maestro/events.ts` — placeholder (MAESTRO_EVENT_NAMES + empty registry; full body in 24-01)
- [ ] `server/maestro/queue.ts` — single comment line "Maestro owns no queue surface" (matches Phase 22 streaming)
- [ ] `server/maestro/internal/module.ts` — 10-line throw-stub (resolvable for dep-cruiser)
- [ ] `server/maestro/MODULE.md` — Purpose-only placeholder
- [ ] `server/maestro/index.ts` — 1-line MOD-02 strict re-export
- [ ] `server/pool/events.ts` — placeholder addition: `POOL_EVENT_NAMES.BOOTED` constant only (registry stays at 4 entries; full body 24-01)

Framework install: not needed — Vitest already provisioned.

## Sources

### Primary (HIGH confidence)
- `.planning/phases/24-maestro-module/24-CONTEXT.md` — locked decisions
- `.planning/REQUIREMENTS.md` — REQ traceability (Phase 24 has 0 direct keys)
- `.planning/ROADMAP.md` lines 241-249 — Phase 24 description + success criteria
- `.planning/phases/23-jobs-module-keystone/23-CONTEXT.md` — Pitfall 5 (cross-module subscriber defer to onReady), saga subscriber pattern
- `.planning/phases/22-streaming-module/22-CONTEXT.md` — no-queue module template (most direct analog)
- `.planning/phases/21-artifacts-module/21-CONTEXT.md` — subscriber chain pattern
- `.planning/phases/20-pool-module-devices/20-CONTEXT.md` — 4-event pool registry shape; Pitfall 2 (emit AFTER mutation success)
- `server/pool/events.ts:48-175` — POOL_EVENT_NAMES, poolRegistry, makePoolEmitters (4-event template)
- `server/pool/pool-manager.ts:60-373` — 4 emission sites for device.state.changed at Booting→Idle (the same 4 sites for device.booted)
- `server/pool/internal/module.ts` — createPoolModule factory + persistEnvelope (4th sample point reference)
- `server/streaming/internal/module.ts:95-261` — no-queue module factory canonical (most direct template for maestro)
- `server/streaming/plugin.ts:46-212` — thin plugin wirer template
- `server/streaming/events.ts:54-60` — single-event registry shape (extends to 2)
- `server/jobs/internal/module.ts:128-257` — 7th persistEnvelope sample
- `server/jobs/internal/subscribers.ts:36-100` — onReady cross-module subscriber pattern (jobs → poolModule.bus)
- `server/maestro/plugin.ts:54-72` — current imperative metadata-collection loop (the code that DIES in 24-03)
- `server/maestro/plugin.ts:36-47` — current decorator surface (3 decorators to relocate behind maestroModule)
- `server/index.ts:151-208` — current onReady block (lines 167-191 = bus-side loop to delete; lines 192-207 = DB sync stays; hookExecutor.execute('device.booted', ...) at 175 stays)
- `server/pool/device-info-collector.ts:1-303` — service to git mv
- `server/maestro/hierarchy-service.ts:1-100` — service to git mv (29KB)
- `server/maestro/appium-service.ts:1-50` — service to git mv (7.2KB)
- `server/hooks/schemas.ts:14` — `HookEvent` type ALREADY contains `'device.booted'` literal (Pitfall 3 source)
- `.dependency-cruiser.cjs` lines 1-100 — 7-rule registry (extending to 8)
- `server/__tests__/plugin-order.spec.ts:1-80` — additive plugin-order assertions template

### Secondary (MEDIUM confidence)
- `.planning/STATE.md` (lines 0-100) — Phase 23 close narrative; Phase 24 named as next
- `.planning/config.json` — `nyquist_validation: true` confirmed

### Tertiary (LOW confidence)
- None. All findings are file-grounded in the working tree at HEAD.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — pure substrate reuse; no new deps
- Architecture: HIGH — Phase 22 streaming is direct template (no-queue module + cross-module bus subscriber + factory + thin plugin)
- Pitfalls: HIGH — all 6 pitfalls source-cited from Phase 20-23 closes + verified at file:line
- Pool extension scope: HIGH — POOL_EVENT_NAMES.BOOTED absent confirmed by grep; 4 emission sites enumerated at file:line
- DeviceInfoCollector relocation: HIGH — exactly 2 import sites verified (`server/maestro/plugin.ts:22` + `server/pool/index.ts:33`)
- 8th persistEnvelope: HIGH — pattern reaches its 8th repeat exactly as Phase 22 DEFERRED-22-E predicted
- Validation architecture: HIGH — Vitest already provisioned; pattern of unit + DB-gated specs locked since Phase 16

**Research date:** 2026-05-08
**Valid until:** 2026-06-08 (30 days; v3.0 substrate is stable; pool/streaming/jobs reference impls won't drift)
