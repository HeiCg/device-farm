---
phase: 20-pool-module-devices
verified: 2026-04-21T22:00:00Z
status: passed
score: 4/4 must-haves verified
re_verification: false
---

# Phase 20: Pool Module (Devices) Verification Report

**Phase Goal:** Refactor the device pool to publish `device.*` events from within the state machine; move health checker and reaper out of `server/index.ts` onReady into `pool`'s own lifecycle.
**Verified:** 2026-04-21
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every allowed transition in VALID_TRANSITIONS fires a typed `device.state.changed` event with envelope-level `{deviceId, from, to, correlationId}`; allocation/release publish `device.allocated` and `device.released`; health failures publish `device.health.failed` | VERIFIED | `pool-manager.ts` has 8 `emit.stateChanged` + 2 `emit.allocated/released` call sites; `health-checker.ts` has 11 emit calls covering all 4 event types + all 4 reason discriminators; `events.spec.ts` asserts `envelope.correlationId`; `allocation.spec.ts` [SC1] + `health-checker.spec.ts` [SC1] cover per-reason tests; 89 pool specs pass |
| 2 | `server/index.ts` no longer starts health checker or reaper; `pool` owns both; `websocket` declares `pool` as a dep; device preview handler reaches pool only via barrel | VERIFIED | Zero matches for `healthChecker.start`, `startReaper`, `setInterval.*health/reap` in `server/index.ts`; `lifecycle-ownership.spec.ts` [SC2] grep-guard tests enforce this; `streaming/websocket-plugin.ts:174` declares `dependencies: ['config', 'auth', 'pool-plugin']`; `device-preview.ts` has zero pool imports (uses `fastify.devicePreview` decorator) |
| 3 | Pool module fully migrated: MODULE.md (9 H2 + 7 invariants + Runnable Example), barrel (1 internal/ line, no `export *`), events.ts (4 schemas + poolRegistry + makePoolEmitters + POOL_AGGREGATE_ID), queue.ts (registerPoolQueues + DEVICE_REAP boss.schedule + worker), tests-as-spec; every MODULE.md invariant has a test | VERIFIED | `MODULE.md` has exactly 9 H2 sections + 7 invariants (a–g) + `### Runnable Example`; `index.ts` has 1 `internal/` re-export line (line 25), no `export *`; all 4 schemas + registry + helpers in `events.ts`; `queue.ts` has `registerPoolQueues` with 3-step boss.createQueue→schedule→work; invariants (a)(b) tested in `device-state.spec.ts`/(g) in `module.spec.ts`/(c)(f) in `allocation.spec.ts`/(d) in `health-checker.spec.ts`/(e) in `process-tracker.spec.ts` (scanOrphans tests verify filter without MOD-08(e) label) |
| 4 | Nyquist passes (delta ≤ −2pp); downstream consumers (`jobs`, `maestro`, `hooks`) can reach `device.*` events through the bus without reaching into `pool` internals | VERIFIED | Nyquist delta −0.30pp (47.99% vs 48.29% baseline) — well within −2pp gate; `subscriber.spec.ts` proves `module.bus.on(POOL_EVENT_NAMES.*)` pattern for all 4 events; zero deep imports into `pool/internal/` from outside `server/pool/**`; existing deep imports (`jobs/job-service.ts → pool/pool-manager.ts`, `maestro/plugin.ts → pool/device-info-collector.ts`) are into non-internal pool files and explicitly deferred to Phase 21/23/24 per MODULE.md §Non-Goals |

**Score:** 4/4 truths verified

---

### Required Artifacts

