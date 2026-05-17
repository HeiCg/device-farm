---
phase: 20-pool-module-devices
plan: 01
subsystem: pool
tags: [pool, events, mod-03, trace-04, trace-08, zod, als, v5-uuid]

# Dependency graph
requires:
  - phase: 20-pool-module-devices
    plan: 20-00
    provides: "Pool Wave-0 substrate — POOL_EVENT_NAMES + POOL_AGGREGATE_ID placeholder + empty poolRegistry + 1-test events.spec.ts stub + MOD-02/MOD-03/MOD-05 file-existence guarantees"
  - phase: 19-reporting-migration-webhooks-dlq
    plan: 19-01
    provides: "Canonical events.ts template (Zod payload schemas + registry `as const satisfies EventRegistry` + makeXEmitters factory via createEventHelpers) — copied 1:1 with s/reporting/pool/"
  - phase: 18-lifecycle-migration-node-cron-pg-boss
    plan: 18-01
    provides: "Alt canonical events.ts template + v5 UUID aggregate-ID derivation pattern (LIFECYCLE_AGGREGATE_ID) — matches Phase 20 POOL_AGGREGATE_ID derivation verbatim"
  - phase: 15-fix-operational-dependencies
    plan: 15-04
    provides: "createEventHelpers(bus, onEmit?) factory + ALS-sourced correlationId reader (shape-agnostic Map + object stores) — consumed by makePoolEmitters"
provides:
  - "server/pool/events.ts FULL MOD-03 body — POOL_EVENT_NAMES (4 event names) + POOL_AGGREGATE_ID (v5 UUID '2a120cd5-4bd3-5f65-a9e5-870ec709e44a' from 'pool' under URL namespace) + 4 Zod payload schemas + poolRegistry (4 entries, TRACE-08 persistence policy) + makePoolEmitters factory + PoolRegistry + PoolEmitters type exports"
  - "server/pool/__tests__/events.spec.ts extended from 1 → 8 tests across 2 describe blocks — shape/registry + emit-envelope/ALS integration — proving MOD-03 contract without DB"
  - "Plan 20-02 unblocked: can import makePoolEmitters for PoolManager state transitions + HealthChecker probe failures"
  - "Plan 20-03 unblocked: can import poolRegistry for createPoolModule factory + per-module TypedBus<PoolRegistry> instantiation"
affects: [20-02-emission-sites, 20-03-factory-plugin-rewire, 20-04-db-gated-proofs, 20-05-module-md-barrel-nyquist, 23-jobs-keystone, 27-trace-tree]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "v5 UUID aggregate-ID derivation pattern (Phase 18 LIFECYCLE → Phase 19 REPORTING → Phase 20 POOL): stable v5 UUID of module name under URL namespace '6ba7b811-9dad-11d1-80b4-00c04fd430c8'; hardcoded literal at runtime for import-time cheapness; spec re-derives at test time to enforce single-source-of-truth"
    - "Per-device aggregateId over module-singleton aggregateId: envelope.aggregateId=deviceId for all 4 pool events (NOT POOL_AGGREGATE_ID) because pool events are per-device telemetry. POOL_AGGREGATE_ID reserved for future pool-wide events (pool.initialized etc.) — diverges from Phase 18/19 where lifecycle + reporting are singleton aggregates"
    - "Mixed persistence policy inside one module registry: health.failed persisted:true (low-freq operational), state.changed/allocated/released persisted:false (high-freq derivable). First v3.0 module with mixed policy (hooks has both, lifecycle is all-true, reporting is mixed 2+2). TRACE-08 default stands."
    - "Plain-object ALS store shape in new specs (CONTEXT §Specifics): `asyncLocalStorage.run({correlationId, currentEventId, actor}, ...)` instead of legacy `new Map([['correlationId', cid]])` form seen in Phase 15/18/19 specs. Both shapes work against readAls() (shape-agnostic) but plain-object is the canonical go-forward form."

key-files:
  created: []
  modified:
    - server/pool/events.ts
    - server/pool/__tests__/events.spec.ts

