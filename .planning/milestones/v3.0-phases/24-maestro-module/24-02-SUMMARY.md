---
phase: 24-maestro-module
plan: 02
subsystem: pool
tags: [pool, emit-sites, device-booted, mod-08, sc3h, tdd, phase-20-inheritance]

# Dependency graph
requires:
  - phase: 24-maestro-module
    plan: 01
    provides: "deviceBootedPayload schema + 5th BOOTED registry entry + makePoolEmitters().booted helper + NOOP_POOL_EMIT extended"
  - phase: 20-pool-module-devices
    plan: 02
    provides: "4-emit-site PoolManager pattern (state.changed/allocated/released/healthFailed) — Plan 24-02 mirrors at the 4 Booting→Idle sites for booted"
  - phase: 20-pool-module-devices
    plan: 04
    provides: "subscriber.spec.ts canonical DB-gated pattern (describe.skipIf + plain-object ALS shape + module.bus.on subscribe)"
provides:
  - "server/pool/pool-manager.ts: 4 device.booted emission sites at Booting→Idle transitions (addDevice line 67, initPool inner loop line 140, detectPhysicalDevices line 231, replaceDevice line 399), each AFTER existing emit.stateChanged"
  - "server/pool/__tests__/subscriber.spec.ts: 2 new [Phase 24] tests proving (a) booted fires AFTER state.changed at addDevice flow with payload conforming to deviceBootedPayload schema, (b) HealthChecker recovery emission sequence does NOT emit device.booted (negative-space invariant)"
