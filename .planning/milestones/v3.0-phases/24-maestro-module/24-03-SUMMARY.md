---
phase: 24
plan: 03
subsystem: maestro
tags: [maestro, factory, MOD-06, internal-relocation, persistEnvelope-8th-sample, bus-subscriber, plugin-rewrite]
requires: [24-00, 24-01, 24-02]
provides: [createMaestroModule-factory, fastify.maestroModule-decorator, registerMaestroRoutes, makeDeviceBootedHandler]
affects: [server/maestro, server/pool, server/index.ts]
tech-stack:
  added: []
  patterns: [thin-plugin-wirer, deferred-onReady-cross-module-subscriber, idempotent-shutdown, 8th-persistEnvelope-sample, services-relocation-via-git-mv]
key-files:
  created:
    - server/maestro/routes.ts
    - server/maestro/internal/subscribers.ts
    - server/maestro/__tests__/module.spec.ts
  modified:
    - server/maestro/internal/module.ts
    - server/maestro/internal/hierarchy-service.ts
    - server/maestro/internal/appium-service.ts
    - server/maestro/internal/device-info-collector.ts
    - server/maestro/plugin.ts
    - server/maestro/__tests__/appium-service.test.ts
    - server/maestro/__tests__/hierarchy-service.test.ts
    - server/pool/index.ts
    - server/pool/MODULE.md
    - .planning/phases/24-maestro-module/deferred-items.md
decisions:
  - "Factory return shape is 7 keys (appiumService + hierarchyService + deviceInfoCollector + emit + bus + registerSubscribers + shutdown) — symmetric with Phase 22 streaming (no queue surface)."
  - "Cross-module subscriber (device.booted) deferred to fastify.addHook('onReady', ...) per Pitfall 2 — pool decorates poolModule.bus at step 8; maestro plugin runs at step 14; deferral is plugin-order agnostic."
  - "device.booted handler factored into server/maestro/internal/subscribers.ts (makeDeviceBootedHandler) for testability parity with Phase 21/23 patterns."
  - "8TH SAMPLE POINT for persistEnvelope confirmed (Phase 16 hooks → 18 lifecycle → 19 reporting → 20 pool → 21 artifacts → 22 streaming → 23 jobs → 24 maestro). DEFERRED-24-B kept open — do NOT consolidate in this phase."
  - "Plugin name 'maestro-plugin' PRESERVED for back-compat. Dependencies extended ['config', 'pool-plugin'] -> ['config', 'db', 'event-bus', 'pool-plugin'] (4 entries) per substrate convention."
  - "Three back-compat decorators (hierarchyService / appiumService / deviceInfoCollector) preserved alongside new maestroModule decorator — Phase 22/23 convention to avoid scope-creep across api/routes/*."
  - "hookExecutor.execute('device.booted', ...) at server/index.ts:175 EXPLICITLY PRESERVED — different surface (hooks-side, fires user-defined shell commands, not bus events). RESEARCH §Anti-Patterns warned against confusing the two; verified with grep."
metrics:
  duration_minutes: 14
  completed: 2026-05-08
  tasks: 4
  commits: 6
  files_changed: 13
  lines_added: ~720
  lines_deleted: ~340
  net: +380
---

# Phase 24 Plan 03: Wave 3 Factory + Migration Summary

The load-bearing migration of Phase 24. Five coupled changes landed atomically: 3 git mv relocations preserve blame on HierarchyService + AppiumService + DeviceInfoCollector under server/maestro/internal/; pool barrel + MODULE.md drop their DeviceInfoCollector references; createMaestroModule(deps) factory replaces the Plan 24-00 throw-stub with a 140-line body modeling Phase 22 streaming shape (8th persistEnvelope sample point, deferred onReady subscriber, idempotent shutdown); plugin.ts collapses 354 → 77 lines as a thin wirer with 4 decorators; module.spec proves factory shape + subscriber deferral + shutdown idempotency in 10 no-DB tests.