key-decisions:
  - "POOL_AGGREGATE_ID computed as v5('pool', URL_NAMESPACE) = '2a120cd5-4bd3-5f65-a9e5-870ec709e44a'. Plan literal hint '9fabf52b-...' was stale/incorrect; spec re-derives at test time so the literal MUST match the v5 output. Recomputed offline via `node -e 'const {v5}=require(\"uuid\");console.log(v5(\"pool\",\"6ba7b811-9dad-11d1-80b4-00c04fd430c8\"))'`."
  - "device.health.failed persisted:true (ONLY persisted pool event); state.changed/allocated/released all persisted:false per TRACE-08 — high-frequency device telemetry is derivable from state.changed alone + events-table bloat unacceptable. health.failed is low-frequency operational telemetry consumed by Phase 27 trace-tree + Phase 23 jobs keystone debug paths."
  - "aggregateId=deviceId (per-device) on ALL 4 events, NOT POOL_AGGREGATE_ID. Deviates from Phase 18/19 singleton-aggregate pattern because pool events are inherently per-device — envelope.aggregateId encodes the device identity directly; consumers filtering by device get `aggregateId === deviceId` trivially. POOL_AGGREGATE_ID stays reserved for future `pool.initialized` / `pool.drained` telemetry that has no specific device."
  - "reason enum discriminator + willReplace flag on deviceHealthFailedPayload: reason=['unhealthy','zombie','max-retries','timeout'] maps 1:1 to HealthChecker failure paths (RESEARCH §Pitfall 2); willReplace:true on zombie path, false otherwise. lastError nullable — caught error message if any, null on clean probe-returns-false."
  - "Plain-object ALS store shape in events.spec.ts (CONTEXT §Specifics): new Phase 20 canonical form `{correlationId, currentEventId, actor} as never` — distinguishes from legacy `new Map([['correlationId', cid]])` used in Phase 15/18/19 specs. readAls() in server/bus/helpers.ts is shape-agnostic (handles both) so the change is stylistic not semantic, but forward-going specs adopt the plain-object form."
  - "Zero runtime pool/ changes other than events.ts + events.spec.ts — plan 20-02 owns PoolManager state-transition wiring + HealthChecker probe-failure emits; plan 20-03 owns createPoolModule factory + plugin rewire. Pool invariant `git log --oneline 20-00..HEAD -- server/pool/pool-manager.ts server/pool/device.ts server/pool/health-checker.ts server/pool/plugin.ts` → empty."

patterns-established:
  - "4th consecutive module landing MOD-03 events.ts + events.spec.ts via template replication: hooks (Phase 16) → lifecycle (Phase 18) → reporting (Phase 19) → pool (Phase 20). Template now fully validated — Phase 21 artifacts + Phase 22 streaming can lift verbatim with s/pool/artifacts|streaming/."
  - "Mixed persistence policy viable inside a single registry: pool is now the 2nd module (after reporting) with both persisted:true + persisted:false entries — TRACE-08 default scaling as expected."

requirements-completed: [MOD-03]

# Metrics
duration: 4min
completed: 2026-04-21
---

# Phase 20 Plan 01: Pool Events Body Summary

**Full MOD-03 events.ts body lands for the pool module — 4 Zod payload schemas + poolRegistry with TRACE-08 persistence policy (health.failed persisted; state.changed/allocated/released transient) + makePoolEmitters factory + v5-derived POOL_AGGREGATE_ID — events.spec.ts grows from 1 → 8 tests across 2 describe blocks.**

## Performance

