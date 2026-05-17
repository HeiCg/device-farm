---
phase: 24-maestro-module
plan: 04
subsystem: testing
tags: [maestro, vitest, db-gated, subscriber-spec, correlation-spec, lifecycle-ownership, als, typed-bus, persist-envelope-side-channel]

# Dependency graph
requires:
  - phase: 24-maestro-module
    provides: createMaestroModule factory + makeDeviceBootedHandler subscriber + thin plugin.ts (post-Plan-24-03)
  - phase: 22-streaming-module
    provides: persistEnvelope side-channel pattern (`${type}.envelope` ee.emit) + DB-gated subscriber.spec/correlation.spec/lifecycle-ownership.spec template
  - phase: 23-jobs-module-keystone
    provides: stripComments helper + readFileSync grep-guard pattern + ALS plain-object store shape canonical
  - phase: 20-pool-module
    provides: poolModule.bus + poolModule.emit.booted (Phase 24 / Plan 24-01) decorator surface
provides:
  - subscriber.spec proving SC2 device.booted round-trip end-to-end (5 DB-gated tests)
  - correlation.spec proving TRACE-04 + SC3f ALS correlationId thread (3 DB-gated tests)
  - lifecycle-ownership.spec proving SC1 architectural invariants (6 readFileSync grep-guards including hookExecutor preservation guard)
