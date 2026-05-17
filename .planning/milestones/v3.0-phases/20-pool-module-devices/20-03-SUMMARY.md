---
phase: 20-pool-module-devices
plan: 03
subsystem: pool
tags: [pool, module, factory, plugin, sc2, sc3, mod-06, queue-06, reaper-migration, pg-boss, health-checker-ownership]

# Dependency graph
requires:
  - phase: 20-pool-module-devices
    plan: 20-00
    provides: "Pool Wave-0 substrate — dep-cruiser rule + DEVICE_BOOT/DEVICE_REAP queue-name constants + internal/module.ts throw-stub"
  - phase: 20-pool-module-devices
    plan: 20-01
    provides: "server/pool/events.ts MOD-03 body — poolRegistry + makePoolEmitters + 4 event-name constants + POOL_AGGREGATE_ID"
  - phase: 20-pool-module-devices
    plan: 20-02
    provides: "PoolManager + HealthChecker 4th-param emit (NOOP_POOL_EMIT default); 17 emit call sites wired at all transition + health-failure points"
  - phase: 18-lifecycle-migration-node-cron-pg-boss
    plan: 18-02
    provides: "Canonical pg-boss 3-step createQueue+schedule+work pattern; lifecycle/queue.ts 222 lines mirrored here"
  - phase: 18-lifecycle-migration-node-cron-pg-boss
    plan: 18-03
    provides: "createLifecycleModule factory shape (142 lines) — persistEnvelope 10-line duplicate + stopped-flag idempotent shutdown; mirrored 1:1 for pool"
  - phase: 19-reporting-migration-webhooks-dlq
    plan: 19-03
    provides: "createReportingModule factory (265 lines) — 4-decorator plugin thin-wirer + back-compat class instances; mirrored for pool's PoolManager + HealthChecker"
provides:
  - "server/pool/queue.ts registerPoolQueues({fastify, processTracker, logger}) factory — boss.createQueue(DEVICE_REAP, {policy:'stately', retryLimit:1, retryBackoff:true, retryDelay:30}) + queue.schedule(DEVICE_REAP, '* * * * *', {}, {singletonKey: DEVICE_REAP}) + queue.work(DEVICE_REAP, handler calling processTracker.reapOrphans()); DEVICE_BOOT name-only (NOT registered — Phase 23 scope)"
  - "server/pool/internal/module.ts createPoolModule(deps) factory (MOD-06) — per-module TypedBus<PoolRegistry> + persistEnvelope (4th sample point — Phase 27+ consolidation trigger) + makePoolEmitters(bus, persistEnvelope); constructs PoolManager + HealthChecker with REAL emit (replaces NOOP_POOL_EMIT default); 6-key return {pool, healthChecker, emit, bus, registerWorkersAndSubscribers, shutdown}; idempotent shutdown (stopped flag)"
  - "server/pool/plugin.ts thin wirer (~82 lines) — 4 decorators (pool/processTracker/healthChecker/poolModule); dependencies extended ['config'] → ['config', 'db', 'queue', 'event-bus']; plugin NAME 'pool-plugin' preserved for 9+ downstream dep strings; platform drivers (android/ios) registered on module.pool verbatim"
  - "server/index.ts lines 209-215 + 245-251 DELETED (SC2 achieved) — healthChecker.start + processTracker.startReaper + healthChecker.stop + processTracker.stop + 4 log lines all removed; shutdown step labels rewritten (b→f sequential); comment block rewritten to reflect Phase 20 ownership"
  - "server/pool/process-tracker.ts startReaper + reaperInterval field REMOVED; stop() retained as no-op with Phase 20 comment for back-compat with PoolManager.shutdown historical call sequence"
  - "server/pool/__tests__/module.spec.ts (7 tests, MOD-06 proofs) — factory shape + instance checks + registerWorkersAndSubscribers wiring + idempotent shutdown (MOD-08 g) + offWork-per-worker + pool.shutdown NOT called (deferred)"
  - "server/pool/__tests__/lifecycle-ownership.spec.ts (5 tests, SC2 proofs) — 3 readFileSync-based grep-guards on server/index.ts (no healthChecker.start/startReaper/stop, no 4 deleted log strings) + behavioral lifecycle symmetry + pool plugin dependencies assertion"
  - "89 pool tests green (77 pre-plan + 12 new); Phase 19 pre-existing dep-check violation (jobs/plugin.ts → bus/bus.ts, Phase 23 scope) carries forward unchanged"