- **Duration:** 4min
- **Started:** 2026-04-21T20:16:20Z
- **Completed:** 2026-04-21T20:20:29Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- `server/pool/events.ts` replaces Plan 20-00 stub body with full MOD-03 form: POOL_AGGREGATE_ID placeholder `'00000000-0000-5000-8000-000000000020'` → real v5 UUID `'2a120cd5-4bd3-5f65-a9e5-870ec709e44a'` (computed offline via `uuidv5('pool', URL_NAMESPACE)` and hardcoded); 4 Zod payload schemas added (`deviceStateChangedPayload` / `deviceAllocatedPayload` / `deviceReleasedPayload` / `deviceHealthFailedPayload`); empty `poolRegistry` → 4-entry registry typed `as const satisfies EventRegistry` with `persisted: true` ONLY on `device.health.failed`, `persisted: false` on the other 3, `aggregateType: 'pool'` on all 4; `makePoolEmitters(bus, onEmit?)` factory wires `createEventHelpers(bus, onEmit)` from `../bus/helpers.js` returning `{stateChanged, allocated, released, healthFailed}` typed helpers; `PoolRegistry` + `PoolEmitters` type exports round out the surface
- `server/pool/__tests__/events.spec.ts` extended from 1-test shape stub to 8-test full MOD-03 spec across 2 describe blocks: (shape+registry) asserts POOL_EVENT_NAMES 4-name shape + EVENTS-03 dotted regex + poolRegistry 4-entry count + aggregateType='pool' + TRACE-08 persistence flags + POOL_AGGREGATE_ID v5 derivation from 'pool' + URL namespace + payload schemas accept/reject valid/malformed samples across all 4 schemas; (emit+envelope) asserts makePoolEmitters returns 4 typed helpers + envelope.correlationId hydrated from plain-object ALS store (CONTEXT §Specifics canonical form, NOT legacy Map) + envelope.aggregateType='pool' + aggregateId=deviceId + type + v=1 + actor on stateChanged + healthFailed emit paths
- Test runtime: fast (<500ms; no DB, pure in-memory TypedBus + onEmit capture); 8 tests pass cleanly
- Zero new typecheck errors on plan 20-01 files — 8 pre-existing errors from Phase 15 Map-vs-RequestContext + working-tree edits unchanged (documented in STATE.md envelope)
- `npm run lint` — no issues
- Plan 20-02 + 20-03 unblocked: emission sites in PoolManager / HealthChecker (20-02) + createPoolModule factory + plugin rewire (20-03) can now import `makePoolEmitters` + `POOL_AGGREGATE_ID` + `poolRegistry` against a proven contract

## Task Commits

1. **Task 1.1: Replace events.ts placeholder body with full MOD-03 registry + emit helpers** — `9d76040` (feat)
2. **Task 1.2: Extend events.spec.ts with registry + emit-envelope + POOL_AGGREGATE_ID tests** — `3078895` (test)

## Files Created/Modified

- `server/pool/events.ts` *(modified)* — Plan 20-00 stub body (41 lines) → full MOD-03 body (175 lines). +156/-22 net. Adds 4 payload schemas + full poolRegistry + makePoolEmitters factory + PoolRegistry + PoolEmitters types. POOL_AGGREGATE_ID placeholder replaced with real v5 literal.
- `server/pool/__tests__/events.spec.ts` *(modified)* — Plan 20-00 stub (22 lines, 1 test) → full MOD-03 spec (157 lines, 8 tests in 2 describe blocks). +142/-7 net. POOL_EVENT_NAMES shape assertion preserved (now in larger shape describe block); 7 new tests cover registry+persisted flags+payload schemas+emit envelope+POOL_AGGREGATE_ID v5 derivation.

## Decisions Made