affects: [24-05, 27+ (causation thread cross-module — DEFERRED-24-D)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DB-gated spec via describe.skipIf(!HAS_DB) with TEST_DATABASE_URL ?? DATABASE_URL fallback"
    - "Decorator-surface bus subscription (a.maestroModule.bus / a.poolModule.emit) per RESEARCH Pitfall 5 — fresh TypedBus would not receive factory emissions"
    - "vi.spyOn DeviceInfoCollector.collect to avoid real adb/xcrun calls (manual-only verification per VALIDATION.md)"
    - "persistEnvelope side-channel envelope capture: `${type}.envelope` ee.emit fires before persisted:false short-circuit (Phase 22 streaming envelope.spec inheritance)"
    - "ALS preservation across await: asyncLocalStorage.run wraps emission + setTimeout(100) inside the run frame; subscriber's emit.deviceInfoCollected reads correlationId via createEventHelpers/readAls within the same fiber"
    - "stripComments helper removes JSDoc references to anti-patterns so grep-guards measure REAL CODE only"
    - "Ephemeral pgboss schemas per spec: pgboss_maestro_sub_<random> + pgboss_maestro_corr_<random> for parallel-safety"

key-files:
  created:
    - server/maestro/__tests__/subscriber.spec.ts (SC2 / EVENTS-10 — 5 DB-gated tests)
    - server/maestro/__tests__/correlation.spec.ts (TRACE-04 / SC3f — 3 DB-gated tests)
    - server/maestro/__tests__/lifecycle-ownership.spec.ts (SC1 — 6 readFileSync grep-guards)
  modified: []

key-decisions:
  - "TRACE-09 causationId thread cross-module DEFERRED to Phase 27+ as DEFERRED-24-D — maestro subscribes via TypedBus.on (NOT fastify.onPersisted) so currentEventId is not auto-injected into ALS by the bus plugin's subscriber wrapper. Acknowledged by Plan 24-04 NOTE block in Task 4.2."
  - "lifecycle-ownership.spec test (b) scoped to plugin.ts only (NOT all of server/maestro/) — server/maestro/routes.ts legitimately calls deviceInfoCollector.collect for HTTP route handlers (GET /api/devices/:id/device-info); the SC1 invariant is specifically that the IMPERATIVE ONREADY LOOP in plugin.ts is gone, not that all collect calls disappear."
  - "lifecycle-ownership.spec test (e) reads server/index.ts RAW (no stripComments) and asserts hookExecutor.execute('device.booted') STILL EXISTS — explicit guard against future deletion per RESEARCH Anti-Patterns. Different surface from the bus-driven subscriber; both coexist."
  - "subscriber.spec test 1 mocks collect with full DeviceMetadata shape (13 fields) but tests 2-5 mock with thin {osVersion, model} only — payload assertions only inspect those two fields per maestroDeviceInfoCollectedPayload schema, so thin mock suffices."

patterns-established:
  - "Cross-module bus subscriber proof pattern (8th sample point): build full app via Fastify with stub config/auth + real correlation/db/event-bus/queue/pool/maestro plugins → vi.spyOn the downstream service (deviceInfoCollector.collect) → fire upstream emission via decorator surface (poolModule.emit.booted) → setTimeout(100) for async handler propagation → assert downstream side-effects (collect args, deviceMap.metadata mutation, side-channel envelope capture)."
  - "Plain-object ALS shape canonical: asyncLocalStorage.run({correlationId, currentEventId: null, actor} as never, async () => { emit; await setTimeout(N) }) — N must be inside the run frame so the subscriber's nested emit.deviceInfoCollected runs while ALS is active."

requirements-completed: [TRACE-04, MOD-08]

# Metrics
duration: 8min
completed: 2026-05-08
---

# Phase 24 Plan 04: DB-gated proofs (subscriber + correlation + lifecycle-ownership) Summary

**3 spec files (~789 lines) prove Phase 24 SC1 (lifecycle ownership), SC2 (device.booted round-trip), and TRACE-04 (ALS correlationId thread cross-module) — closing the proof gates for Phase 24 close in Plan 24-05.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-08T09:50:00Z (approx — sub-spec execution sequential)
- **Completed:** 2026-05-08T09:58:00Z
- **Tasks:** 3 (all TDD-style: write spec → run → green)
- **Files created:** 3

## Accomplishments

- **SC2 proven end-to-end (subscriber.spec, 5 tests):** device.booted on poolModule.bus → maestro subscriber → DeviceInfoCollector.collect (mocked) → Device.metadata mutated in pool's deviceMap → maestro.device-info.collected envelope emitted with payload {deviceId, osVersion, model}. Includes failure-path test (collect rejects → handler swallows → no envelope) + isolation test (3 concurrent device.booted events handled independently).
- **TRACE-04 / SC3f proven (correlation.spec, 3 tests):** ALS correlationId threads from `asyncLocalStorage.run` wrapping `poolModule.emit.booted` through to the maestro subscriber's nested `emit.deviceInfoCollected` envelope (correlationId === expected). Includes ALS-missing fallback (UUID-shaped correlationId) + concurrent ALS context isolation (corrA / corrB don't cross-contaminate).
- **SC1 proven structurally (lifecycle-ownership.spec, 6 tests):** Pure readFileSync grep-guards prove (a) no source file imports from old `pool/device-info-collector` path; (b) `server/maestro/plugin.ts` has zero `deviceInfoCollector.collect(` calls; (c) zero `for (const d of devices)` loop body in plugin.ts; (d) exactly 1 `fastify.addHook('onReady'` in plugin.ts (the registerSubscribers deferral); (e) `server/index.ts` STILL HAS `hookExecutor.execute('device.booted'` (preserved per RESEARCH Anti-Patterns); (f) subscribers.ts holds the relocated `deviceInfoCollector.collect(` call.

## Task Commits

Each task was committed atomically:

1. **Task 4.1: subscriber.spec.ts (DB-gated SC2 proof, 5 tests)** — `d70a60a` (test)
2. **Task 4.2: correlation.spec.ts (DB-gated TRACE-04 proof, 3 tests)** — `6a5cf52` (test)
3. **Task 4.3: lifecycle-ownership.spec.ts (readFileSync grep-guards, 6 tests)** — `3e3b5c6` (test)

**Plan metadata:** _pending final docs commit_