affects: [24-03, 24-04, 24-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TDD red→green per task: failing tests committed first, then implementation"
    - "Phase 20 emission-wiring template applied to a 5th event: locate transition() sites + pair emit AFTER stateChanged + preserve order (Pitfall 2)"
    - "Negative-space invariant test pattern: assert HealthChecker recovery sequence (health.failed + state.changed×3) emits ZERO device.booted — proves channel separation between fresh-boot and recovery semantics"

key-files:
  created: []
  modified:
    - server/pool/pool-manager.ts
    - server/pool/__tests__/subscriber.spec.ts

key-decisions:
  - "Emit AFTER stateChanged (Pitfall 2 inheritance from Phase 20) — subscribers that re-fetch via pool.getDevice() must see the post-transition Idle state. Reversing order races subscribers into reading Booting state."
  - "device.port read AFTER any port-assignment side-effect — initPool sees real detectedPort or driver.boot result.port; replaceDevice sees driver.boot result.port; addDevice + detectPhysicalDevices may see null. Schema accepts z.number().int().nullable() so all 4 paths are valid."
  - "HealthChecker recovery (Error→Idle at replaceZombieDevice line 215) NOT instrumented — fresh-boot semantics reserved for the 4 PoolManager sites. Recovery uses device.health.failed + device.state.changed channels."
  - "Non-Idle stateChanged sites (lines 236/265/285/300/367 — allocate/release/markRunning/cleanup) explicitly NOT instrumented per plan must-haves: only Booting→Idle is the fresh-boot signal."

requirements-completed: [MOD-08]

# Metrics
duration: ~10min
completed: 2026-05-08
tasks: 1
files_changed: 2
commits: 2
---

# Phase 24 Plan 02: Pool device.booted Emission Wiring Summary

**One-liner:** Wired 4 `this.emit.booted(...)` calls into pool-manager.ts at every Booting→Idle transition site (addDevice / initPool inner loop / detectPhysicalDevices / replaceDevice) — each paired AFTER the existing emit.stateChanged per Phase 20 Pitfall 2 — and extended subscriber.spec with 2 DB-gated tests proving emission ordering + negative-space (HealthChecker recovery does NOT emit booted).

## Tasks Executed

### Task 2.1: Add 4 device.booted emissions + extend subscriber.spec (TDD)

**RED commit:** `399ad30` — `test(24-02): add failing tests for device.booted emission at Booting→Idle`

Added 2 new it-blocks to `server/pool/__tests__/subscriber.spec.ts`:

1. `[Phase 24] device.booted fires AFTER device.state.changed at addDevice (Booting→Idle) and matches deviceBootedPayload schema`
   - Subscribes via `app.poolModule.bus.on(POOL_EVENT_NAMES.STATE_CHANGED, ...)` + `app.poolModule.bus.on(POOL_EVENT_NAMES.BOOTED, ...)` (matches existing Phase 20 SC1 subscriber pattern at lines 100-117).
   - Wraps `app.pool.addDevice('android', 'phase-24-test-device', 'emulator-5560')` inside `makeEmitContext` (canonical plain-object ALS store shape per 20-CONTEXT §Specifics).
   - Filters captured events to the deviceId returned by addDevice (avoids contamination from concurrent detectPhysicalDevices runs).
   - Asserts both events fire AND `bootedIdx > stateIdx` (ordering invariant).
   - Round-trips the booted payload through `deviceBootedPayload.safeParse(...)` — proves schema conformance.
   - Asserts `platform === 'android'`, `emulatorId === 'emulator-5560'`, port is null or number.

2. `[Phase 24] HealthChecker recovery does NOT emit device.booted (only health.failed + state.changed)`
   - Simulates the HealthChecker.replaceZombieDevice emission sequence (health.failed + 3× state.changed: Running→Error, Error→Booting, Booting→Idle) via direct `app.poolModule.emit.X(...)` calls.
   - Asserts `bootedCount === 0` — proves the recovery channel does NOT fire booted (Pitfall 1 from RESEARCH §inheritance).

Imported `deviceBootedPayload` from `../events.js` for round-trip schema validation.

**Pre-GREEN result:** Test 1 failed with `AssertionError: expected -1 to be greater than or equal to 0` (bootedIdx === -1 because no emission site existed). Test 2 passed naturally (zero emission ⇒ zero events). All 5 prior Phase 20 tests passed.

**GREEN commit:** `083ceac` — `feat(24-02): emit device.booted at 4 Booting→Idle transitions in pool-manager`

Added 4 surgical insertions to `server/pool/pool-manager.ts`:

| Site | Function | Pre-mod line | Post-mod line | Source line of `this.emit.booted` |
|------|----------|--------------|---------------|-----------------------------------|
| 1 | `addDevice` | 63 | 64–73 | 67 |
| 2 | `initPool` inner loop | 126 | 137–145 | 140 |
| 3 | `detectPhysicalDevices` | 207 | 222–231 | 231 |
| 4 | `replaceDevice` | 366 | 386–399 | 399 |

Each emission shaped uniformly:

```typescript
this.emit.booted(device.id, {
  deviceId: device.id,
  platform: device.platform,
  emulatorId: device.emulatorId,
  port: device.port,
});
```

Placed IMMEDIATELY AFTER the existing `this.emit.stateChanged(device.id, { deviceId: device.id, from, to })` line at each of the 4 sites; preceded by a 3-line Phase 24 / Plan 24-02 doc-comment citing Pitfall 2.

For Site 2, the existing `this.logger.info({...}, 'Device booted')` line is preserved AFTER the new emit call.

**Tests post-GREEN:** 7/7 passing in 1.62s (DB-gated, run via `DATABASE_URL=postgresql://heicg@localhost:5432/device_farm`):
- 5 prior Phase 20 tests (SC1 state.changed/allocated/released/health.failed + SC4 side-channel)
- 2 new Phase 24 tests (emission ordering + HealthChecker negative-space)

## Verification Gates

| Gate | Expected | Actual |
|------|----------|--------|
| `grep -c "this.emit.booted(device.id" server/pool/pool-manager.ts` | 4 | 4 |
| `grep -B 6 "this.emit.booted(device.id" server/pool/pool-manager.ts \| grep -c "transition(DeviceState.Idle)"` | 4 | 4 |
| `grep -c "this.emit.booted" server/pool/health-checker.ts` | 0 | 0 |
| `grep -c "this.emit.booted" server/pool/internal/module.ts` | 0 | 0 |
| `npx vitest run server/pool/__tests__/subscriber.spec.ts` (DB) | 7 pass | 7/7 ✓ |
| `npx tsc --noEmit` errors in `server/pool/pool-manager.ts` | 0 | 0 |
| Full pool suite regressions | 0 new | 0 new (6 pre-existing failures unchanged) |

## Phase 20 Invariant Verification

- **Pitfall 2 (emit AFTER mutation success):** All 4 emit.booted sites are placed AFTER `device.transition(DeviceState.Idle)` (which mutates device.state) AND AFTER `this.emit.stateChanged(...)` (which emits the state-change envelope). Subscribers that observe device.booted are guaranteed the device has already transitioned and the state.changed envelope has been delivered to its own subscribers.
- **Booting→Idle exclusivity:** Verified via `grep -B 6` — every `emit.booted` line has `transition(DeviceState.Idle)` within the 6 preceding lines. The 4 non-Idle stateChanged sites (lines 236/265/285/300/367 in the post-mod file: allocate/release/markRunning/cleanup) remain UNTOUCHED.
- **Channel separation (HealthChecker recovery):** `grep -c "emit.booted" server/pool/health-checker.ts` returns 0. Recovery flows (Error→Idle in replaceZombieDevice line 215) emit only `device.health.failed` + `device.state.changed`. Negative-space test 2 in subscriber.spec proves this end-to-end.

## Pre-existing Failures (Out of Scope, Inherited from Plan 24-01)

Verified via `git stash && npx vitest run` baseline that these 6 failures exist on Plan 24-01 HEAD pre-Plan-24-02:

- `server/pool/__tests__/module.spec.ts` (5 tests):
  - "emit has 4 methods (stateChanged/allocated/released/healthFailed) matching POOL_EVENT_NAMES" — fails because Plan 24-00 added BOOTED to POOL_EVENT_NAMES (5 keys) without bumping this assertion.
  - 4 other tests fail with `TypeError: deps.fastify.addHook is not a function` from `server/pool/internal/module.ts:159` — module.spec mocks lack `addHook`.
- `server/pool/__tests__/lifecycle-ownership.spec.ts` (1 test): same `addHook` mock issue.

Documented in Plan 24-01 SUMMARY §"Pre-existing Failures (Not Fixed — Out of Scope)" as deferred to Plan 24-04 (DB-gated proofs / module spec rebuild) or a separate cleanup. Out-of-scope per scope-boundary rule for Plan 24-02.

## Deviations from Plan

None — plan executed exactly as written. All 4 emission sites land at the verified line numbers, payload shape matches plan §<interfaces>, both spec extensions follow the Phase 20 subscriber.spec pattern verbatim, and no architectural changes were needed.

## Plan 24-03 Entry Point (downstream readiness)

- **Maestro factory + subscribers:** `createMaestroModule` (Plan 24-03) can now subscribe via `fastify.poolModule.bus.on('device.booted', handler)` and receive a guaranteed envelope at every fresh-boot — RESEARCH §SC3h is now end-to-end demonstrable.
- The 4 emission sites cover all current PoolManager fresh-boot paths: pool-init (initPool), runtime addDevice (used by tests + future admin UI), physical-device auto-detection (initPool side effect for connected USB Android), and zombie replacement (replaceDevice triggered by HealthChecker).
- Subscribers receive `{ deviceId, platform, emulatorId, port|null }` — sufficient for maestro hierarchy fetch (deviceId for adb addressing, port for emulator-specific tooling, null-port branch for physical devices).

## Self-Check: PASSED

Verified files exist and contain expected content:
- FOUND: server/pool/pool-manager.ts (4 emit.booted sites at lines 67, 140, 231, 399)
- FOUND: server/pool/__tests__/subscriber.spec.ts (2 new [Phase 24] it-blocks + deviceBootedPayload import)
- FOUND: commit 399ad30 (RED test commit)
- FOUND: commit 083ceac (GREEN emission commit)
- VERIFIED: server/pool/health-checker.ts has 0 emit.booted hits
- VERIFIED: server/pool/internal/module.ts has 0 emit.booted hits
- VERIFIED: 7/7 subscriber.spec tests pass (DB-gated)
- VERIFIED: 0 new tsc errors in server/pool/pool-manager.ts