affects: [20-04-db-gated-proofs, 20-05-module-md-barrel-nyquist, 23-jobs-keystone, 24-streaming-device-preview, 27-trace-tree]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Mixed in-process setInterval + pg-boss schedule ownership pattern: Pool module owns BOTH lifecycles via the SAME module.shutdown() — healthChecker.stop() (ephemeral health state; RESEARCH §Don't Hand-Roll keeps it setInterval for avoid-Postgres-polling-cost reasons) + boss.offWork(reapWorkerId) (singleton protection via policy:'stately' + singletonKey; graceful drain via Fastify onClose plumbing). First module in v3.0 to own a non-uniform worker mix — Phase 18 lifecycle is 100% pg-boss, Phase 16 hooks is 100% bus-driven. Template for Phase 24 streaming (per-device preview pipelines + global reaper) + Phase 22 observability (ephemeral metrics + persisted telemetry)."
    - "4-sample persistEnvelope duplicate reached — Phase 27+ consolidation trigger: server/bus/plugin.ts (substrate) + server/hooks/internal/module.ts (pilot) + server/lifecycle/internal/module.ts (Phase 18) + server/reporting/internal/module.ts (Phase 19) + server/pool/internal/module.ts (Phase 20, this plan) = 5 sites total. Phase 18 plan noted 'three sample points now'; Phase 19 noted 'four sample points'; Plan 20-03 reaches 'fifth' (or 'fourth module-level sample' if bus/plugin.ts is counted as substrate-not-module). RESEARCH §Architecture Patterns explicitly documents Phase 27+ consolidation PR will refactor all 4 module-level duplicates into a shared `makePersistEnvelope<R>(deps)` generic helper that takes the Registry type + db handle."
    - "ProcessTracker.stop() as no-op retained for call-graph stability: Phase 20 migrated the reaper from raw setInterval (startReaper + reaperInterval field) to pg-boss schedule via registerPoolQueues. The reaper body (scan → kill orphans) is unchanged (still reapOrphans()) — only the scheduling mechanism moved. But PoolManager.shutdown() (line 333) still calls processTracker.stop() as part of its historical call sequence. Converting stop() to a documented no-op (vs. deleting the method entirely) preserves PoolManager.shutdown's untouched call graph — a Phase-20-scope-preserving choice. Phase 20+ can delete stop() entirely once PoolManager.shutdown migrates to the module.shutdown() owned lifecycle."
    - "ProcessTracker startReaper.test removed inline under Rule 3 (blocking issue): server/pool/__tests__/process-tracker.test.ts contained a `describe('reaper')` block with 2 tests calling the now-deleted startReaper method. TSC would fail with TS2339 otherwise. Rule-3 auto-fix deleted the describe block + replaced with a comment pointing at module.spec.ts + lifecycle-ownership.spec.ts as the new owners of reaper lifecycle coverage."
    - "Mock-based unit spec harness with no DB: module.spec.ts + lifecycle-ownership.spec.ts both construct the factory against makeMockFastify (vi.fn() for createQueue/offWork/schedule/work) + makeMockDb (drizzle-like `{insert: () => ({values: () => resolves})}`) + makeMockConfig (pool: {android: {enabled:false}, ios: {enabled:false}}). Zero pg-boss instance + zero Postgres dependency. Phase 20 Plan 20-04 escalates to DB-gated (real pg-boss + isolated pgboss_<suffix> schemas) for end-to-end correlation + envelope persistence proofs."

key-files:
  created:
    - server/pool/__tests__/module.spec.ts
    - server/pool/__tests__/lifecycle-ownership.spec.ts
  modified:
    - server/pool/queue.ts
    - server/pool/internal/module.ts
    - server/pool/plugin.ts
    - server/index.ts
    - server/pool/process-tracker.ts
    - server/pool/__tests__/process-tracker.test.ts

key-decisions:
  - "ProcessTracker.stop() converted to no-op vs. deleted. Alternatives considered: (a) delete stop() entirely + update PoolManager.shutdown to not call it (cross-file cascade, extends Phase 20 scope); (b) leave startReaper + stop() untouched + have queue.ts call BOTH the pg-boss worker AND processTracker.startReaper (hybrid state — defeats SC2 invariant); (c) rename stop() to something that signals it's a no-op (renamedStop break back-compat). Chose (convert to no-op with explicit Phase 20 comment): preserves PoolManager.shutdown's historical call sequence + keeps Phase 20 scope contained to the 7 files listed + leaves a marker for Phase 20+ follow-up cleanup. Pattern applies to any v3.0 migration where a legacy lifecycle method is called from a constructor-owned class (PoolManager) that the current phase deliberately doesn't refactor."
  - "2 reaper tests in process-tracker.test.ts removed inline (Rule 3 auto-fix) vs. deferred. Alternatives: (a) leave the 2 tests failing + deferred-items.md entry + skip TSC gate (breaks verification gate — not acceptable); (b) port the 2 tests to module.spec.ts (the new queue-driven reaper lifecycle is structurally different — testing startReaper cadence is meaningless when the cadence is owned by pg-boss schedule '* * * * *' which module.spec.ts already asserts). Chose inline deletion + comment-pointer: the reaper LIFECYCLE is now tested in module.spec.ts (healthChecker.start + registerPoolQueues worker wiring) + lifecycle-ownership.spec.ts (shutdown calls offWork). Direct Rule 3 fix — no test coverage lost."
  - "4 decorators (pool + processTracker + healthChecker + poolModule) over barrel-only. Alternatives: (a) expose ONLY fastify.poolModule + migrate all 9+ callers (api/jobs/maestro/hooks/streaming/pipelines/server/index.ts + specs) in this plan (massive cross-file cascade — breaks Phase 20 scope); (b) decorate 3 classic + skip poolModule (prevents Phase 20+ consumers from subscribing to pool.bus — defeats MOD-02 intent). Chose 4-decorator bridge: back-compat preserved (existing `app.pool` + `app.processTracker` + `app.healthChecker` reads still work) + new surface `app.poolModule.bus.on(...)` available for Phase 24+ subscribers. Phase 27+ consolidation PR will audit whether consumers can migrate to `poolModule.pool` barrel-only (cross-module Godot-level cleanup deferred until after jobs keystone + streaming land)."
  - "registerPoolQueues receives processTracker via deps (not imported at module-top). Alternatives: (a) processTracker singleton module-top import (circular — pool/plugin.ts → queue.ts → process-tracker.ts while pool/plugin.ts also imports process-tracker.ts; works but creates an implicit dependency chain that's fragile under test-time mocking); (b) queue.ts instantiates its own ProcessTracker (defeats singleton semantics — multiple trackers = divergent pids maps). Chose deps-injection: queue.ts imports only the TYPE `import type { ProcessTracker }` + the INSTANCE is threaded through registerPoolQueues({fastify, processTracker, logger}) → createPoolModule's registerWorkersAndSubscribers calls registerPoolQueues with the same processTracker instance passed to createPoolModule({processTracker}). Single instance across the whole module — consistent with Phase 18 lifecycle pattern (which threads db + config + emit via deps)."
  - "Module.shutdown does NOT call pool.shutdown() per RESEARCH §Open Question 1. Rationale: current server/index.ts shutdown flow requires pool.shutdown to run AFTER jobService.shutdown (wait-for-running-jobs) but BEFORE app.close (plugin onClose hooks). If module.shutdown called pool.shutdown(), it would fire during app.close() — AFTER jobService.shutdown already finished — which is acceptable behavior. But that re-ordering is a behavior change (pool processes might get killed while jobService is mid-teardown-of-related-workers). Preserving Phase 15 Plan 06 ordering contract verbatim is the scope-preserving choice. A future phase (Phase 23 jobs keystone or Phase 27+ consolidation) may migrate pool.shutdown into module.shutdown as part of a broader shutdown-flow audit."

patterns-established:
  - "Mixed-mechanism module shutdown: a single module.shutdown() handles BOTH an in-process setInterval handle (healthChecker) AND a pg-boss worker id (reaper) in one idempotent call. Stopped-flag guards against double-close; offWork errors are logged-and-swallowed (not re-thrown) so a slow pg-boss shutdown doesn't block the in-process stop. Template for Phase 24 streaming (per-device preview + global metrics heartbeat) + Phase 22 observability (prom-client scrape handler + trace-tree bus subscriber)."
  - "DEVICE_BOOT name-only pattern: exporting a queue name constant (DEVICE_BOOT_QUEUE_NAME from queue/names.ts) WITHOUT calling boss.createQueue/schedule/work gives consumers in a later phase (Phase 23 jobs keystone) a forward-compat hook without Phase 20 runtime risk. pg-boss sends to un-registered queues trap at send-time, not at createQueue-time — so the absence of a consumer in Phase 20 is structurally safe AS LONG AS no Phase-20 code calls queue.send(DEVICE_BOOT_QUEUE_NAME). Verified via grep-guard: 0 calls to `queue.send.*DEVICE_BOOT` in the committed pool module."
  - "grep-guard structural assertions via readFileSync: lifecycle-ownership.spec.ts reads server/index.ts at test-load time + asserts absence of 4 string patterns + absence of 4 log-string literals via string .toMatch / .not.toContain. Fast (<10ms — no boot), deterministic (no Fastify app spin-up), and catches regressions where someone re-adds healthChecker.start back into server/index.ts in a future plan. Pattern applies to SC-style invariants that express 'X should NOT appear in Y'. Phase 22 SC 'streaming plugin MUST emit via module.emit, not direct bus.emit' can use the same harness."

requirements-completed: [MOD-06, QUEUE-06]

# Metrics
duration: 14min
completed: 2026-04-21
---

# Phase 20 Plan 03: Pool Module Factory + Plugin Rewire Summary

**createPoolModule factory lands (MOD-06) — wires per-module TypedBus<PoolRegistry> + persistEnvelope + makePoolEmitters and constructs PoolManager + HealthChecker with REAL emit, replacing the Plan 20-02 NOOP default; pool plugin rewritten as thin wirer with 4 decorators; server/pool/queue.ts gets registerPoolQueues for DEVICE_REAP pg-boss schedule (DEVICE_BOOT name-only); server/index.ts 8 lines deleted (healthChecker/reaper startup+shutdown — SC2 achieved); ProcessTracker.startReaper + reaperInterval removed, stop() no-op retained; 12 new tests in module.spec.ts + lifecycle-ownership.spec.ts (89/89 pool suite green).**

## Performance

- **Duration:** 14min
- **Started:** 2026-04-21T20:47:04Z
- **Completed:** 2026-04-21T21:01:51Z
- **Tasks:** 4 (all TDD)
- **Files modified:** 6 (queue.ts + internal/module.ts + plugin.ts + server/index.ts + process-tracker.ts + process-tracker.test.ts)
- **Files created:** 2 (module.spec.ts + lifecycle-ownership.spec.ts)

## Accomplishments

- `server/pool/queue.ts` (+86 lines net; 100 lines total) extends the 20-00 stub with the real `registerPoolQueues({fastify, processTracker, logger})` factory performing the canonical pg-boss 3-step sequence for `device.reap` ONLY: (1) `boss.createQueue(DEVICE_REAP, {policy:'stately', retryLimit:1, retryBackoff:true, retryDelay:30})`; (2) `queue.schedule(DEVICE_REAP, '* * * * *', {}, {singletonKey: DEVICE_REAP})`; (3) `queue.work(DEVICE_REAP, handler)` where handler calls `processTracker.reapOrphans()` + logs via logger.child with queue+jobId fields + re-throws for pg-boss retry accounting. Returns `{workerIds: [reapWorkerId]}`. **DEVICE_BOOT is NOT registered** (RESEARCH §Queue Semantics — Phase 23 jobs keystone owns the consumer; exporting the NAME constant gives Phase 23 a forward-compat hook without Phase 20 runtime risk).
- `server/pool/internal/module.ts` (+179 lines; overwrites 9-line throw-stub with 188-line factory) ships the real MOD-06 `createPoolModule({fastify, db, config, logger, processTracker})` factory returning `{pool, healthChecker, emit, bus, registerWorkersAndSubscribers, shutdown}` (6 keys). Factory constructs: per-module `TypedBus<PoolRegistry>`; persistEnvelope middleware (10-line duplicate — 5th sample site total, 4th module-level; Phase 27+ consolidation trigger); emit via `makePoolEmitters(bus, persistEnvelope)`; `pool = new PoolManager(config, processTracker, logger, emit)` + `healthChecker = new HealthChecker(pool, processTracker, logger, emit)` — BOTH with REAL emit (replaces Plan 20-02's NOOP_POOL_EMIT default). `registerWorkersAndSubscribers` calls `healthChecker.start(30_000)` + awaits `registerPoolQueues(...)` storing workerIds. `shutdown` is idempotent (stopped flag; calls `healthChecker.stop()` + `boss.offWork` per workerId + logs failures without re-throw; does NOT call `pool.shutdown()` — deferred per RESEARCH §Open Question 1 / server/index.ts ordering contract).
- `server/pool/plugin.ts` rewritten (48 → 82 lines) as thin Fastify wirer: `const processTracker = new ProcessTracker(logger)` instantiated at plugin scope; `const module = createPoolModule({fastify, db, config, logger, processTracker})` builds the module; platform drivers (android/ios from config.pool.*.enabled flags) registered on `module.pool` VERBATIM from v2.0; 4 `fastify.decorate` calls (`pool` = module.pool, `processTracker` = local instance, `healthChecker` = module.healthChecker, `poolModule` = module itself for barrel-friendly consumer access); `await module.registerWorkersAndSubscribers()` starts healthChecker + reaper schedule; `fastify.addHook('onClose', async () => await module.shutdown())` wires idempotent cleanup. **Dependencies extended** from `['config']` → `['config', 'db', 'queue', 'event-bus']` (db for persistEnvelope INSERTs, queue for boss/schedule/work/offWork, event-bus for structural substrate). **Plugin name unchanged** (`'pool-plugin'`) — 9+ downstream dep strings preserved.
- `server/index.ts` lines 209-215 + 245-251 DELETED (8 lines net removed — sequential step labels rewritten b→f for shutdown flow continuity, comment block rewritten to reflect new Phase 20 ownership). Verified via grep-guard: ZERO matches for `app.healthChecker.start`, `app.processTracker.startReaper`, `app.healthChecker.stop()`, `app.processTracker.stop()`, `'Health checker started'`, `'Process reaper started'`, `'Health checker stopped'`, `'Process reaper stopped'`. `app.pool.initPool()` (onReady), `await app.pool.shutdown()` (line 263, post-rename), `await app.jobService.shutdown()` (line 259) — all UNCHANGED per RESEARCH §Open Question 1 deferral. **SC2 achieved end-to-end**: pool plugin's onClose hook + `module.registerWorkersAndSubscribers()` fully own both the healthChecker setInterval lifecycle AND the reaper pg-boss schedule lifecycle.
- `server/pool/process-tracker.ts` (−13 lines net): `startReaper(intervalMs = 60000)` method REMOVED + `private reaperInterval: ReturnType<typeof setInterval> | null = null` field REMOVED (body migrated to `queue.ts` worker handler). `stop()` method RETAINED as no-op with explicit `Phase 20: reaper moved to pg-boss` comment — called from `PoolManager.shutdown` historical call sequence at line 333; converting to no-op (vs. deleting) preserves PoolManager.shutdown's untouched call graph as a Phase-20-scope-preserving choice. All OTHER public methods UNCHANGED: `register` / `unregister` / `killProcess` / `killAll` / `scanOrphans` / `reapOrphans` / `getTrackedPids`.
- `server/pool/__tests__/process-tracker.test.ts` (−26 lines net; Rule 3 auto-fix): 2 tests in `describe('reaper')` block (testing startReaper cadence + stop() clearing interval) DELETED — they referenced the now-removed `startReaper` method, causing TSC TS2339 "Property 'startReaper' does not exist". Direct Rule 3 (blocking issue) auto-fix: reaper LIFECYCLE coverage migrated to module.spec.ts (healthChecker.start + registerPoolQueues mock-assertion) + lifecycle-ownership.spec.ts (shutdown offWork + SC2 grep-guard). Describe block replaced with inline comment pointing at the new coverage owners.
- `server/pool/__tests__/module.spec.ts` NEW (139 lines, 7 tests, <500ms runtime): MOD-06 factory proofs via mock-based harness (no DB; vi.fn() for fastify.boss.createQueue/offWork + fastify.queue.schedule/work/send + drizzle-like makeMockDb). Test 1 asserts 6-key return (`['bus', 'emit', 'healthChecker', 'pool', 'registerWorkersAndSubscribers', 'shutdown']` via `Object.keys().sort()`). Test 2 asserts `pool instanceof PoolManager` + `healthChecker instanceof HealthChecker` + `bus instanceof TypedBus`. Test 3 asserts 4 emit methods match POOL_EVENT_NAMES count. Test 4 asserts registerWorkersAndSubscribers calls `healthChecker.start(30_000)` + `createQueue(DEVICE_REAP, {policy:'stately', retryLimit:1})` + `schedule(DEVICE_REAP, '* * * * *', ..., {singletonKey: DEVICE_REAP})` + `work(DEVICE_REAP, fn)`. Test 5 (MOD-08 g) asserts shutdown idempotency — second call has same offWork + stop call counts as first. Test 6 asserts shutdown calls `healthChecker.stop()` + `offWork('worker-reap-id')`. Test 7 asserts shutdown does NOT call `pool.shutdown()` (Open Question 1 deferral invariant).
- `server/pool/__tests__/lifecycle-ownership.spec.ts` NEW (69 lines, 5 tests, <500ms runtime): SC2 structural + behavioral proofs. Tests 1-3 use `readFileSync('server/index.ts', 'utf8')` to grep-assert absence of (a) `/app\.healthChecker\.start\b/` + `/startReaper\b/`; (b) `/app\.healthChecker\.stop\(\)/` + `/app\.processTracker\.stop\(\)/`; (c) 4 deleted log strings. Test 4 boots createPoolModule against a fully-mocked Fastify + ProcessTracker, calls registerWorkersAndSubscribers + shutdown, asserts healthChecker.start called once with 30_000 + healthChecker.stop called once + fastify.boss.offWork called with `'w-1'`. Test 5 uses readFileSync on `server/pool/plugin.ts` to regex-assert `dependencies: ['config', 'db', 'queue', 'event-bus']` shape.
- 89 pool tests green across all pool specs (77 pre-plan + 12 new). Full verification gates: `npx tsc --noEmit` shows 8 pre-existing errors unchanged (Phase 15 Map-vs-RequestContext + 2 working-tree artifacts/recording-service.ts edits + pipelines/schema.ts). Zero new errors on any plan 20-03 file. `npm run lint` clean. `npm run dep-check` shows 1 pre-existing violation (jobs/plugin.ts → bus/bus.ts, Phase 23 scope — carries forward unchanged per phase CONTEXT §Deferred).

## Task Commits

Each task was committed atomically:

1. **Task 3.1: registerPoolQueues factory** — `8f1087d` (feat) — server/pool/queue.ts +87/−6
2. **Task 3.2: createPoolModule factory** — `3f32367` (feat) — server/pool/internal/module.ts +179/−6 (overwrites stub)
3. **Task 3.3: Plugin thin wirer + index.ts cleanup + ProcessTracker reaper removal** — `2869b8c` (feat) — 4 files; +95/−96
4. **Task 3.4: module.spec.ts + lifecycle-ownership.spec.ts** — `42e77a8` (test) — 2 new spec files; +217

**Plan metadata commit:** created after SUMMARY.md write-out (docs: complete plan 20-03).

## Files Created/Modified

**Created:**
- `server/pool/__tests__/module.spec.ts` *(new, 139 lines)* — 7 tests under `describe('[Phase 20-03] createPoolModule factory (MOD-06)')`. Mock-based harness (makeMockFastify / makeMockDb / makeMockConfig helpers); zero DB. Covers 6-key return, instance typing, emit shape, registerWorkersAndSubscribers wiring, MOD-08 (g) idempotent shutdown, offWork-per-worker, pool.shutdown deferral invariant.
- `server/pool/__tests__/lifecycle-ownership.spec.ts` *(new, 69 lines)* — 5 tests under `describe('[Phase 20-03] pool lifecycle ownership (SC2)')`. 3 readFileSync-based grep-guards on server/index.ts absence invariants + 1 behavioral lifecycle symmetry test + 1 readFileSync plugin.ts dependencies-array shape assertion.

**Modified:**
- `server/pool/queue.ts` *(modified, +86 lines net)* — Imports `FastifyInstance` + `pino` + `ProcessTracker` type; exports `RegisterPoolQueuesDeps` + `PoolQueueRegistration` interfaces + `registerPoolQueues` async factory body. Constants preserved (DEVICE_REAP_QUEUE_NAME / DEVICE_BOOT_QUEUE_NAME / REAP_CRON).
- `server/pool/internal/module.ts` *(modified, +179 lines net — overwrites stub)* — Imports TypedBus + eventsTable + Database + AppConfig + Envelope types + PoolManager + HealthChecker + ProcessTracker + poolRegistry + makePoolEmitters + registerPoolQueues. Exports `CreatePoolModuleDeps` + `PoolModule` interfaces + `makePersistEnvelope` private function + `createPoolModule` main factory.
- `server/pool/plugin.ts` *(modified, +34/−0 net)* — Removed direct `new PoolManager(...)` + `new HealthChecker(...)` construction; replaced with `createPoolModule({...})` invocation + 4-decorator pattern + `await module.registerWorkersAndSubscribers()` + `onClose → await module.shutdown()`. Platform driver registration preserved verbatim. Dependencies extended + plugin name unchanged.
- `server/index.ts` *(modified, −8 lines net)* — DELETED 6 content lines from onReady (healthChecker.start + 2 log lines + startReaper + 1 log line + 1 blank separator); DELETED 6 content lines from shutdown (stop healthChecker + 1 log + stop processTracker + 1 log + 2 comment/blank separators); comment block at Graceful Shutdown header rewritten to reflect Phase 20 ownership; shutdown step labels rewritten b→f for sequence continuity. Lines `app.pool.initPool()`, `app.jobService.shutdown()`, `app.pool.shutdown()` UNCHANGED.
- `server/pool/process-tracker.ts` *(modified, −13 lines net)* — Removed `private reaperInterval` field + entire `startReaper(intervalMs)` method body (8 lines). `stop()` converted from interval-clearing body to documented no-op with `// Phase 20: reaper moved to pg-boss (server/pool/queue.ts). No interval to clear.` inline comment. All other public methods UNCHANGED.
- `server/pool/__tests__/process-tracker.test.ts` *(modified, −20 lines net)* — `describe('reaper')` block (2 tests) DELETED (Rule 3 auto-fix; TSC blocking issue on removed startReaper API). Replaced with inline comment pointing at module.spec.ts + lifecycle-ownership.spec.ts as new coverage owners.

## Decisions Made

- **ProcessTracker.stop() converted to no-op vs. deleted** — Preserves PoolManager.shutdown's untouched call graph at line 333; Phase-20-scope-preserving choice. Phase 20+ can delete entirely once PoolManager.shutdown migrates to module.shutdown-owned lifecycle.
- **2 reaper tests in process-tracker.test.ts removed inline (Rule 3 auto-fix)** over deferring or porting to module.spec.ts — The reaper cadence semantic moved from setInterval (tested by vi.advanceTimersByTime) to pg-boss schedule (tested by module.spec.ts asserting schedule call). Direct Rule 3 fix; no coverage lost.
- **4 decorators (pool + processTracker + healthChecker + poolModule)** over barrel-only — Preserves 9+ downstream back-compat readers (`app.pool`, `app.processTracker`, `app.healthChecker`) + adds new surface (`app.poolModule.bus.on(...)`) for Phase 24+ subscribers. Phase 27+ consolidation audits barrel-only migration.
- **registerPoolQueues receives processTracker via deps** (not imported at module-top) — Avoids implicit circular-import fragility; threads single ProcessTracker instance through createPoolModule → registerWorkersAndSubscribers → registerPoolQueues. Consistent with Phase 18 lifecycle pattern (db/config/emit via deps).
- **module.shutdown does NOT call pool.shutdown()** per RESEARCH §Open Question 1 — Preserves Phase 15 Plan 06 ordering contract (pool.shutdown runs AFTER jobService.shutdown but BEFORE app.close). A future phase (Phase 23 jobs keystone or Phase 27+ consolidation) may migrate pool.shutdown into module.shutdown as part of broader shutdown-flow audit.

## Deviations from Plan

**1. [Rule 3 - Blocking issue] Removed 2 reaper tests from server/pool/__tests__/process-tracker.test.ts**
- **Found during:** Task 3.3 (after ProcessTracker.startReaper deletion)
- **Issue:** `npx tsc --noEmit` reported TS2339 errors at lines 232 + 243: `Property 'startReaper' does not exist on type 'ProcessTracker'`. The 2 tests in the `describe('reaper')` block test the old setInterval-based reaper API that Task 3.3 removed.
- **Fix:** Deleted the entire `describe('reaper')` block (2 tests) + replaced with an inline comment pointing at `server/pool/__tests__/module.spec.ts` + `server/pool/__tests__/lifecycle-ownership.spec.ts` as the new coverage owners. The reaper LIFECYCLE is now tested in module.spec.ts (healthChecker.start + registerPoolQueues mock-assertion) + lifecycle-ownership.spec.ts (shutdown offWork + SC2 grep-guard).
- **Files modified:** server/pool/__tests__/process-tracker.test.ts
- **Commit:** 2869b8c (bundled with Task 3.3)
- **Scope boundary:** directly caused by this plan's ProcessTracker.startReaper deletion — inside-scope per deviation Rule 3 ("fix blocking issues directly caused by current task's changes").

No other deviations. All other tasks executed exactly as written — `registerPoolQueues` factory body verbatim per plan template, `createPoolModule` factory verbatim per plan template, plugin thin-wirer verbatim per plan template, server/index.ts deletion targets exact, 7 module.spec tests + 5 lifecycle-ownership tests all match plan's `<behavior>` block.

## Issues Encountered

None beyond the Rule 3 auto-fix documented above. Clean 4-task execution. TSC + lint + dep-check all match expected pre-existing counts (8 TSC errors unchanged; 1 dep-check violation unchanged; 0 lint issues). Pool test suite 89/89 green; 12 new tests pass on first run after the Plan 20-02 NOOP pattern established the 4-param constructor signature that this plan's `createPoolModule` bridges with REAL emit.

## Verification Gates

- `grep -q "registerPoolQueues" server/pool/queue.ts` → present
- `grep -q "fastify.boss.createQueue(DEVICE_REAP_QUEUE_NAME" server/pool/queue.ts` → present
- `grep -q "policy: 'stately'" server/pool/queue.ts` → present
- `grep -q "singletonKey: DEVICE_REAP_QUEUE_NAME" server/pool/queue.ts` → present
- `grep -q "fastify.queue.schedule" server/pool/queue.ts` → present
- `grep -q "fastify.queue.work<unknown>" server/pool/queue.ts` → present
- `grep -q "processTracker.reapOrphans()" server/pool/queue.ts` → present
- `grep -c "createQueue.*DEVICE_BOOT" server/pool/queue.ts` → 0 (DEVICE_BOOT NOT registered)
- `grep -c "queue.work.*DEVICE_BOOT" server/pool/queue.ts` → 0 (DEVICE_BOOT NOT registered)
- `grep -c "Plan 20-03 not yet executed" server/pool/internal/module.ts` → 0 (stub overwritten)
- `grep -q "export function createPoolModule" server/pool/internal/module.ts` → present
- `grep -q "new TypedBus(poolRegistry)" server/pool/internal/module.ts` → present
- `grep -q "new PoolManager(deps.config, deps.processTracker, logger, emit)" server/pool/internal/module.ts` → present
- `grep -q "new HealthChecker(pool, deps.processTracker, logger, emit)" server/pool/internal/module.ts` → present
- `grep -q "healthChecker.start(30_000)" server/pool/internal/module.ts` → present
- `grep -q "if (stopped) return" server/pool/internal/module.ts` → present
- `grep -q "healthChecker.stop()" server/pool/internal/module.ts` → present (inside shutdown)
- `grep -c "createPoolModule" server/pool/plugin.ts` → 3 (import + callsite + doc)
- `grep "dependencies: \['config', 'db', 'queue', 'event-bus'\]" server/pool/plugin.ts` → present
- `grep -c "fastify.decorate('poolModule'" server/pool/plugin.ts` → 1
- `grep -c "app.healthChecker.start" server/index.ts` → 0 (SC2 grep-guard)
- `grep -c "app.processTracker.startReaper" server/index.ts` → 0
- `grep -c "app.healthChecker.stop()" server/index.ts` → 0
- `grep -c "app.processTracker.stop()" server/index.ts` → 0
- `grep -c "Health checker started" server/index.ts` → 0
- `grep -c "Process reaper started" server/index.ts` → 0
- `grep -c "Health checker stopped" server/index.ts` → 0
- `grep -c "Process reaper stopped" server/index.ts` → 0
- `grep -c "startReaper" server/pool/process-tracker.ts` → 0 (method removed)
- `grep -c "private reaperInterval" server/pool/process-tracker.ts` → 0 (field removed)
- `grep -c "stop(): void" server/pool/process-tracker.ts` → 1 (retained as no-op)
- `grep -c "Phase 20: reaper moved to pg-boss" server/pool/process-tracker.ts` → 1 (documentation)
- `npx vitest run server/pool/__tests__/module.spec.ts` → 7 tests pass, exit 0
- `npx vitest run server/pool/__tests__/lifecycle-ownership.spec.ts` → 5 tests pass, exit 0
- `npx vitest run server/pool/__tests__/` → 89 tests pass across all pool specs (77 pre + 12 new), exit 0
- `npx tsc --noEmit` → 8 pre-existing errors unchanged; ZERO new errors on plan 20-03 files
- `npm run lint` → No issues found
- `npm run dep-check` → 1 pre-existing violation (jobs/plugin.ts → bus/bus.ts, Phase 23 scope); inherited from Plan 19-01

## Self-Check

**Files verified on disk:**

- FOUND: `server/pool/queue.ts` (registerPoolQueues + 3 constants)
- FOUND: `server/pool/internal/module.ts` (createPoolModule + persistEnvelope)
- FOUND: `server/pool/plugin.ts` (thin wirer + 4 decorators)
- FOUND: `server/index.ts` (8 lines deleted; step labels rewritten)
- FOUND: `server/pool/process-tracker.ts` (startReaper/reaperInterval removed; stop() no-op)
- FOUND: `server/pool/__tests__/process-tracker.test.ts` (reaper describe block removed)
- FOUND: `server/pool/__tests__/module.spec.ts` (7 MOD-06 tests)
- FOUND: `server/pool/__tests__/lifecycle-ownership.spec.ts` (5 SC2 tests)

**Commits verified in git log:**

- FOUND: `8f1087d` feat(20-03): registerPoolQueues factory for device.reap pg-boss schedule
- FOUND: `3f32367` feat(20-03): createPoolModule factory wires TypedBus + real emit + workers lifecycle
- FOUND: `2869b8c` feat(20-03): pool plugin thin wirer + server/index.ts cleanup + ProcessTracker reaper removed
- FOUND: `42e77a8` test(20-03): add module.spec.ts + lifecycle-ownership.spec.ts (MOD-06 + SC2 proofs)

**Acceptance criteria:**

- Task 3.1: 8/8 criteria pass (registerPoolQueues present, createQueue with policy:'stately' + retryLimit:1 + retryBackoff:true, schedule with singletonKey, work handler calling reapOrphans, DEVICE_BOOT not registered, return type shape, constants preserved, tsc clean)
- Task 3.2: 12/12 criteria pass (stub overwritten, createPoolModule exported, TypedBus constructed, PoolManager+HealthChecker with real emit, registerWorkersAndSubscribers wiring, idempotency guard, healthChecker.stop + offWork in shutdown, no pool.shutdown, persistEnvelope present, all imports resolve, exports correct, tsc clean)
- Task 3.3: 12/12 criteria pass (plugin thin wirer shape, 4 decorators, registerWorkersAndSubscribers + shutdown wiring, exact dependencies array, 0 server/index.ts healthChecker/reaper grep matches, 0 deleted log strings, preserved initPool + pool.shutdown lines, 0 startReaper/reaperInterval in process-tracker.ts, stop() no-op retained, all other public methods present, tsc clean)
- Task 3.4: 6/6 criteria pass (both spec files exist, 7 MOD-06 tests, 5 SC2 tests, readFileSync grep-guards, mock-based no-DB, vitest exit 0)

## Self-Check: PASSED

## Next Phase Readiness

- **Plan 20-04 (DB-gated proofs) UNBLOCKED** — createPoolModule factory now returns a real `{pool, healthChecker, emit, bus, ...}` that Plan 20-04 can boot against a real pg-boss instance + isolated pgboss_<suffix> schema. Plan 20-04 will prove: (a) `device.health.failed` envelope persisted to events table with correct aggregateType='pool' + aggregateId=deviceId + correlationId non-null (TRACE-08 + EVENTS-07); (b) end-to-end correlationId threads through asyncLocalStorage.run → allocate/release → release-envelope payload (TRACE-05); (c) reaper pg-boss schedule fires periodically + ALS restored per fire (Plan 18-00 Option B per-fire UUID generation).
- **Plan 20-05 (MODULE.md + barrel + Nyquist) UNBLOCKED** — createPoolModule factory + registerPoolQueues + plugin thin-wirer all shipped; MODULE.md §Public API can cite the 6-key factory return + 4-decorator plugin surface; §Events Emitted cites the 4 POOL_EVENT_NAMES with aggregateType='pool' + persisted:true for health.failed; §Queue Produced cites DEVICE_REAP (stately policy, '* * * * *' cron); §Queue Consumed cites DEVICE_BOOT name-only (Phase 23 scope); §Invariants (a)-(g) each cite a spec file (events.spec.ts / device-state.spec.ts / allocation.spec.ts / health-checker.spec.ts / module.spec.ts / lifecycle-ownership.spec.ts); §Dependencies cites the 4-string array matching plugin.ts verbatim.
- **Phase 22 Streaming** can lift the mixed-mechanism module.shutdown pattern for per-device preview (setInterval metrics pump + pg-boss frame-capture worker). Phase 23 Jobs Keystone can consume DEVICE_BOOT (name-only in Phase 20) via its own queue.work handler + subscribe to device.allocated/released via poolModule.bus.on (new barrel surface).
- **Phase 24 Streaming Device Preview** subscribes to `device.state.changed` bus envelopes via `app.poolModule.bus.on('device.state.changed', handler)` to auto-attach/detach preview streams as devices transition Booting↔Idle↔Allocated↔Running. The 4-decorator plugin exposes `app.poolModule` for this subscriber path without requiring a cross-module bus-coupling.
- **Phase 27 trace-tree** queries the events table for `aggregateType='pool'` + `type='device.health.failed'` rows to render health-failure subtrees per job correlationId. Plan 20-04 proves envelope persistence end-to-end; Phase 27 consumes the persisted events.

---
*Phase: 20-pool-module-devices*
*Completed: 2026-04-21*