_Note: All 3 tasks landed via single TDD commit each (write green, no RED phase needed because the source under test was already shipped by Plan 24-03 — these are post-hoc proofs of Plan 24-03's work)._

## Files Created/Modified

- `server/maestro/__tests__/subscriber.spec.ts` (347 lines) — 5 DB-gated end-to-end tests proving SC2; mocks `app.maestroModule.deviceInfoCollector.collect` (vi.spyOn); fires `app.poolModule.emit.booted(...)`; captures `maestro.device-info.collected.envelope` via `(app.maestroModule.bus as any).ee.on(...)` side-channel. Skips cleanly when no DB env var set.
- `server/maestro/__tests__/correlation.spec.ts` (273 lines) — 3 DB-gated tests proving TRACE-04 ALS correlationId thread + ALS-missing fallback + concurrent ALS isolation. Same harness shape as subscriber.spec; uses `asyncLocalStorage.run({correlationId, currentEventId: null, actor} as never, async () => { emit; await setTimeout(100) })` plain-object shape canonical per Phase 20.
- `server/maestro/__tests__/lifecycle-ownership.spec.ts` (169 lines) — 6 readFileSync grep-guards. Pure structural — no DB, no Fastify boot. Includes `stripComments` helper (Phase 23 pattern) so JSDoc references to anti-patterns don't false-positive. Test (e) reads `server/index.ts` RAW to assert `hookExecutor.execute('device.booted'` STILL EXISTS (preservation guard).

## Decisions Made

- **TRACE-09 causationId DEFERRED to Phase 27+ (DEFERRED-24-D):** Maestro subscriber consumes pool bus events via `poolModule.bus.on('device.booted', handler)` (TypedBus.on, NOT `fastify.onPersisted`). Only `onPersisted` sets `currentEventId` into ALS for causation auto-propagation (server/bus/plugin.ts:120-141). Therefore causationId on the maestro envelope will be null in this path. Plan 24-04's Task 4.2 NOTE block explicitly permits omitting the causation test and documenting this deferral. The 3 correlation.spec tests cover correlationId thread + ALS isolation only — TRACE-09 cross-module causation needs subscriber-side envelope-aware emit, deferred to Phase 27+.
- **Test (b) scope plugin.ts only (NOT all server/maestro/):** `server/maestro/routes.ts` legitimately calls `deviceInfoCollector.collect` from HTTP route handlers (`GET /api/devices/:id/device-info`). The SC1 invariant is that the IMPERATIVE BOOT-TIME LOOP is gone from plugin.ts, not that all collect calls in the module disappear. This matches Plan 24-04's actual acceptance criteria text and the post-Plan-24-03 codebase shape.
- **subscriber.spec mocks: full vs thin shape per test:** Test 1 mocks `collect` with the full `DeviceMetadata` (13 fields) for type-shape assertion; tests 2-5 mock with `{osVersion, model}` thin objects because the maestro envelope payload (`maestroDeviceInfoCollectedPayload`) only references those two fields plus deviceId. Thin mocks pass the schema and reduce test noise.

## Deviations from Plan

None - plan executed exactly as written.

The plan author's NOTE in Task 4.2 explicitly anticipated the TRACE-09 causation gap and prescribed the deferral path (DEFERRED-24-D for Phase 27+). That deferral is part of the plan, not a deviation.

The plan author's NOTE in Task 4.3 explicitly prescribed test (f) fallback (subscribers.ts vs module.ts depending on Plan 24-03's split decision); Plan 24-03 chose subscribers.ts so test (f) reads subscribers.ts. Both shapes accepted by the spec — not a deviation.

---

**Total deviations:** 0
**Impact on plan:** Plan ran clean. All acceptance criteria met on first execution. Zero new TypeScript errors. Zero source-file modifications (purely test additions).

## Issues Encountered

- **None during execution.** All 3 specs passed on first run. Suite total: 55 tests / 55 pass / 0 fail in maestro/__tests__/ with `DATABASE_URL=postgresql://heicg@localhost:5432/device_farm`.

## Verification

