---
phase: 16-pilot-module-hooks
plan: 02
subsystem: hooks-module-refactor
tags: [fastify-plugin, factory-pattern, barrel, dependency-cruiser-prep, mod-02, mod-06, thin-wrap, typed-bus, persistEnvelope]

# Dependency graph
requires:
  - phase: 16-pilot-module-hooks
    provides: "server/hooks/schemas.ts (hookDefinitionSchema + HookDefinition + HookEvent), server/hooks/events.ts (hooksRegistry + HOOK_EVENT_NAMES + makeHookEmitters), server/hooks/queue.ts (HOOK_RUN_QUEUE_NAME + hookRunPayloadSchema + registerHookRunWorker), server/hooks/internal/idempotency.ts (DrizzleDb type)"
  - phase: 15-fix-operational-dependencies
    provides: "TypedBus, createEventHelpers, bus plugin (persistEnvelope pattern), queue plugin (fastify.boss + fastify.queue ALS-aware wrapper), onPersisted subscriber wrapper"
provides:
  - "server/hooks/index.ts — public barrel (MOD-02). ONLY import surface for consumers outside server/hooks/. Re-exports hooksPlugin, HookExecutor/HookError + HookContext/HookResult types, createHooksModule factory + HooksModule/CreateHooksModuleDeps types, hookDefinitionSchema + HookDefinition/HookEvent, hooksRegistry + HOOK_EVENT_NAMES + makeHookEmitters + 4 payload schemas + HooksRegistry/HookEmitters/HookEventName types, HOOK_RUN_QUEUE_NAME + hookRunPayloadSchema + registerHookRunWorker + HookRunPayload/RegisterHookRunWorkerDeps types"
  - "server/hooks/internal/module.ts — createHooksModule(deps): HooksModule factory (MOD-06). Per-module TypedBus<HooksRegistry>, persistEnvelope duplicated from bus plugin (10 lines, RESEARCH Open Question #1), emit helpers via makeHookEmitters, idempotent shutdown lifecycle"
  - "server/hooks/internal/subscribers.ts — wireBusToQueue(deps): () => void. The EVENTS-09 bus-to-queue bridge: translates test.trigger envelopes into hook.run pg-boss jobs with stable singletonKey = envelope.id:hook.name. Producer-side hookRunPayloadSchema.parse() before queue.send satisfies 16-01 must_haves truth"
  - "server/hooks/internal/hook-executor.ts — HookExecutor class body moved here (MOD-02 scope). server/hooks/hook-executor.ts is now a 3-line back-compat re-export so existing imports (server/index.ts, queue.ts, hook-run-handler.ts) keep resolving"
  - "server/hooks/plugin.ts — thin Fastify wrapper over createHooksModule. Decorates fastify.hookExecutor (back-compat) AND fastify.hooksModule (new surface). Dependencies array updated to ['config', 'event-bus', 'queue', 'pool-plugin']. onClose → module.shutdown() (idempotent)"
  - "server/hooks/__tests__/module.spec.ts — MOD-06 factory-shape + idempotent-shutdown contract spec. 4/4 tests pass WITHOUT a database (stubs boss.offWork + queue.send/work + onPersisted + db)"