- **POOL_AGGREGATE_ID = '2a120cd5-4bd3-5f65-a9e5-870ec709e44a'** (v5 of 'pool' under URL namespace). Plan's literal-hint `9fabf52b-...` was incorrect; recomputed offline and spec re-derives at test time to enforce single-source-of-truth (RFC 4122 §4.3 v5 UUID). Matches Phase 18 LIFECYCLE_AGGREGATE_ID pattern (where `v5('lifecycle', URL_NS)` = `a9c1a64b-f0c7-54fb-8153-d48ca3f6e97e` matches the committed value exactly); Phase 19 REPORTING committed a non-derived literal which will be inspected in a future cleanup (out-of-scope for plan 20-01; spec enforces correct v5 for pool going forward).
- **Persistence policy TRACE-08** — health.failed persisted:true; state.changed/allocated/released persisted:false. First pool module with MIXED policy inside one registry (Phase 19 reporting was first overall). High-freq telemetry (~per device transition) stays in the bus; low-freq operational health probes land in events table for Phase 27 trace-tree consumption.
- **aggregateId=deviceId (per-device) on all 4 events** — NOT POOL_AGGREGATE_ID. Differs from Phase 18/19 where singleton-module pattern landed aggregateId=LIFECYCLE_AGGREGATE_ID/REPORTING_AGGREGATE_ID because those modules are singletons by nature. Pool events are inherently per-device (each state change belongs to exactly one device), so envelope.aggregateId encodes device identity directly. POOL_AGGREGATE_ID reserved for future pool-wide events with no specific device (`pool.initialized` / `pool.drained` etc. — none land in Phase 20).
- **reason enum + willReplace flag shape on deviceHealthFailedPayload** — reason=['unhealthy','zombie','max-retries','timeout'] maps 1:1 to the 4 HealthChecker failure paths (RESEARCH §Pitfall 2). willReplace:true only on zombie path (HealthChecker kicks replaceZombieDevice), false on unhealthy/max-retries/timeout (no replacement boot triggered). lastError nullable because `unhealthy` can fire on clean `driver.isHealthy() === false` return with no thrown error. failureCount non-negative int (0 acceptable on first zombie detection).
- **Plain-object ALS store shape in events.spec.ts** — CONTEXT §Specifics canonical Phase 20 form: `asyncLocalStorage.run({correlationId, currentEventId, actor} as never, ...)`. Legacy `new Map([['correlationId', cid]])` form from Phase 15/18/19 specs NOT used (grep count of `new Map([` === 0). Both shapes work against shape-agnostic readAls() in server/bus/helpers.ts; stylistic-not-semantic pivot to align with CONTEXT directive.
- **Zero runtime pool/ changes outside events.ts + events.spec.ts** — plan 20-02 owns PoolManager state-transition emit wiring + HealthChecker probe-failure wiring; plan 20-03 owns createPoolModule factory + plugin rewire. Preserves the per-plan atomicity invariant the phase wave plan requires.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] POOL_AGGREGATE_ID literal in plan was incorrect**
- **Found during:** Task 1.1 pre-write verification (node offline `v5('pool', URL_NS)` computation)
- **Issue:** Plan instructed: hardcode `POOL_AGGREGATE_ID = '9fabf52b-a6a3-599f-a7fc-1c1e22ad9b8b'` — but actual `uuidv5('pool', '6ba7b811-9dad-11d1-80b4-00c04fd430c8')` returns `'2a120cd5-4bd3-5f65-a9e5-870ec709e44a'`. The plan's acceptance criterion was `POOL_AGGREGATE_ID === uuidv5('pool', URL_NAMESPACE)` — the spec re-derives at test time — so using the plan's literal-hint would have failed the test the same plan mandates.
- **Fix:** Used the correct v5 output `'2a120cd5-4bd3-5f65-a9e5-870ec709e44a'` as the hardcoded literal in events.ts; spec re-derives and asserts match (line 65 of events.spec.ts).
- **Files modified:** server/pool/events.ts (POOL_AGGREGATE_ID literal)
- **Commit:** `9d76040`
- **Verified:** `npx vitest run server/pool/__tests__/events.spec.ts` — the `POOL_AGGREGATE_ID matches v5 UUID derivation` test passes, confirming runtime literal matches test-time v5 computation.

## Issues Encountered