```bash
# 1. All 3 spec files exist
test -f server/maestro/__tests__/subscriber.spec.ts             # OK
test -f server/maestro/__tests__/correlation.spec.ts            # OK
test -f server/maestro/__tests__/lifecycle-ownership.spec.ts    # OK

# 2. All 3 specs pass with DB env var
DATABASE_URL=postgresql://heicg@localhost:5432/device_farm \
  npx vitest run server/maestro/__tests__/                       # 55/55 pass

# 3. Lifecycle-ownership passes WITHOUT DB env var (pure readFileSync)
npx vitest run server/maestro/__tests__/lifecycle-ownership.spec.ts  # 6/6 pass

# 4. Zero new TypeScript errors on the 3 new files
npx tsc --noEmit 2>&1 | grep -c "server/maestro/__tests__/"     # 0

# 5. Acceptance criteria grep counts (subscriber.spec)
grep -c "a\.maestroModule\.bus" server/maestro/__tests__/subscriber.spec.ts          # 3 (decorator surface)
grep -c "a\.poolModule\.emit\.booted" server/maestro/__tests__/subscriber.spec.ts    # 5 (decorator emission)
grep -c "skipIf(!HAS_DB)" server/maestro/__tests__/subscriber.spec.ts                # 1 (DB-gating)
grep -c "vi\.spyOn.*deviceInfoCollector" server/maestro/__tests__/subscriber.spec.ts # 5 (mocked collect)

# 6. Acceptance criteria grep counts (correlation.spec)
grep -c "asyncLocalStorage\.run" server/maestro/__tests__/correlation.spec.ts                # 3 (3 tests use run)
grep -c "maestro\.device-info\.collected\.envelope" server/maestro/__tests__/correlation.spec.ts  # 1 (side-channel)

# 7. Acceptance criteria grep counts (lifecycle-ownership.spec)
grep -c "readFileSync" server/maestro/__tests__/lifecycle-ownership.spec.ts      # 4 (helper + 2 reads + import)
grep -c "describe" server/maestro/__tests__/lifecycle-ownership.spec.ts          # 2 (import + describe block)
```

## SC1 / SC2 / TRACE-04 Coverage Map

| Success Criterion | Covered By | Test Count |
|-------------------|-----------|------------|
| SC1 — old import path dead | lifecycle-ownership (a) | 1 |
| SC1 — imperative loop deleted from plugin.ts | lifecycle-ownership (b)(c) | 2 |
| SC1 — onReady deferral present (1 hit) | lifecycle-ownership (d) | 1 |
| SC1 — hookExecutor loop preserved (different surface) | lifecycle-ownership (e) | 1 |
| SC1 — collect call relocated to subscribers.ts | lifecycle-ownership (f) | 1 |
| SC2 — device.booted → collect with payload args | subscriber test 1 | 1 |
| SC2 — collect → Device.metadata mutated | subscriber test 2 | 1 |
| SC2 — collect → maestro envelope emitted | subscriber test 3 | 1 |
| SC2 — collect rejects → no propagation, no emit | subscriber test 4 | 1 |
| SC2 — concurrent device.booted handled independently | subscriber test 5 | 1 |
| TRACE-04 / SC3f — ALS cid threads cross-module | correlation test 1 | 1 |
| TRACE-04 fallback — no ALS → UUID-shaped cid | correlation test 2 | 1 |
| TRACE-04 isolation — concurrent ALS contexts | correlation test 3 | 1 |
| **Total** | | **14** |

## Plan 24-05 Entry Points

Plan 24-05 (close) inherits a fully-proven Phase 24:

- **MODULE.md 9-section body:** server/maestro/MODULE.md placeholder (Plan 24-00) → 9-section canonical body. Reference Phase 22-05 / 23-07 templates.
- **index.ts barrel expansion:** Currently single internal/module.ts re-export — Plan 24-05 expands to full named exports list (8-12 surface symbols). MOD-02 invariant.
- **.test.ts → .spec.ts renames:** `appium-service.test.ts` + `hierarchy-service.test.ts` (2 files) need `git mv` to `.spec.ts`. MOD-04 closure for maestro.
- **plugin-order.spec extension:** Add maestro positional + structural assertions (canonical dependencies array `['config', 'db', 'event-bus', 'pool-plugin']`).
- **deferred-items.md:** Catalog Phase 24 deferrals — DEFERRED-24-A (8th persistEnvelope sample → Phase 27+), DEFERRED-24-B (causation thread cross-module → Phase 27+, recorded as DEFERRED-24-D in this summary's decisions), plus carry-forwards from Phase 22/23.
- **STATE/ROADMAP update:** Phase 24 CLOSED, Phase 25 unblocked.
- **Nyquist gate:** `npm run nyquist:check` delta within -2pp budget.

## Self-Check: PASSED

- All 3 spec files exist (verified via `test -f`)
- All 3 commits exist (d70a60a, 6a5cf52, 3e3b5c6 verified via `git log --oneline -5`)
- 55/55 tests pass in `server/maestro/__tests__/` with DATABASE_URL set
- 6/6 lifecycle-ownership tests pass without DB env var
- Zero new TypeScript errors on the 3 new test files

---
*Phase: 24-maestro-module*
*Completed: 2026-05-08*
