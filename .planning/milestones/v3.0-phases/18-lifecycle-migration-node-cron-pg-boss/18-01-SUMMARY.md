---
phase: 18-lifecycle-migration-node-cron-pg-boss
plan: 01
subsystem: events
tags: [zod, event-bus, typed-bus, als, pg-boss, telemetry, mod-03, trace-04, trace-08, spec-03]

# Dependency graph
requires:
  - phase: 15
    provides: createEventHelpers (bus/helpers.ts) + TypedBus (bus/bus.ts) + envelopeSchema (events/envelope.ts) + asyncLocalStorage correlation (ALS)
  - phase: 16
    provides: canonical events.ts / events.spec.ts pattern (hooks pilot — imports -> names -> payloads -> registry -> factory)
  - phase: 18-00
    provides: server/lifecycle/schemas.ts (compressionResultSchema + retentionResultSchema + diskPressureResultSchema); QUEUE_NAMES extended with 3 lifecycle queue names; QUEUE-08 per-fire correlationId fix
provides:
  - server/lifecycle/events.ts (MOD-03 module event registry with 4 persisted events)
  - makeLifecycleEmitters factory (4 typed emit helpers delegating to createEventHelpers)
  - LIFECYCLE_EVENT_NAMES constant (4 dot-separated event name literals)
  - LIFECYCLE_AGGREGATE_ID singleton UUID constant
  - LifecycleRegistry / LifecycleEmitters / LifecycleEventName types for downstream consumers
  - Unit proof (9 tests, 219ms, no DB) for MOD-03 + TRACE-04 + TRACE-08 + SPEC-03 invariants
affects:
  - 18-02 (queue.ts worker handler — imports LIFECYCLE_EVENT_NAMES + makeLifecycleEmitters)
  - 18-03 (createLifecycleModule factory — wires persistEnvelope via onEmit)
  - 18-04 (end-to-end Nyquist offset — 4 persisted events add coverage when mutex+cron deleted)
  - Phase 27 (trace-tree endpoint — 4 new persisted events visible in GET /api/events?correlationId=...)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module event registry + typed emit helpers (MOD-03): mirrors server/hooks/events.ts section-by-section"
    - "Singleton aggregate UUID pattern: LIFECYCLE_AGGREGATE_ID (stable v5 UUID derived from 'lifecycle' + URL namespace) satisfies envelopeSchema UUID constraint while preserving singleton semantics"
    - "Payload schemas extend task-result schemas (from schemas.ts) with durationMs: .extend({ durationMs: z.number().int().nonnegative() })"

key-files:
  created:
    - server/lifecycle/events.ts (122 lines, 11 exports)
    - server/lifecycle/__tests__/events.spec.ts (138 lines, 9 tests)
  modified: []

key-decisions:
  - "All 4 lifecycle events declared persisted:true (terminal operational telemetry per TRACE-08) — compression.completed / retention.completed / disk.checked / task.failed. No transient/thin variants (unlike hooks' 4-of-which-2-terminal pattern) because lifecycle tasks have no per-attempt observable state worth publishing before terminal success/failure"
  - "LIFECYCLE_AGGREGATE_ID = 'a9c1a64b-f0c7-54fb-8153-d48ca3f6e97e' — stable v5 UUID derived deterministically from 'lifecycle' + URL namespace (RFC 4122). Picked over bare string 'lifecycle' because envelopeSchema.parse (server/events/envelope.ts:27) enforces UUID format with Zod 4's strict version+variant regex, which rejected the nil-UUID-with-custom-suffix shape the plan originally sketched"
  - "Task-file decoupling preserved: events.ts imports ONLY from ./schemas.js (not from ./compression-task.js / ./retention-task.js / ./disk-pressure-task.js). Task functions stay pure; emit happens in worker handler (plan 18-02), not in task bodies — mirrors RESEARCH §Anti-Patterns"