| Artifact | Purpose | Status | Details |
|----------|---------|--------|---------|
| `server/pool/events.ts` | 4 payload schemas + poolRegistry + makePoolEmitters + POOL_AGGREGATE_ID | VERIFIED | 176 lines; all 4 schemas, registry with persistence policy, POOL_AGGREGATE_ID = v5 UUID from 'pool', makePoolEmitters factory |
| `server/pool/queue.ts` | registerPoolQueues factory + DEVICE_REAP boss.schedule | VERIFIED | 101 lines; 3-step boss.createQueue→queue.schedule→queue.work; singletonKey protection; DEVICE_BOOT exported name-only as reserved |
| `server/pool/internal/module.ts` | createPoolModule factory with TypedBus + real emit wiring | VERIFIED | 183 lines; factory constructs PoolManager + HealthChecker with real emit; registerWorkersAndSubscribers + idempotent shutdown with stopped flag |
| `server/pool/plugin.ts` | Thin wirer with dependencies ['config','db','queue','event-bus'] | VERIFIED | 86 lines; 4 decorators (pool, processTracker, healthChecker, poolModule); calls module.registerWorkersAndSubscribers(); onClose → module.shutdown() |
| `server/pool/index.ts` | Public barrel, strict 1-line internal/ re-export | VERIFIED | 1 internal/ re-export line (line 25); no `export *`; all public symbols exported by name |
| `server/pool/MODULE.md` | 9 H2 sections + 7+ invariants + Runnable Example | VERIFIED | 9 H2 sections (Purpose, Public API, Events Emitted, Events Consumed, Queue Produced, Queue Consumed, Invariants, Non-Goals, Dependencies) + 7 invariants (a–g) + `### Runnable Example` at line 95 |
| `server/pool/__tests__/events.spec.ts` | Events registry + emit helpers spec (MOD-03) | VERIFIED | Proves POOL_EVENT_NAMES shape, registry persistence policy, payload schemas, correlationId from ALS, POOL_AGGREGATE_ID v5 derivation |
| `server/pool/__tests__/allocation.spec.ts` | SC1 emit site proof | VERIFIED | [SC1] tests for addDevice, allocate, release, markRunning emit sites |
| `server/pool/__tests__/health-checker.spec.ts` | SC1 health.failed per-reason proof | VERIFIED | [SC1] tests for all 4 reason discriminators (unhealthy, zombie, max-retries, timeout) |
| `server/pool/__tests__/module.spec.ts` | Factory + invariant (g) idempotency | VERIFIED | [Invariant MOD-08 (g)] shutdown idempotency test |
| `server/pool/__tests__/lifecycle-ownership.spec.ts` | SC2 grep-guard proof | VERIFIED | 4 grep-guard assertions that server/index.ts does not call healthChecker.start or reaper; pool plugin dep array assertion |
| `server/pool/__tests__/subscriber.spec.ts` | SC4 downstream consumer proof (DB-gated) | VERIFIED | module.bus.on receives all 4 device.* events; DB-gated auto-skip without TEST_DATABASE_URL |
| `server/pool/__tests__/correlation.spec.ts` | SC4 ALS → emit → envelope → events-table row | VERIFIED | device.health.failed persisted row proof; non-persisted events do not write rows |
| `.dependency-cruiser.cjs` | no-deep-imports-into-pool-internal rule | VERIFIED | Rule at line 70; severity: 'error'; pathNot '^server/pool/'; to path '^server/pool/internal/' |
| `server/queue/names.ts` | DEVICE_BOOT + DEVICE_REAP constants | VERIFIED | Both constants present at lines 47–48 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `pool-manager.ts` | `emit.stateChanged` | 4th constructor param PoolEmitters | WIRED | 8 call sites confirmed; NOOP default for back-compat |
| `pool-manager.ts` | `emit.allocated` / `emit.released` | Inside allocateMutex / after release | WIRED | Lines 240, 304 — within correct transaction boundaries |
| `health-checker.ts` | `emit.healthFailed` / `emit.stateChanged` | 4th constructor param PoolEmitters | WIRED | 11 emit call sites covering all reason paths |
| `createPoolModule` | `makePoolEmitters(bus, persistEnvelope)` | makePersistEnvelope side-channel | WIRED | Lines 120–121; persistEnvelope middleware wires health.failed persistence |
| `poolPlugin` | `createPoolModule` | thin factory call | WIRED | Line 49; 4 fastify decorators added; registerWorkersAndSubscribers called |
| `registerPoolQueues` | `fastify.boss.createQueue` + `fastify.queue.schedule` + `fastify.queue.work` | Ordering-correct 3-step sequence | WIRED | boss.createQueue BEFORE schedule (pg-boss ordering constraint); singletonKey prevents overlap |
| `poolPlugin.onClose` | `module.shutdown()` | addHook('onClose') | WIRED | Line 73–75; healthChecker.stop + offWork in shutdown |
| `streaming/websocket-plugin` | `pool-plugin` | dependencies array | WIRED | `dependencies: ['config', 'auth', 'pool-plugin']` at line 174 |
| `server/pool/index.ts` | `pool/internal/module.ts` | 1-line re-export (MOD-02) | WIRED | Exactly 1 internal/ import/export line confirmed |

---

### Requirements Coverage

Module-level MOD-01..MOD-09 conventions (established Phase 16):

| Requirement | Status | Evidence |
|-------------|--------|---------|
| MOD-01 (MODULE.md exists, 9 H2 sections) | SATISFIED | `server/pool/MODULE.md` — 9 H2 sections confirmed |
| MOD-02 (barrel: strict 1-line internal/ re-export, no `export *`) | SATISFIED | `server/pool/index.ts` line 25 — only internal/ re-export; no `export *` |
| MOD-03 (events.ts with registry + emit helpers) | SATISFIED | `server/pool/events.ts` — 4 schemas + poolRegistry + makePoolEmitters |
| MOD-04 (tests renamed .test → .spec) | SATISFIED | All 11 files in `server/pool/__tests__/` are `*.spec.ts` |
| MOD-06 (createPoolModule factory, MOD-06 canonical factory pattern) | SATISFIED | `server/pool/internal/module.ts` — `createPoolModule` factory confirmed |
| MOD-08 (every MODULE.md invariant has a test) | SATISFIED | Invariants (a)(b)(c)(d)(f) in device-state/allocation/health-checker specs; (e) in process-tracker scanOrphans tests (behavior verified, label omitted); (g) in module.spec.ts [Invariant MOD-08 (g)] |

