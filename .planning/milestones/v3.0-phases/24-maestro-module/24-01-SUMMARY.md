---
phase: 24-maestro-module
plan: 01
subsystem: infra
tags: [events, schema, mod-03, maestro, pool-extension, tdd]

# Dependency graph
requires:
  - phase: 24-maestro-module
    plan: 00
    provides: maestro/events.ts stub + POOL_EVENT_NAMES.BOOTED placeholder
  - phase: 20-pool-module-devices
    provides: poolRegistry 4-event base + makePoolEmitters factory pattern
  - phase: 22-streaming-module
    provides: 1-event events.ts canonical template
provides:
  - server/maestro/events.ts: full body (2 transient events + payload schemas + makeMaestroEmitters + real v5 MAESTRO_AGGREGATE_ID)
  - server/pool/events.ts: 5th registry entry device.booted (transient) + deviceBootedPayload schema + booted helper in makePoolEmitters
  - server/maestro/__tests__/events.spec.ts: 6 tests proving EVENTS-03 + registry shape + payload accept/reject + AGGREGATE_ID v5 + emitters shape
  - server/pool/__tests__/events.spec.ts: 4 new tests (registry count 4→5, BOOTED entry shape, deviceBootedPayload accept/reject, makePoolEmitters 5-helper return)
  - server/pool/{pool-manager.ts, health-checker.ts}: NOOP_POOL_EMIT extended with 5th `booted` no-op (typed-default compatibility)
  - server/pool/__tests__/{allocation.spec.ts, health-checker.spec.ts}: PoolEmitters mock objects extended with 5th `booted` capture (typed-mock compatibility)