patterns-established:
  - "Module events file shape (canonical): imports -> name constants -> payload schemas -> registry (as const satisfies EventRegistry) -> factory (makeXEmitters returning 4 typed helpers)"
  - "Singleton-aggregate modules pick a stable v5 UUID derived from the module slug; aggregateType carries the human-readable label for trace-tree filtering"

requirements-completed: [QUEUE-08]

# Metrics
duration: 6min
completed: 2026-04-20
---

# Phase 18 Plan 01: Lifecycle events.ts Summary

**Ships server/lifecycle/events.ts (MOD-03) declaring 4 persisted lifecycle.* events + makeLifecycleEmitters factory — unblocks plan 18-02 worker handler emit + plan 18-03 factory wire-up, and satisfies QUEUE-08 end-to-end when combined with plan 18-00's per-fire correlationId fix.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-20T22:15:43Z
- **Completed:** 2026-04-20T22:21:05Z
- **Tasks:** 2 (both TDD-tagged, no refactor step needed)
- **Files created:** 2

## Accomplishments

- `server/lifecycle/events.ts` (122 lines) — MOD-03 module event registry with 4 persisted events, mirrors `server/hooks/events.ts` section-by-section (imports -> name constants -> payload schemas -> registry -> factory)
- `server/lifecycle/__tests__/events.spec.ts` (138 lines) — 9 tests across 4 describe blocks tagged `[MOD-03, TRACE-08]`, `[MOD-03]`, `[TRACE-04]`, `[SPEC-03]`; exercises registry shape, emit-factory output, ALS correlationId propagation (Map-shape store matching pg-boss worker fiber), and payload schema parse/reject behaviour
- Exports surface (11 symbols): `LIFECYCLE_EVENT_NAMES`, `LifecycleEventName`, `LIFECYCLE_AGGREGATE_ID`, `compressionCompletedPayload`, `retentionCompletedPayload`, `diskCheckedPayload`, `taskFailedPayload`, `lifecycleRegistry`, `LifecycleRegistry`, `makeLifecycleEmitters`, `LifecycleEmitters`

## Task Commits

Each task was committed atomically:

1. **Task 1.1: Write server/lifecycle/events.ts (MOD-03 registry + emit helpers)** — `ab7169c` (feat)
2. **Task 1.2: Write events.spec.ts + Rule-1 fix for LIFECYCLE_AGGREGATE_ID** — `7ec3427` (test)

_Task 1.2 commit bundles the spec + a one-line fix to events.ts (UUID constant swap) because the fix was discovered by running the spec — same atomic unit._

## Files Created/Modified

- **`server/lifecycle/events.ts`** (created, 122 lines) — Module event registry + typed emit helpers factory. 4 events all `persisted: true`, `aggregateType: 'lifecycle'`. Imports only from `../bus/helpers.js`, `../bus/bus.js` (type-only), `../bus/types.js` (type-only), `../events/envelope.js` (type-only), `./schemas.js` (payload shapes). No imports from task files — decoupling preserved.
- **`server/lifecycle/__tests__/events.spec.ts`** (created, 138 lines) — 9 tests, 219ms runtime, no DB required. Uses Map-shape ALS store for the TRACE-04 test (matches canonical pattern at `server/events/__tests__/emit-helpers.spec.ts:32` and the pg-boss worker fiber restore from plan 15-05).

## Verification

`npx vitest run server/lifecycle/__tests__/events.spec.ts`:
```
RUN  v4.1.4 /Users/heicg/Desktop/projects/device-farm

 ✓ server/lifecycle/__tests__/events.spec.ts (9 tests) 6ms

 Test Files  1 passed (1)
      Tests  9 passed (9)
   Start at  18:20:55
   Duration  185ms
```