Note: MOD-05, MOD-07, MOD-09 are not Phase 20 scope — MOD-05 (schema file) was Phase 17; MOD-07 (dep-check clean) is a gate not a deliverable; MOD-09 (CI typechecked example) is Phase 27.

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `server/jobs/job-service.ts:8` | `import type { PoolManager } from '../pool/pool-manager.js'` (deep import, not through barrel) | Info | Intentionally deferred to Phase 23 per MODULE.md §Non-Goals; not into `pool/internal/` so dep-cruiser rule does not trigger |
| `server/maestro/plugin.ts:22` | `import { DeviceInfoCollector } from '../pool/device-info-collector.js'` (deep import) | Info | Intentionally deferred to Phase 24 per MODULE.md §Non-Goals |
| `server/artifacts/recording-service.ts:11` | `import type { ProcessTracker } from '../pool/process-tracker.js'` (deep import) | Info | Intentionally deferred to Phase 21 per MODULE.md §Non-Goals |
| `server/pool/__tests__/process-tracker.spec.ts` | Invariant (e) behavior covered but `[Invariant MOD-08 (e)]` label absent from test name | Info | scanOrphans filter behavior is tested (register + orphan exclusion by PID/PGID); label missing is cosmetic, not a missing test |

None of these are blockers. The deep imports are documented deferrals into non-internal files (dep-cruiser forbids only `pool/internal/`).

---

### Human Verification Required

#### 1. End-to-End Boot with Real Emulator

**Test:** Start server (`npm run dev`), wait for pool init; observe logs for `device.state.changed` events with correlationId; kill the emulator process and verify `device.health.failed` is logged and the device transitions to Error state.
**Expected:** `device.state.changed` log with `{deviceId, from, to}` and correlationId; after kill, `device.health.failed` with `reason: 'unhealthy'`; events-table row in DB for `device.health.failed`.
**Why human:** Requires Mac Mini with Apple Silicon, Android emulator, and a running PostgreSQL instance.

#### 2. Reaper Kills Zombie qemu Process

**Test:** Launch emulator; kill parent process before graceful shutdown; wait 60+ seconds; observe the `device.reap` pg-boss worker firing and orphan cleanup in logs.
**Expected:** `Pool schedules + workers registered` log on boot; after 60s, `Reaper fire failed` or successful reap log; port removed from allocation set.
**Why human:** Requires a real zombie qemu process; the pg-boss schedule + worker are verified structurally in tests but OS-level kill behavior requires physical environment.

---

### Gaps Summary

No gaps. All 4 success criteria are verified against the live codebase:

1. SC1 — Event emission wiring is present in `pool-manager.ts` (8 stateChanged + 2 allocated/released call sites) and `health-checker.ts` (11 emit calls, all 4 reason discriminators). The `correlationId` lives in the envelope (stamped by `createEventHelpers` from ALS), not the payload — this is correct by design and confirmed by `events.spec.ts` envelope assertions.

2. SC2 — `server/index.ts` has zero runtime calls to `healthChecker.start`, `startReaper`, or equivalent. All lifecycle ownership is in `createPoolModule.registerWorkersAndSubscribers()`. The `streaming/websocket-plugin.ts` declares `pool-plugin` as a dependency and `device-preview.ts` does not reach into pool at all.

3. SC3 — Full module migration confirmed: MODULE.md (9 H2 + 7 invariants a–g + Runnable Example), barrel (strict 1-line internal/ re-export, no export *), events.ts (4 schemas, poolRegistry, makePoolEmitters, POOL_AGGREGATE_ID v5), queue.ts (registerPoolQueues with 3-step boss pattern), 11 spec files covering all invariants.

4. SC4 — Nyquist delta −0.30pp (well within −2pp gate). subscriber.spec.ts proves `module.bus.on(POOL_EVENT_NAMES.*)` works for all 4 event types. No external deep imports into `pool/internal/`. Existing 3 deep imports (into `pool/pool-manager`, `pool/device-info-collector`, `pool/process-tracker`) are from non-`internal/` paths and intentionally deferred to Phase 21/23/24.

---

_Verified: 2026-04-21_
_Verifier: Claude (gsd-verifier)_