None. TDD flow: events.ts body written first (still makes Plan 20-00's 1 existing test pass — no RED); extended spec added 7 new tests (all green immediately since events.ts was already complete). Split committed atomically (feat + test) per task-commit protocol.

## Verification Gates

- `npx vitest run server/pool/__tests__/events.spec.ts` — 8 tests pass, exit 0 (<500ms runtime)
- `npx tsc --noEmit` — 8 pre-existing errors unchanged (Phase 15 Map-vs-RequestContext + 2 working-tree artifacts/pipelines errors documented in STATE.md); ZERO new errors on server/pool/events.ts or server/pool/__tests__/events.spec.ts
- `npm run lint` — No issues found
- `grep -cE "persisted:\s*true" server/pool/events.ts` = 1 (TRACE-08 enforcement — only health.failed)
- `grep -cE "persisted:\s*false" server/pool/events.ts` = 3 (state.changed + allocated + released)
- `grep -cE "aggregateType:\s*'pool'" server/pool/events.ts` = 5 (4 registry entries + 1 doc-comment header; registry block itself has exactly 4, confirmed by line-grep)
- `grep -c "new Map(\[\[" server/pool/__tests__/events.spec.ts` = 0 (plain-object ALS store shape; no legacy Map form)
- `grep -c "^\s\+it(" server/pool/__tests__/events.spec.ts` = 8 (≥5 required by plan)
- `git log --oneline 20-00..HEAD -- server/pool/pool-manager.ts server/pool/device.ts server/pool/health-checker.ts server/pool/process-tracker.ts server/pool/plugin.ts` → empty (runtime pool/ files untouched; Plan 20-02/20-03 scope preserved)

## Self-Check

**Files verified on disk:**

- FOUND: `server/pool/events.ts` (175 lines; full MOD-03 body)
- FOUND: `server/pool/__tests__/events.spec.ts` (157 lines; 8 tests)

**Commits verified in git log:**

- FOUND: `9d76040` feat(20-01): land full pool events.ts body (MOD-03)
- FOUND: `3078895` test(20-01): extend pool events spec to 8 tests (MOD-03 + TRACE-04)

**Acceptance criteria:**

- Task 1.1: all 9 acceptance items pass (file exists; 12 exports present; POOL_AGGREGATE_ID literal correct; 4 registry entries; exactly 1 persisted:true + 3 persisted:false + 4 aggregateType:'pool'; `as const satisfies EventRegistry`; reason enum correct; 6 imports from expected paths; tsc 0 new errors)
- Task 1.2: all 10 acceptance items pass (file exists; ≥5 tests = 8; uuidv5 + asyncLocalStorage imports present; plain-object ALS shape; POOL_AGGREGATE_ID v5 assertion; envelope.correlationId ALS assertion; aggregateType+aggregateId assertions; payload schemas success+failure both; vitest exits 0 with 8 tests; runtime <500ms)

## Self-Check: PASSED

## Next Phase Readiness

- **Plan 20-02 (emission sites)** unblocked — can import `makePoolEmitters` from `../events.js` + wire into PoolManager state transitions (allocate/release/markRunning/addDevice/initPool/replaceDevice) + HealthChecker probe failures + restart paths. Contract proven by events.spec.ts.
- **Plan 20-03 (factory + plugin rewire)** unblocked — can import `poolRegistry` for per-module `new TypedBus<PoolRegistry>(poolRegistry)` construction + `makePoolEmitters(bus, persistEnvelope)` wiring inside `createPoolModule` factory. MOD-06 factory pattern from Phase 18/19 lifts verbatim.
- **Plan 20-04 (DB-gated proofs)** unblocked — `device.health.failed` terminal event persisted:true → Phase 27 trace-tree DB proof feasible (analogous to Phase 19 Plan 19-04 EVENTS-07 terminal-event.spec.ts).
- **Plan 20-05 (MODULE.md + barrel + Nyquist)** unblocked — MOD-01 MODULE.md can cite this plan's events.spec.ts tests for invariant documentation; MOD-02 index.ts barrel can re-export `POOL_EVENT_NAMES`, `POOL_AGGREGATE_ID`, `poolRegistry`, `makePoolEmitters`, payload schemas, and type aliases.
- **Pattern quartet matured:** MOD-03 events.ts template now landed for hooks (16) + lifecycle (18) + reporting (19) + pool (20). Phase 21 artifacts + Phase 22 streaming can lift the pool events.ts as-is with s/pool/artifacts|streaming/ and s/deviceStateSchema + platformSchema/module-specific-schemas/.

---
*Phase: 20-pool-module-devices*
*Completed: 2026-04-21*