affects: [16-03, 16-04, 20-pool, 21-artifacts, 23-jobs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Thin Fastify plugin wrapping a createXModule(deps) factory — the v3.0 canonical module shape (MOD-06). Plugin's sole responsibility: parse config → construct module → decorate fastify → registerBusSubscribers → wire onClose → module.shutdown()"
    - "Public barrel (index.ts) with dependency-cruiser prep: internal/ re-exports limited to the canonical factory entry point (createHooksModule from ./internal/module.js); all other internal/ paths (hook-executor, hook-run-handler, idempotency, subscribers) NOT re-exported — barrel will pass dep-cruiser's deep-import denylist in 16-03"
    - "persistEnvelope duplicated from bus plugin (10 lines) per RESEARCH Open Question #1 — keeps Phase 15 bus surface frozen; consolidation deferred to Phase 27+ when all modules have been refactored"
    - "Idempotent shutdown via stopped flag — shutdown() safe to call twice (onClose + test teardown both invoke it)"
    - "Back-compat re-export shim pattern: when a file moves under internal/, leave a 3-line re-export at the original path so existing imports keep working without call-site changes"

key-files:
  created:
    - server/hooks/index.ts
    - server/hooks/internal/module.ts
    - server/hooks/internal/subscribers.ts
    - server/hooks/internal/hook-executor.ts
    - server/hooks/__tests__/module.spec.ts
  modified:
    - server/hooks/hook-executor.ts (class body → 3-line back-compat re-export shim; HookContext/HookResult/HookEvent/HookDefinition types re-exported from ./internal/hook-executor.js)
    - server/hooks/plugin.ts (thin-wrap rewrite — imperative `new HookExecutor(fastify.log as any)` replaced by createHooksModule call; dual fastify.decorate for hookExecutor + hooksModule; dependencies array extended ['config', 'pool-plugin'] → ['config', 'event-bus', 'queue', 'pool-plugin']; onClose → module.shutdown; all 5 HTTP routes preserved verbatim)

key-decisions:
  - "persistEnvelope duplicated from bus plugin (10 lines) instead of exporting from bus plugin — keeps Phase 15 surface frozen; consolidation deferred to Phase 27+ per RESEARCH Open Question #1"
  - "Barrel only re-exports the canonical factory entry from internal/ (createHooksModule from ./internal/module.js); hook-executor, hook-run-handler, idempotency, subscribers are NOT re-exported from internal/ — the dep-cruiser rule in 16-03 will enforce the boundary structurally"
  - "Back-compat shim at server/hooks/hook-executor.ts preserves existing imports (server/index.ts line 13, queue.ts, internal/hook-run-handler.ts) without touching call sites — Phase 20+ can migrate consumers to import from the index.ts barrel and delete the shim"
  - "fastify.hookExecutor decorator retained (back-compat for server/index.ts line 127 imperative app.hookExecutor.execute('device.booted', ...) loop) alongside new fastify.hooksModule decorator (full HooksModule surface for Phase 20+ consumers) — dual decoration avoids touching server/index.ts in this plan"
  - "Plugin dependencies extended from ['config', 'pool-plugin'] to ['config', 'event-bus', 'queue', 'pool-plugin'] — per RESEARCH §8, the hooks module's onPersisted subscriber depends on the global event-bus plugin and the hook.run enqueue path depends on the queue plugin. pool-plugin literal string verified against fp(poolPlugin, {name: 'pool-plugin'}) in server/pool/plugin.ts:47"
  - "module.spec.ts stubs boss/queue/onPersisted/db with vi.fn() — no DB required, runs in 4ms. queue.spec.ts from 16-01 remains the DB-gated integration proof"
  - "Producer-side hookRunPayloadSchema.parse() validation in wireBusToQueue (subscribers.ts) — satisfies 16-01 must_haves truth 'producer-side validation happens in 16-02 subscriber'. Consumer-side .parse() in hook-run-handler.ts remains as defense-in-depth"

patterns-established:
  - "MOD-06 factory + thin-plugin wrap — server/hooks/ is the pilot; Phase 20/21/23 modules copy this shape"
  - "MOD-02 public barrel — server/hooks/index.ts exports only the public API; internal/ paths stay out of the barrel except for the canonical factory entry"
  - "persistEnvelope duplicated per module (not centralized) — accepted for Phase 16 pilot; future phases may revisit"
  - "Dual decoration during migration — old API (fastify.hookExecutor) + new API (fastify.hooksModule) both registered so Phase 20+ can migrate consumer-by-consumer without a big-bang cutover"

requirements-completed: [SPEC-02, MOD-02, MOD-06]

# Metrics
duration: 8min
completed: 2026-04-17
---

# Phase 16 Plan 02: Factory + Plugin Thin-Wrap + Public Barrel Summary

**createHooksModule(deps) factory + public index.ts barrel + thin plugin.ts wrapper — server/hooks/ now matches the v3.0 MOD-02/MOD-06 shape; HookExecutor class body moved under internal/; all 5 HTTP routes + SPEC-02 RFC 7807 validation preserved; 4/4 factory-shape tests pass; queue.spec.ts from 16-01 still passes (refactor does not regress functionality)**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-17T19:43:09Z
- **Completed:** 2026-04-17T19:51:16Z
- **Tasks:** 4
- **Files created:** 5
- **Files modified:** 2

## Accomplishments

- `server/hooks/internal/hook-executor.ts` houses the `HookExecutor` class body (moved intact; relative imports adjusted for the +1 level depth). Root `server/hooks/hook-executor.ts` is now a 3-line back-compat re-export so every existing import (`server/index.ts`, `server/hooks/plugin.ts`, `server/hooks/queue.ts`, `server/hooks/internal/hook-run-handler.ts`, etc.) keeps resolving.
- `server/hooks/internal/module.ts` exports `createHooksModule(deps): HooksModule` — the MOD-06 canonical factory. Constructs per-module `TypedBus<HooksRegistry>`, wraps `makeHookEmitters(bus, persistEnvelope)` (persistEnvelope is duplicated 10 lines from `server/bus/plugin.ts` per RESEARCH Open Question #1), starts the HOOK_RUN worker via `registerHookRunWorker` (plan 16-01), wires the bus-to-queue bridge via `wireBusToQueue` (new), and exposes an idempotent `shutdown()` that stops the worker + unsubscribes from the bus.
- `server/hooks/internal/subscribers.ts` exports `wireBusToQueue(deps)` — the EVENTS-09 bus-to-queue bridge. Subscribes to the synthetic `test.trigger` event via `onPersisted`, derives `singletonKey = ${envelope.id}:${hook.name}` (stable across replays), validates the queue payload via `hookRunPayloadSchema.parse()` BEFORE calling `queueSend` (producer-side defense per 16-01 must_haves), and emits `hook.scheduled` on the hooks bus after the send succeeds. Unsubscribe function returned so the factory's shutdown can tear it down.
- `server/hooks/plugin.ts` is a thin Fastify wrapper: parse config → construct module → decorate `fastify.hookExecutor` (back-compat) + `fastify.hooksModule` (new) → `module.registerBusSubscribers()` → register 5 HTTP routes (unchanged) → `onClose` → `module.shutdown()`. The old `new HookExecutor(fastify.log as any)` smell is eliminated. Dependencies extended to `['config', 'event-bus', 'queue', 'pool-plugin']`.
- `server/hooks/index.ts` is the public barrel (MOD-02) — the ONLY import surface for consumers outside `server/hooks/`. Exports 20+ public symbols (plugin, class, factory, schemas, events, queue contract). The only `./internal/` re-export is `createHooksModule` (canonical factory entry); `hook-executor`, `hook-run-handler`, `idempotency`, `subscribers` are NOT re-exported — dep-cruiser in 16-03 will structurally enforce the boundary.
- `server/hooks/__tests__/module.spec.ts` — 4 unit tests proving MOD-06 factory shape + shutdown idempotency. Runs without a database (stubs boss/queue/onPersisted/db via `vi.fn()`). 4/4 pass in ~4ms.

## Task Commits

Each task was committed atomically:

1. **Task 2.1: Move HookExecutor class under internal/; back-compat re-export** — `d8c8040` (refactor)
2. **Task 2.2: createHooksModule factory + wireBusToQueue subscriber** — `26a5b4f` (feat)
3. **Task 2.3: Rewrite plugin.ts as thin-wrap; preserve HTTP routes** — `1ee00f7` (refactor)
4. **Task 2.4: server/hooks/index.ts barrel + module.spec.ts** — `63f8826` (feat)

**Plan metadata commit:** (pending final docs commit)

## Files Created/Modified

### Created

- `server/hooks/internal/hook-executor.ts` — `HookExecutor` class body + `HookContext`/`HookResult`/`HookError` + `DEFAULT_TIMEOUT_MS`. Moved from `server/hooks/hook-executor.ts`; relative import paths adjusted (`../../types/index.js` + `../schemas.js`).
- `server/hooks/internal/module.ts` — `createHooksModule(deps): HooksModule` factory + `CreateHooksModuleDeps`/`HooksModule` types + private `makePersistEnvelope` (duplicated 10 lines from bus plugin).
- `server/hooks/internal/subscribers.ts` — `wireBusToQueue(deps): () => void` — the `test.trigger` → `hook.run` bridge subscriber with producer-side `hookRunPayloadSchema.parse()`.
- `server/hooks/index.ts` — public barrel exporting hooksPlugin + HookExecutor/HookError classes + HookContext/HookResult types + createHooksModule/HooksModule/CreateHooksModuleDeps + hookDefinitionSchema/HookDefinition/HookEvent + hooksRegistry/HOOK_EVENT_NAMES/makeHookEmitters/4 payload schemas/HooksRegistry/HookEmitters/HookEventName + HOOK_RUN_QUEUE_NAME/hookRunPayloadSchema/registerHookRunWorker/HookRunPayload/RegisterHookRunWorkerDeps.
- `server/hooks/__tests__/module.spec.ts` — 4 tests: [MOD-06] factory shape, hooks loaded from deps.hooks, shutdown() idempotent, shutdown() calls boss.offWork after registerBusSubscribers.

### Modified

- `server/hooks/hook-executor.ts` — rewritten as 3-line back-compat re-export shim. Re-exports `HookExecutor`/`HookError` values + `HookContext`/`HookResult`/`HookEvent`/`HookDefinition` types from `./internal/hook-executor.js`. The effective public surface for existing consumers is unchanged.
- `server/hooks/plugin.ts` — thin-wrap rewrite (186 → 192 lines). Key changes: (a) imperative `new HookExecutor(fastify.log as any)` replaced by `createHooksModule({fastify, db, logger, hooks})` call; (b) dual `fastify.decorate` for both `hookExecutor` (back-compat) and `hooksModule` (new surface); (c) `await module.registerBusSubscribers()` starts the pg-boss worker + bus bridge; (d) `onClose` → `module.shutdown()` (idempotent); (e) dependencies array extended to `['config', 'event-bus', 'queue', 'pool-plugin']`; (f) all 5 HTTP routes preserved verbatim — still operate on the same `HookExecutor` instance (now owned by the factory).

## Decisions Made

- **persistEnvelope duplicated from bus plugin (10 lines)** — RESEARCH Open Question #1 recommended duplication over exporting from bus plugin. Keeps Phase 15 bus plugin surface frozen; consolidation deferred to Phase 27+ when every module has been refactored and a common pattern has emerged. The duplication cost is minimal (10 lines of straightforward insert-into-events-table code) and the architectural cost of modifying the bus plugin during a pilot is high.
- **Barrel re-exports only `createHooksModule` from `./internal/module.js`** — the canonical factory entry point is the exception to the "no internal/ re-exports" rule. All other `internal/` paths (hook-executor, hook-run-handler, idempotency, subscribers) are NOT re-exported through the barrel, so the dep-cruiser rule in 16-03 will structurally prevent deep imports. Plan acceptance criteria explicitly allow this single exception.
- **Back-compat shim at `server/hooks/hook-executor.ts`** — four consumers import `HookExecutor` / `HookEvent` / `HookDefinition` / `HookContext` / `HookResult` from this path today: `server/index.ts` line 13, `server/hooks/plugin.ts`, `server/hooks/queue.ts`, `server/hooks/internal/hook-run-handler.ts`. Touching all four in this plan would violate scope (Phase 20+ migrates consumers to the barrel). The 3-line shim buys zero refactor noise.
- **Dual fastify decoration (hookExecutor + hooksModule)** — `server/index.ts` line 127 calls `app.hookExecutor.execute('device.booted', ...)` imperatively. That consumer migrates in Phase 20 (pool) when real `device.booted` events land on the bus. Until then, both decorators co-exist — the old surface stays wired, the new surface is available for opt-in.
- **Plugin dependencies array order `['config', 'event-bus', 'queue', 'pool-plugin']`** — matches substrate registration order in `server/index.ts` (config → correlation → db → event-bus → queue → telemetry → pool → ... → hooks). The `pool-plugin` literal string matches `fp(poolPlugin, {name: 'pool-plugin'})` at `server/pool/plugin.ts:47` (verified — CONTEXT.md line 75 incorrectly abbreviates to `'pool'`; the real fp name is `'pool-plugin'`).
- **module.spec.ts uses vi.fn() stubs, not a real DB** — the unit-level contract check fits in 4ms without requiring `TEST_DATABASE_URL`. queue.spec.ts (plan 16-01) remains the DB-gated integration proof and still passes after the refactor (verified: 2/2 tests green against `device_farm_test`).
- **Producer-side `hookRunPayloadSchema.parse()` in subscribers.ts** — satisfies 16-01 must_haves truth "producer-side validation happens in 16-02 subscriber". Malformed bridge payloads fail fast before reaching pg-boss. Consumer-side `.parse()` in hook-run-handler.ts remains as defense-in-depth.

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

### Typecheck: `npx tsc --noEmit`

- 7 pre-existing errors (baseline documented in 16-00-SUMMARY): 2 in `server/artifacts/recording-service.ts`, 1 in `server/bus/helpers.ts`, 1 in `server/bus/plugin.ts`, 2 in `server/events/__tests__/emit-helpers.spec.ts`, 1 in `server/pipelines/schema.ts`.
- **Zero new errors in `server/hooks/`** — confirmed via `npx tsc --noEmit 2>&1 | grep "server/hooks/"` → empty output.
- The refactor passes typecheck despite moving the class body, changing the plugin shape, and adding the public barrel.

### Lint: `npm run lint`

- Exit code 0, no warnings or errors.
- `no-direct-bus-emit` rule stays green: all `bus.emit(...)` usage in the hooks module routes through `makeHookEmitters` (allowlisted by `/\/events\.ts$/`) and the emit helpers passed into `wireBusToQueue`.
- `no-imperative-event-names` rule stays green: no string literals in `bus.emit(...)` calls outside events.ts.

### Tests: module.spec.ts (unit) + queue.spec.ts (integration, DB-gated)

**`npx vitest run server/hooks/__tests__/module.spec.ts`** — 4/4 passing in ~4ms:

```
 ✓ server/hooks/__tests__/module.spec.ts (4 tests) 4ms
   ✓ [MOD-06] returns {executor, emit, bus, registerBusSubscribers, shutdown}
   ✓ loads hooks from deps.hooks into the executor
   ✓ shutdown() is idempotent — calling twice does not throw
   ✓ shutdown() calls boss.offWork(workerId) after registerBusSubscribers()
```

**`TEST_DATABASE_URL=postgresql://heicg@localhost:5432/device_farm_test npx vitest run server/hooks/__tests__/queue.spec.ts`** — 2/2 passing:

```
 ✓ server/hooks/__tests__/queue.spec.ts (2 tests) 4245ms
     ✓ [Invariant c] duplicate replay produces exactly 1 hook_runs row and 1 hook invocation  2082ms
     ✓ [EVENTS-09] bus.on(test.trigger) handler enqueues hook.run via singletonKey  2024ms
```

**Without `TEST_DATABASE_URL`:** queue.spec.ts skips cleanly with `[hooks/queue.spec] SKIPPED: set TEST_DATABASE_URL to run`. module.spec.ts runs unaffected.

### Acceptance-criteria grep audit

- `grep -c "class HookExecutor" server/hooks/` → 1 (only in `internal/hook-executor.ts`) ✓
- `grep -c "new HookExecutor" server/hooks/plugin.ts` → 0 (imperative construction gone) ✓
- `grep -c "fastify\\.decorate\\('hookExecutor'" server/hooks/plugin.ts` → 1 (back-compat preserved) ✓
- `grep -c "fastify\\.decorate\\('hooksModule'" server/hooks/plugin.ts` → 1 (new surface) ✓
- `grep -c "dependencies: \\['config', 'event-bus', 'queue', 'pool-plugin'\\]" server/hooks/plugin.ts` → 1 ✓
- `grep -c "safeParse" server/hooks/plugin.ts` → 4 (SPEC-02: 3 validated routes + 1 config-parse loop; required ≥3) ✓
- `grep -c "https://device-farm/errors/validation" server/hooks/plugin.ts` → 2 (SPEC-02: POST + PUT routes both reference the validation URI; required ≥1) ✓
- `grep -cE "(type:|title:|status:|detail:)" server/hooks/plugin.ts` → 28 (SPEC-02: 4+ error responses × 3-4 fields each; required ≥12) ✓
- `grep -c "hookRunPayloadSchema.parse" server/hooks/internal/subscribers.ts` → 1 (producer-side validation; required ≥1) ✓
- `grep -c "onConflictDoNothing" server/hooks/internal/idempotency.ts` → 2 (plan 16-01 invariant preserved) ✓

### server/index.ts onReady compatibility

- `server/index.ts` line 127 calls `app.hookExecutor.execute('device.booted', ...)`. The new plugin decorates `fastify.hookExecutor` with `module.executor` (same `HookExecutor` class), so this path resolves without any changes to `server/index.ts`.
- Typecheck confirms: no errors reported for `server/index.ts` after the refactor.

### Fastify type augmentation

- The plugin adds `hookExecutor: HookExecutor` + `hooksModule: HooksModule` via additive `declare module 'fastify'` block. TypeScript merges this with the Phase 15 `bus` / `emit` / `onPersisted` / `boss` / `queue` / `db` / `pool` / `config` decorations already on `FastifyInstance` — no conflict observed. No type-augmentation issues surfaced.

### persistEnvelope duplication note

The factory's `makePersistEnvelope` copies ~30 lines (including comments) from `server/bus/plugin.ts` lines 80-112. The essential logic is 10 lines (`ee.emit` + conditional `db.insert` fire-and-forget). This is per RESEARCH Open Question #1's explicit recommendation to keep Phase 15 substrate frozen; consolidation is deferred to Phase 27+ when all modules have been refactored and a shared helper pattern emerges.

## Issues Encountered

None. The plan was prescriptive with type signatures + verbatim code blocks; all acceptance criteria passed on first try.

## User Setup Required

None - all changes are internal to the hooks module refactor.

For running the test suites locally:
```bash
# Unit tests (no DB required, fast)
npx vitest run server/hooks/__tests__/module.spec.ts

# Integration tests (needs device_farm_test DB with hook_runs table from 16-01)
TEST_DATABASE_URL="postgresql://heicg@localhost:5432/device_farm_test" npx vitest run server/hooks/__tests__/queue.spec.ts
```

## Next Phase Readiness

### Ready for 16-03 (dependency-cruiser config + CI)

- `server/hooks/internal/` now contains 5 files: `hook-executor.ts`, `hook-run-handler.ts`, `idempotency.ts`, `module.ts`, `subscribers.ts`. The dep-cruiser rule can target this directory structurally.
- `server/hooks/index.ts` is the public barrel — its export list is the ONLY path through which consumers outside `server/hooks/` should reach the module. dep-cruiser can enforce this by denying any import into `server/hooks/internal/**` from outside `server/hooks/**`.
- The barrel's single internal/ re-export (`createHooksModule` from `./internal/module.js`) is the ONE canonical factory entry point — the dep-cruiser rule should allow this specific re-export via a same-module scope (imports within `server/hooks/` may reach internal/ freely).

### Ready for 16-04 (MODULE.md + tests-as-spec)

- Public API surface locked: `hooksPlugin`, `HookExecutor` class (imperative), `createHooksModule` factory (MOD-06), `hookDefinitionSchema` (SPEC-01), 4 events registry, `HOOK_RUN` queue contract.
- `__tests__/` directory now has 2 spec files: `queue.spec.ts` (DB-gated integration) + `module.spec.ts` (unit). Both describe-tree structures can map to MODULE.md sections directly.
- HooksModule interface documented — ready for MODULE.md "Public API" section.

### Ready for 20-pool (consumer migration)

- `fastify.hookExecutor` back-compat surface retained — `server/index.ts` onReady loop keeps working.
- `fastify.hooksModule` new surface available — Phase 20 can opt into emitting `device.booted` envelopes on the bus, which will flow through the `wireBusToQueue` bridge once the subscriber is wired on the real `device.booted` event (currently wired only on `test.trigger` fixture).

### Open items carried from prior phases (unchanged)

- Mac Mini graceful-shutdown live observation deferred (Plan 15-06 task 6.2) — no impact on 16-02.
- 7 pre-existing typecheck errors in unrelated modules (artifacts/, bus/, pipelines/) — out-of-scope per deviation-rule scope boundary. Baseline documented in 16-00-SUMMARY; unchanged by this plan.
- persistEnvelope duplication (10 lines from bus plugin) — consolidation deferred to Phase 27+ per RESEARCH Open Question #1.

## Self-Check: PASSED

- All 5 created files present on disk
- All 2 modified files present on disk
- All 4 per-task commits (`d8c8040`, `26a5b4f`, `1ee00f7`, `63f8826`) in `git log`
- Typecheck baseline maintained (7 pre-existing, 0 new in hooks/)
- Lint clean
- module.spec.ts: 4/4 passing
- queue.spec.ts (16-01): 2/2 passing with DB (refactor does not regress)

---
*Phase: 16-pilot-module-hooks*
*Completed: 2026-04-17*