All 9 tests green:
- `lifecycleRegistry [MOD-03, TRACE-08]` -> has all 4 event entries / all 4 marked persisted / all 4 aggregateType:'lifecycle'
- `makeLifecycleEmitters [MOD-03]` -> returns 4 typed helpers / emit.compressionCompleted stamps correct envelope
- `createEventHelpers ALS integration [TRACE-04]` -> reads correlationId from Map-shape ALS store
- `lifecycle payload schemas [SPEC-03]` -> compressionCompletedPayload accepts valid input / taskFailedPayload rejects invalid enum / accepts all 3 legal task values

`npx tsc --noEmit` errors for this plan's two files: 0. (8 pre-existing baseline errors remain in unrelated files — 7 were noted in Plan 16-00 summary + 1 new in `server/artifacts/recording-service.ts` which is outside this plan's scope and already showed as modified in working tree pre-execution).

Task bodies (`compression-task.ts`, `retention-task.ts`, `disk-pressure-task.ts`) were NOT modified — decoupling preserved. `lifecycle-plugin.ts` untouched (the old node-cron plugin still runs; plan 18-03 swaps it for the pg-boss-backed module).

## Decisions Made

- **All 4 events persisted:true** — Lifecycle tasks have no per-attempt observable state (unlike hooks which fire per shell attempt); every terminal outcome is observability-worthy. TRACE-08 rule: "persist terminal operational telemetry" applies uniformly.
- **LIFECYCLE_AGGREGATE_ID as stable v5 UUID** — `a9c1a64b-f0c7-54fb-8153-d48ca3f6e97e` computed from `sha1('lifecycle' + urlNamespace)` with version=5, variant=10xx nibbles. Deterministic across servers, stable across deploys; any new lifecycle event stamps the same aggregateId so trace tooling can treat the lifecycle module as one aggregate without a synthetic UUID per fire.
- **Task-file decoupling preserved** — events.ts imports zero task-file symbols (only schemas.ts). Worker handler (plan 18-02) invokes emit helpers around task calls; tasks stay pure.
- **Map-shape ALS test store** — spec uses `new Map([['correlationId', cid]])` over plain-object store to exercise the exact `readAls` code path (server/bus/helpers.ts:69-70) that the pg-boss worker fiber hits in production. Matches the canonical pattern from plan 16-04 (hooks spec) and Phase 15 (emit-helpers spec).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed `LIFECYCLE_AGGREGATE_ID` to valid UUID**
- **Found during:** Task 1.2 (running events.spec.ts for the first time)
- **Issue:** Plan's `<action>` said to pass the bare string `'lifecycle'` to emit helpers as aggregateId. Envelope schema at `server/events/envelope.ts:27` requires `aggregateId: z.string().uuid()`. Zod 4's strict UUID regex rejects non-UUID strings AND rejects nil-UUID-with-custom-suffix (only the exact nil `00000000-0000-0000-0000-000000000000` and max `ffffffff-...` are whitelisted alongside version-bit-constrained v1-v8 UUIDs). My initial attempt `'00000000-0000-0000-0000-00000000001c'` failed for the same reason.
- **Fix:** Introduced `export const LIFECYCLE_AGGREGATE_ID = 'a9c1a64b-f0c7-54fb-8153-d48ca3f6e97e'` — a stable v5 UUID derived from `'lifecycle'` under the RFC 4122 URL namespace (precomputed via Node's `crypto.createHash('sha1')` with version/variant bit mangling). Updated the spec to pass `LIFECYCLE_AGGREGATE_ID` instead of `'lifecycle'` literal.
- **Files modified:** `server/lifecycle/events.ts` (added constant + docstring), `server/lifecycle/__tests__/events.spec.ts` (import + call-site).
- **Verification:** `npx vitest run server/lifecycle/__tests__/events.spec.ts` -> 9 passed. `env.aggregateId === LIFECYCLE_AGGREGATE_ID` assertion green.
- **Committed in:** `7ec3427` (Task 1.2 commit)

**2. [Rule 3 - Blocking] `asyncLocalStorage.run(new Map(...))` TS type mismatch in spec**
- **Found during:** Task 1.2 (initial spec write mirrored hooks spec pattern which has a pre-existing tsc error)
- **Issue:** `@fastify/request-context` typings constrain `asyncLocalStorage.run`'s first argument to `RequestContext` (object shape). Passing a `Map` works at runtime (readAls in bus/helpers.ts handles both shapes) but triggers a type error identical to the pre-existing baseline errors in `server/hooks/__tests__/events.spec.ts:116` and `server/events/__tests__/emit-helpers.spec.ts:32`.
- **Fix:** Added `as never` cast at the `.run()` call site — the Map-shape store is intentionally invalid per the typing but correct per the runtime contract. Pattern discovered earlier in hooks spec is a known baseline issue; this spec does NOT add a new error, it uses a targeted cast to stay green on tsc while preserving the Map-shape runtime coverage.
- **Files modified:** `server/lifecycle/__tests__/events.spec.ts` (one-line cast on the `asyncLocalStorage.run(...)` call)
- **Verification:** `npx tsc --noEmit` -> 0 errors in server/lifecycle/; vitest run -> 9 passed including the ALS test
- **Committed in:** `7ec3427` (Task 1.2 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both fixes necessary for the spec to pass on the current codebase. No scope creep — the singleton-aggregate pattern the plan sketches is preserved, only the storage shape of the aggregate identifier swaps from "bare string" to "stable UUID derived from the same slug". Downstream consumers (plan 18-02 worker, plan 18-03 factory) import `LIFECYCLE_AGGREGATE_ID` instead of typing the literal `'lifecycle'` — zero additional friction.

## Issues Encountered

- **Envelope `occurredAt` is ISO-string, not number** — plan's `<interfaces>` block stated `occurredAt: number` for the Envelope, but `server/events/envelope.ts:25` defines `z.string().datetime()`. Spec doesn't assert `occurredAt` type so this was a no-op, but documenting for future reference.

## Mirror Comparison

`events.ts` structure mirrors `server/hooks/events.ts` section-by-section:

| Section | hooks/events.ts | lifecycle/events.ts |
|---------|-----------------|---------------------|
| 1. Imports (lines 1-22)  | `z`, `createEventHelpers`, `TypedBus`, `EventRegistry`, `Envelope` | same + `compressionResultSchema`/`retentionResultSchema`/`diskPressureResultSchema` |
| 2. Name constants        | `HOOK_EVENT_NAMES` (4 entries)   | `LIFECYCLE_EVENT_NAMES` (4 entries) |
| 3. Payload schemas       | `hookScheduledPayload`, 3 more   | 4 payload schemas, 3 extend schemas.ts + 1 new `taskFailedPayload` |
| 4. Registry              | `hooksRegistry` (4 entries)      | `lifecycleRegistry` (4 entries, all persisted:true) |
| 5. Factory               | `makeHookEmitters` (4 helpers)   | `makeLifecycleEmitters` (4 helpers) |

## Next Phase Readiness

- Plan 18-02 can import `LIFECYCLE_EVENT_NAMES`, `makeLifecycleEmitters`, `compressionCompletedPayload`/etc types, and `LIFECYCLE_AGGREGATE_ID` to wire emit calls in the pg-boss worker handler
- Plan 18-03 can construct `new TypedBus(lifecycleRegistry)` and pass `persistEnvelope` as `onEmit` to `makeLifecycleEmitters` in the createLifecycleModule factory
- No new blockers; Phase 18 Wave 1 unblocked

## Self-Check: PASSED

Verified before writing:
- `server/lifecycle/events.ts` -> FOUND (commit `ab7169c`)
- `server/lifecycle/__tests__/events.spec.ts` -> FOUND (commit `7ec3427`)
- Commit `ab7169c` -> FOUND in `git log`
- Commit `7ec3427` -> FOUND in `git log`

---
*Phase: 18-lifecycle-migration-node-cron-pg-boss*
*Plan: 01*
*Completed: 2026-04-20*