affects: [24-02, 24-03, 24-04, 24-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TDD red→green per task: failing tests committed first, then implementation"
    - "Real v5 UUID derivation pattern (uuidv5('maestro', URL_NS) replaces grep-flagged placeholder from substrate)"
    - "Cross-module registry extension (pool +1 event) atomic with new module's events body — both files share EVENTS-03 contract gate"
    - "Typed-default compatibility cascade: adding 5th key to PoolEmitters propagates to NOOP_POOL_EMIT (2 files) + mock PoolEmitters (2 spec files)"

key-files:
  created: []
  modified:
    - server/maestro/events.ts
    - server/maestro/__tests__/events.spec.ts
    - server/pool/events.ts
    - server/pool/__tests__/events.spec.ts
    - server/pool/__tests__/allocation.spec.ts
    - server/pool/__tests__/health-checker.spec.ts
    - server/pool/pool-manager.ts
    - server/pool/health-checker.ts

key-decisions:
  - "Both maestro events transient (persisted:false) per TRACE-08 — hierarchy.fetched fires per UI route hit; device-info.collected fires per device boot (high-freq, derivable from logs/cache)"
  - "device.booted persisted:false — derivable from device.state.changed Booting→Idle transition (which already fires); event exists as a thin discriminated signal for maestro subscriber and other low-coupling consumers"
  - "deviceBootedPayload thin: {deviceId, platform, emulatorId, port?} — pool name field deliberately omitted (subscribers re-fetch via pool.getDevice if needed; matches device.allocated thin-payload pattern)"
  - "port is z.number().int().nullable() — physical Android devices have no emulator port (matches existing pool/device shape)"
  - "MAESTRO_AGGREGATE_ID = 'ceb331df-a288-5be5-b801-cbdfc4deec4a' (real v5 from uuidv5('maestro', URL_NS)); spec re-derives at test time and asserts equality (single source of truth grep-friendly literal)"

patterns-established:
  - "Plan 24-01 events-bodies plan template (mirrors Phase 22 Plan 22-01 + Phase 21 Plan 21-02): two-file extension landing maestro full body + pool +1 entry atomically because they share EVENTS-03 contract gate"
  - "5th-helper addition to PoolEmitters cascades to 4 typed-default sites — fix pattern: add same-shape no-op/mock entry to each"

requirements-completed: [MOD-03, EVENTS-03]

# Metrics
duration: ~9min
completed: 2026-05-08
tasks: 2
files_changed: 8
commits: 4
---

# Phase 24 Plan 01: Maestro + Pool Events Bodies Summary

**One-liner:** Filled maestro/events.ts full body (2 transient events + real v5 MAESTRO_AGGREGATE_ID + 2-helper makeMaestroEmitters) and extended pool/events.ts with 5th transient device.booted entry (deviceBootedPayload + 5-helper makePoolEmitters).

## Tasks Executed

### Task 1.1: maestro/events.ts full body (TDD)

**RED commit:** `228f6e2` — added 6 failing tests asserting:
- MAESTRO_EVENT_NAMES has 2 keys matching `/^maestro\.[a-z-]+\.[a-z]+$/`
- maestroRegistry has 2 entries with `persisted: false` + `aggregateType: 'maestro'`
- MAESTRO_AGGREGATE_ID === uuidv5('maestro', URL_NS) re-derived at test time
- maestroHierarchyFetchedPayload accepts valid + rejects invalid source
- maestroDeviceInfoCollectedPayload accepts nullable os/model + rejects bad UUID
- makeMaestroEmitters returns 2 typed function helpers (hierarchyFetched, deviceInfoCollected)

**GREEN commit:** `35179c8` — wrote full body of `server/maestro/events.ts`:
- Replaced placeholder MAESTRO_AGGREGATE_ID with `'ceb331df-a288-5be5-b801-cbdfc4deec4a'` (real v5)
- Added `maestroHierarchyFetchedPayload` (deviceId/source/elementCount/fetchTimeMs)
- Added `maestroDeviceInfoCollectedPayload` (deviceId/osVersion?/model?)
- Replaced empty maestroRegistry with 2-entry literal (both `persisted: false`, both `aggregateType: 'maestro'`)
- Added `makeMaestroEmitters(bus, onEmit?)` factory + `MaestroEmitters` exported type

**Tests:** 6/6 passing in <500ms.

### Task 1.2: pool/events.ts 5th entry + spec extension (TDD)

**RED commit:** `16e3208` — extended pool events spec:
- Bumped registry/emitters count assertions 4 → 5 in 3 existing tests
- Added 4 new tests asserting deviceBootedPayload accept (android/ios/physical w/ null port) + reject (bad UUID, bad platform, non-int port) + 5-helper makePoolEmitters return

**GREEN commit:** `3cfed3f` — three insertions in `server/pool/events.ts`:
1. `deviceBootedPayload` schema (deviceId/platform/emulatorId/port?) before Registry divider
2. `[POOL_EVENT_NAMES.BOOTED]` 5th registry entry (persisted: false, aggregateType: 'pool')
3. `booted: emit(POOL_EVENT_NAMES.BOOTED)` 5th helper in makePoolEmitters

Removed Plan-24-01 placeholder marker comment from BOOTED entry in POOL_EVENT_NAMES.

**Tests:** 12/12 passing (8 prior + 4 new) in <600ms.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Adding 5th `booted` helper to PoolEmitters broke typed-default sites**
- **Found during:** Task 1.2 GREEN tsc check
- **Issue:** 4 sites depend on `PoolEmitters` shape and break compile when 5th key added:
  - `server/pool/pool-manager.ts:23` NOOP_POOL_EMIT default
  - `server/pool/health-checker.ts:24` NOOP_POOL_EMIT default
  - `server/pool/__tests__/allocation.spec.ts:203` mock PoolEmitters in [Phase 20-02] block
  - `server/pool/__tests__/health-checker.spec.ts:273` mock PoolEmitters in [Phase 20-02] block
- **Fix:** Added matching `booted` entry (no-op/capture variant) to each — preserves Plan 20-02 invariants (test still captures all event types if/when emitted) and preserves Plan 20-03 NOOP semantics. Files modified, all 47 affected pool spec tests still green.
- **Scope boundary:** in-scope per deviation Rule 3 — directly caused by this plan's 5th-helper addition.
- **Commit:** `3cfed3f` (bundled with Task 1.2 GREEN)

## Pre-existing Failures (Not Fixed — Out of Scope)

Verified by `git stash` baseline that these 6 failures exist on `main` HEAD pre-Plan-24-01:

- `server/pool/__tests__/module.spec.ts` (5 tests):
  - "emit has 4 methods (stateChanged/allocated/released/healthFailed) matching POOL_EVENT_NAMES" — was already failing because Plan 24-00 added BOOTED to POOL_EVENT_NAMES (5 keys) without bumping this test (Phase 23/24 pre-existing carry-over)
  - 4 other tests fail with `TypeError: deps.fastify.addHook is not a function` from `server/pool/internal/module.ts:159` — module.spec mocks lack `addHook`; out-of-scope module-level fix for Plan 24-04 or later
- `server/pool/__tests__/lifecycle-ownership.spec.ts` (1 test): same `addHook` mock issue

These 6 failures are unrelated to this plan's scope (events.ts + spec) per scope-boundary rule. They would be addressed by either Plan 24-04 (DB-gated proofs / module spec rebuild) or as a separate cleanup task.

## Verification Gates

| Gate | Expected | Actual |
|------|----------|--------|
| `grep "ceb331df-a288-5be5-b801-cbdfc4deec4a" server/maestro/events.ts` | 1 | 1 |
| `grep "00000000-0000-5000-8000-000000000024" server/maestro/events.ts` | 0 | 0 |
| `grep "makeMaestroEmitters" server/maestro/events.ts` | ≥1 | 2 |
| `grep "z.string().uuid()" server/maestro/events.ts` | ≥2 | 2 |
| `grep "persisted: false" server/maestro/events.ts` | 2 | 2 |
| `grep "deviceBootedPayload" server/pool/events.ts` | ≥2 | 2 |
| `grep -E "booted:.*emit\(POOL_EVENT_NAMES.BOOTED\)" server/pool/events.ts` | 1 | 1 |
| `grep "Plan 24-01:" server/pool/events.ts` | 0 | 0 |
| `npx vitest run server/maestro/__tests__/events.spec.ts` | 6 pass | 6/6 ✓ |
| `npx vitest run server/pool/__tests__/events.spec.ts` | 12 pass | 12/12 ✓ |
| `npx tsc --noEmit` errors in plan-touched files | 0 | 0 |
| Combined plan + extension specs | 18 pass | 18/18 ✓ |

## Plan 24-02 / 24-03 Entry Points (downstream readiness)

- **Plan 24-02** (pool emit-sites wiring) can call `this.emit.booted(deviceId, payload)` in pool-manager.ts at 4 Booting→Idle transition sites (addDevice, initPool inner loop, detectPhysicalDevices, replaceDevice) — helper exists, payload schema validates inputs at emit time.
- **Plan 24-03** (maestro factory + subscribers) can call `makeMaestroEmitters(bus, persistEnvelope)` from createMaestroModule — both helpers exported. `MaestroRegistry` + `MaestroEmitters` types available for factory signature.

## Self-Check: PASSED

Verified files exist and contain expected content:
- FOUND: server/maestro/events.ts (84 LoC; full body)
- FOUND: server/maestro/__tests__/events.spec.ts (6 tests)
- FOUND: server/pool/events.ts (197 LoC; 5-entry registry)
- FOUND: server/pool/__tests__/events.spec.ts (12 tests)
- FOUND: commit 228f6e2 (test red maestro)
- FOUND: commit 35179c8 (feat green maestro)
- FOUND: commit 16e3208 (test red pool extension)
- FOUND: commit 3cfed3f (feat green pool + typed-default fixes)