## Tasks Completed

| Task | Name                                        | Commit  | Files                                                                                                          |
| ---- | ------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| 3.1  | Three git mv + pool barrel + MODULE.md      | 79fe496 | server/maestro/internal/{hierarchy,appium,device-info}-service.ts (git mv 100%), server/pool/index.ts, MODULE.md |
| 3.2  | Extract routes from plugin.ts               | f72d9a3 | server/maestro/routes.ts (NEW, 308 lines)                                                                      |
| 3.3  | RED test + GREEN factory body               | f5025e1, 85dcf74 | server/maestro/__tests__/module.spec.ts, internal/module.ts, internal/subscribers.ts, test imports |
| 3.4  | Thin plugin.ts wirer                        | aa50647 | server/maestro/plugin.ts (354→77 lines)                                                                        |
| Rule-3 fix | Relative import paths after git mv    | baaa212 | server/maestro/internal/{device-info-collector,hierarchy-service}.ts (../types/ → ../../types/) + DEFERRED-24-D |

## Verification Results

```
1. blame preserved (git log --follow):
   - hierarchy-service: b2562b5 docs(M003)
   - appium-service:    3e79c03 feat(M005/S01)
   - device-info-collector: b2562b5 docs(M003)

2. pool barrel + MODULE.md cleaned:
   - server/pool/index.ts: DeviceInfoCollector export DELETED (1 comment line remains explaining the relocation)
   - server/pool/MODULE.md: DeviceInfoCollector bullet DELETED (0 grep hits)

3. zero old-path imports remain:
   - grep -rn 'from .*pool/device-info-collector' server/  →  0 hits

4. throw-stub replaced:
   - 'Plan 24-03 not yet executed' string  →  0 hits
   - createMaestroModule definition         →  1 hit

5. plugin.ts thin wirer:
   - line count                 →  77 (target < 100; was 354)
   - createMaestroModule call   →  4 hits (1 invocation + 3 docstring/import)
   - registerMaestroRoutes call →  3 hits (1 invocation + 2 docstring/import)
   - imperative loop ('for (const d of devices)') →  0 hits (DELETED)
   - deviceInfoCollector.collect →  0 hits (handler logic is in subscribers.ts)

6. fastify.addHook('onReady', ...) in plugin.ts →  1 hit (registerSubscribers deferral)

7. hookExecutor preserved in server/index.ts →  1 hit at line 175 (UNCHANGED)

8. routes.ts has 7 fastify.{get|post} registrations (6 GET + 1 POST as planned)

9. plugin deps extended to 4 entries: ['config', 'db', 'event-bus', 'pool-plugin']

10. Maestro tests: 41/41 passing (events.spec 6 + module.spec 10 + appium-service.test 11 + hierarchy-service.test 14)

11. TypeScript: 10 errors total (all pre-existing DEFERRED-15-A inheritance: bus/helpers.ts, bus/plugin.ts, pipelines/schema.ts). Zero new errors from Plan 24-03 files.
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Test files referenced moved source paths**
- **Found during:** Task 3.3 verification (`npx vitest run server/maestro/__tests__/`)
- **Issue:** `appium-service.test.ts` imported `'../appium-service.js'` (now gone) and `hierarchy-service.test.ts` imported `'../hierarchy-service.js'` + `'../hierarchy-service.js'` (HierarchyResult + HierarchyService, gone). Caused by Task 3.1 git mv to internal/.
- **Fix:** Updated 3 import paths to point to `'../internal/{appium,hierarchy}-service.js'`.
- **Files modified:** server/maestro/__tests__/appium-service.test.ts, server/maestro/__tests__/hierarchy-service.test.ts
- **Commit:** 85dcf74 (folded into Task 3.3 GREEN commit)

**2. [Rule 3 - Blocking issue] Service files had stale relative type imports**
- **Found during:** Task 3.4 verification (`npx tsc --noEmit`)
- **Issue:** `device-info-collector.ts` and `hierarchy-service.ts` imported `'../types/index.js'` — this resolved correctly at the OLD top-level location (`server/{maestro,pool}/`) but after Task 3.1 git mv to `server/maestro/internal/`, the relative path needed one more directory hop (`'../../types/index.js'`).
- **Fix:** Updated 2 imports to `'../../types/index.js'`.
- **Files modified:** server/maestro/internal/device-info-collector.ts, server/maestro/internal/hierarchy-service.ts
- **Commit:** baaa212

### Deferred (Out of Scope)

**DEFERRED-24-D: Pre-existing semgrep ReDoS warnings in hierarchy-service.ts**
- Lines 372, 503, 899, 906 use `new RegExp(...)` with function-argument patterns (CWE-1333).
- Pre-existing — predates Phase 24 (blame trace: b2562b5 / d4c5da0).
- Out of scope per Plan 24-03 scope boundary; logged in `.planning/phases/24-maestro-module/deferred-items.md` for Phase 25 maestro hardening or Phase 30 test migration cleanup.

**12 pre-existing test failures (HEAD~6 baseline)** — pool/__tests__/module.spec.ts (5), pool/__tests__/lifecycle-ownership.spec.ts (1), streaming/__tests__/module.spec.ts (1), streaming/__tests__/lifecycle-ownership.spec.ts (2), artifacts/__tests__/lifecycle-ownership.spec.ts (3). All caused by Plan 24-01's pool registry extension (4 → 5 events with `device.booted`) breaking spec-side count assertions. Verified pre-existing via `git checkout HEAD~6 -- server/` re-run. Not caused by Plan 24-03; out of scope per scope-boundary rule. Plan 24-04 (DB-gated proofs) and Plan 24-05 (phase close) own the spec updates.

## Authentication Gates

None.

## Decisions Made

1. **Factory shape: 7 keys.** Returned `{appiumService, hierarchyService, deviceInfoCollector, emit, bus, registerSubscribers, shutdown}` — mirrors Phase 22 streaming (no queue surface, no scheduled jobs, no idempotency table).
2. **Subscriber split into subscribers.ts.** Created `server/maestro/internal/subscribers.ts` exporting `makeDeviceBootedHandler(deps)` for testability parity with Phase 21/23. Module.ts wires the subscription via `poolModule.bus.on('device.booted', handler)` — handler logic lives in subscribers.ts.
3. **8TH persistEnvelope sample copied verbatim.** Per DEFERRED-24-B explicit guidance, the persistEnvelope middleware was copied byte-for-byte from `server/streaming/internal/module.ts:106-137` — no consolidation in this phase. Phase 27+ owns the shared-helper extraction.
4. **Plugin name 'maestro-plugin' preserved; deps extended to 4 entries.** Plugin name unchanged for plugin-order.spec compatibility; dependencies array grew from `['config', 'pool-plugin']` to `['config', 'db', 'event-bus', 'pool-plugin']` to satisfy factory needs (db for persistEnvelope short-circuit + event-bus for substrate convention).
5. **Three back-compat decorators preserved.** `fastify.{hierarchyService, appiumService, deviceInfoCollector}` decorators retained alongside new `fastify.maestroModule` to avoid forced rewrites of consumers (api/routes, hooks, etc.). Routes.ts uses the back-compat decorators (NOT `fastify.maestroModule.hierarchyService`) to keep one form per spec direction.
6. **hookExecutor surface explicitly untouched.** `server/index.ts:175` `app.hookExecutor.execute('device.booted', ...)` is a different surface (hooks-side, fires user-defined shell commands triggered by the lifecycle plugin) and was explicitly preserved per RESEARCH §Anti-Patterns. Verified zero references to deviceInfoCollector remain in server/index.ts.

## Plan 24-04 Entry Points

- **subscriber.spec.ts (DB-gated):** Round-trip proof that `pool.emit.deviceBooted(deviceId, payload)` → `fastify.poolModule.bus` → `maestro.registerSubscribers` device.booted handler → `deviceInfoCollector.collect()` returns metadata → `fastify.pool.getDeviceMap().get(deviceId).metadata` mutated → `emit.deviceInfoCollected(...)` → events row written if persistence flipped (today: persisted:false; transient — proof reads ws-side or bus-side log). Uses Phase 23 jobs/__tests__/subscriber.spec.ts pattern with isolated pgboss schema.
- **correlation.spec.ts (DB-gated):** Single correlationId threads `asyncLocalStorage.run` → pool.emit.deviceBooted → maestro device.booted handler → emit.deviceInfoCollected. Phase 22 streaming/correlation.spec.ts is the closest template.
- **lifecycle-ownership.spec.ts:** readFileSync grep-guards proving `for (const d of devices)` count is 0 in plugin.ts (already passing) + `deviceInfoCollector.collect` count outside subscribers.ts/module.ts is 0 (already passing — only routes.ts uses it for /info/refresh which is fine) + zero direct `bus.emit(...)` calls outside events.ts in maestro/.

## Plan 24-05 Entry Points

- **MODULE.md 9-section body:** Replace Plan 24-00 placeholder with full canonical body (Purpose / Public API / Events Emitted / Events Consumed / Queue Produced [None] / Queue Consumed [None] / Invariants / Non-Goals / Dependencies + Runnable Example).
- **index.ts barrel expansion:** Add back-compat re-exports: `HierarchyService`, `AppiumService`, `DeviceInfoCollector`, plus events surface (`maestroRegistry`, `MAESTRO_EVENT_NAMES`, etc.). Currently barrel only re-exports `createMaestroModule + MaestroModule`.
- **.test.ts → .spec.ts renames:** `appium-service.test.ts → .spec.ts`, `hierarchy-service.test.ts → .spec.ts` via `git mv` 100% similarity (MOD-04 closure for maestro).
- **plugin-order.spec extension:** Add 4 additive Phase 24 assertions (3 positional + 1 structural readFileSync regex-extract verifying canonical 4-entry `dependencies: ['config', 'db', 'event-bus', 'pool-plugin']` literal from `server/maestro/plugin.ts`); existing Phase 17-23 assertions byte-for-byte preserved.
- **Pool/streaming/artifacts pre-existing failures resolution:** 12 pre-existing test failures (logged above + pre-Plan-24-03 baseline) need spec-side updates to reflect 5-event poolRegistry. Likely covered by Plan 24-04 spec rewrites OR Plan 24-05 phase-close sweep.
- **Nyquist gate:** Verify -2pp delta budget holds. Phase 24 net +380 lines (factory body + subscribers.ts + routes.ts + module.spec - imperative deletions); expect modest delta given simultaneous numerator+denominator growth (similar shape to Phase 21/23).

## Self-Check: PASSED

All claimed files verified:
- server/maestro/routes.ts FOUND
- server/maestro/internal/subscribers.ts FOUND
- server/maestro/__tests__/module.spec.ts FOUND
- server/maestro/internal/module.ts MODIFIED (throw-stub gone; createMaestroModule defined)
- server/maestro/plugin.ts MODIFIED (77 lines, was 354)
- server/pool/index.ts MODIFIED (DeviceInfoCollector export gone)
- server/pool/MODULE.md MODIFIED (DeviceInfoCollector bullet gone)
- 3 git-mv'd files at server/maestro/internal/* exist
- .planning/phases/24-maestro-module/deferred-items.md FOUND (DEFERRED-24-D entry)

All claimed commits verified via `git log`:
- 79fe496 FOUND (Task 3.1)
- f72d9a3 FOUND (Task 3.2)
- f5025e1 FOUND (Task 3.3 RED)
- 85dcf74 FOUND (Task 3.3 GREEN)
- aa50647 FOUND (Task 3.4)
- baaa212 FOUND (Rule-3 fix)
