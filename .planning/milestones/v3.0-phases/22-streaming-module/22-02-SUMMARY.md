---
phase: 22-streaming-module
plan: 02
subsystem: streaming
tags: [fastify, typedbus, websocket, mod-06, mod-02, envelope, correlationid, trace-06]

# Dependency graph
requires:
  - phase: 22-streaming-module
    provides: "Plan 22-00 substrate (internal/ throw-stub, dep-cruiser rule); Plan 22-01 wsEnvelopeSchema + streaming events.ts + jobs-registry bridgehead (log/step/status)"
  - phase: 21-artifacts-module
    provides: "MOD-06 factory shape canonical reference + persistEnvelope 5th sample point precedent"
provides:
  - "server/streaming/internal/ directory populated via git mv (5 moves preserving blame)"
  - "server/streaming/internal/module.ts createStreamingModule factory (6-key shape: jobBroadcaster, devicePreview, emit, bus, registerSubscribers, shutdown)"
  - "server/streaming/plugin.ts thin wirer (websocket-plugin name preserved; 5-entry deps)"
  - "JobBroadcaster signature tightened: Map<string,JobMessage[]> -> Map<string,WsEnvelope[]>"
  - "7-callsite surgery in job-service.ts: imperative jobBroadcaster.emit -> typed bus emit via jobsEmit"
  - "SC2 precondition: zero this.jobBroadcaster?.emit( callsites in job-service.ts (cleanup at line 477 KEPT)"
  - "persistEnvelope 6th sample point documented (Phase 27+ consolidation trigger)"
  - "subscriber handler: safeParse wsEnvelope -> frameDropped on failure, broadcaster.emit on success"
affects: [22-03, 22-04, 22-05, 23-jobs-module-keystone, 29-web-refactor]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "MOD-06 factory pattern (Phase 21 artifacts shape adapted to 2 services instead of 6)"
    - "Deferred-to-onReady subscriber registration (Pitfall 2 — streaming at step 10 < jobs at step 13)"
    - "WsEnvelope-typed ring buffer (correlationId + v + ts + payload stamped at subscriber time)"
    - "safeParse drop path emits ws.frame.dropped instead of sending malformed to client"
    - "Thin plugin + internal/module.ts split (plugin = routing + decorators; module = business logic)"

key-files:
  created:
    - "server/streaming/plugin.ts (212 lines; thin Fastify wirer; 5-entry deps; 2 WS routes)"
    - "server/streaming/__tests__/module.spec.ts (143 lines; 10 tests in 3 describe blocks)"
  modified:
    - "server/streaming/internal/module.ts (throw-stub -> full ~240-line createStreamingModule factory)"
    - "server/streaming/internal/job-broadcaster.ts (moved via git mv + signature tightened to WsEnvelope)"
    - "server/streaming/internal/device-preview.ts (moved via git mv)"
    - "server/streaming/internal/types.ts (moved via git mv)"
    - "server/streaming/internal/ws-schemas.ts (moved via git mv)"
    - "server/streaming/internal/adapters/*.ts (moved wholesale via git mv)"
    - "server/index.ts (line 9 import path rewrite)"
    - "server/jobs/job-service.ts (7-callsite surgery + internal/ type-only import paths)"
    - "server/jobs/plugin.ts (adapters import path rewrite)"
    - "contracts/ws-messages.ts (ws-schemas import path rewrite)"
    - "server/artifacts/{artifact,memory}-service.ts (streaming/types path rewrite)"
    - "server/streaming/__tests__/job-broadcaster.test.ts (rewritten to use WsEnvelope)"
  deleted:
    - "server/streaming/websocket-plugin.ts (content split between plugin.ts + internal/module.ts)"

key-decisions:
  - "Plugin NAME 'websocket-plugin' PRESERVED for back-compat (jobs-plugin + pipelines-plugin + plugin-order.spec reference it)"
  - "Dependencies array extended 3 -> 5 entries: +event-bus +db (matches Phase 21 artifacts shape)"
  - "persistEnvelope 6TH sample point — still NOT consolidating (Phase 27+ scope per RESEARCH §Pitfall 11)"
  - "Subscriber handler re-reads correlationId from ALS (TypedBus.emit fires payload-only to bus.on subscribers)"
  - "Signature-tightening of JobBroadcaster happens atomically with the file move (Task 2.1 does both)"
  - "cleanup call at job-service.ts:477 KEPT (buffer lifecycle; SC2 non-violation; Plan 22-04 grep-guard allows <= 1)"

patterns-established:
  - "Type-only imports into internal/ from outside the module acknowledged as temporary (Phase 23 Jobs Keystone cleanup): 4 files affected"
  - "registerSubscribers as Promise<void> return (API-locked for future extensions even though currently sync-ish)"
  - "WsEnvelope wire shape: {type, correlationId, v:1, ts, payload} — envelope's ts replaces producer-set timestamp"

requirements-completed: [TRACE-06, MOD-02, MOD-06, EVENTS-08]

# Metrics
duration: 41min
completed: 2026-04-22
---

# Phase 22 Plan 02: Wave 2 Streaming Factory + 7-Callsite Surgery Summary

**Inverts streaming trigger surface: JobBroadcaster now a bus subscriber consuming `job.log`/`job.step`/`job.status`; every frame wrapped in wsEnvelope with correlationId via createStreamingModule factory (MOD-06).**

## Performance

- **Duration:** 41 min
- **Started:** 2026-04-22T22:55:04Z
- **Completed:** 2026-04-22T23:36:59Z
- **Tasks:** 7
- **Files modified:** 14 (4 created/overwritten, 9 modified, 1 deleted)
- **Commits:** 7 task commits + metadata commit

## Accomplishments

- 5 `git mv` file moves relocate streaming primitives under `internal/` with 100% similarity (blame history preserved — SC for MOD-02 barrel discipline)
- `createStreamingModule` factory (240 lines) replaces Plan 22-00 throw-stub; 6-key return shape mirrors Phase 21 artifacts minus queue surface
- persistEnvelope middleware documented as 6TH sample point (Phase 27+ consolidation trigger)
- Subscriber handler wraps bus payloads → `wsEnvelopeSchema.safeParse` → `broadcaster.emit(jobId, envelope)` OR drops via `emit.frameDropped(...)` on schema failure
- `server/streaming/plugin.ts` thin wirer (212 lines) replaces 175-line `websocket-plugin.ts`; plugin name preserved; deps extended 3→5 entries
- `server/jobs/job-service.ts` 7-callsite surgery: all imperative `this.jobBroadcaster?.emit(...)` calls inverted to `this.jobsEmit?.log|step|status(...)`; `timestamp` field removed from all 7 (envelope `ts` replaces it); cleanup at line 477 KEPT (SC2 non-violation)
- `server/streaming/__tests__/module.spec.ts` — 10 tests proving factory shape, registerSubscribers deferral, shutdown idempotency (PASS 10/10 <500ms, no DB)

## Task Commits

1. **Task 2.1: git mv streaming files under internal/ + tighten broadcaster** — `d515989` (refactor)
2. **Task 2.2: overwrite internal/module.ts with full factory** — `dcf27d3` (feat)
3. **Task 2.3: create thin plugin.ts wirer** — `a8abfd5` (feat)
4. **Task 2.4: delete websocket-plugin.ts** — `a01560d` (refactor)
5. **Task 2.5: update server/index.ts import path** — `ea58637` (refactor)
6. **Task 2.6: invert 7 broadcaster.emit callsites to typed bus emits** — `f92539a` (feat)
7. **Task 2.7: add module.spec.ts** — `94a11ef` (test)

_Plan metadata commit records SUMMARY.md + STATE.md + ROADMAP.md updates._

## Files Created/Modified

### Created
- `server/streaming/plugin.ts` — Thin Fastify plugin wirer (replaces deleted websocket-plugin.ts)
- `server/streaming/__tests__/module.spec.ts` — 10 unit tests for factory shape + subscriber deferral + shutdown idempotency

### Moved (via `git mv`, blame preserved)
- `server/streaming/job-broadcaster.ts` → `server/streaming/internal/job-broadcaster.ts`
- `server/streaming/device-preview.ts` → `server/streaming/internal/device-preview.ts`
- `server/streaming/types.ts` → `server/streaming/internal/types.ts`
- `server/streaming/ws-schemas.ts` → `server/streaming/internal/ws-schemas.ts`
- `server/streaming/adapters/` → `server/streaming/internal/adapters/` (wholesale)

### Modified
- `server/streaming/internal/module.ts` — Throw-stub → full factory body (240 lines)
- `server/streaming/internal/job-broadcaster.ts` — Signature tightened to `WsEnvelope` (emit/subscribe/buffer type)
- `server/jobs/job-service.ts` — 7 callsite surgery + import path rewrite to `internal/`
- `server/index.ts` — Line 9 import: `./streaming/websocket-plugin.js` → `./streaming/plugin.js`
- `contracts/ws-messages.ts` — wsEnvelopeSchema import rewired to `internal/ws-schemas`
- `server/artifacts/artifact-service.ts` — `ArtifactType` import rewired to `internal/types`
- `server/artifacts/memory-service.ts` — `MetricsData` import rewired to `internal/types`
- `server/artifacts/__tests__/artifact-service.spec.ts` — same
- `server/jobs/plugin.ts` — `createAdapterFactory` import rewired to `internal/adapters/`
- `server/streaming/__tests__/{job-broadcaster,adapter-factory,android-preview-adapter,device-preview,ios-preview-adapter}.test.ts` — relative paths adjusted for one-level-deeper + broadcaster test rewritten to WsEnvelope shape

### Deleted
- `server/streaming/websocket-plugin.ts` — Content split between new `plugin.ts` + `internal/module.ts`

## Decisions Made

- **Plugin name preservation:** kept `'websocket-plugin'` despite the module now being a MOD-06 surface — renaming would touch jobs/plugin + pipelines/plugin + plugin-order.spec (scope creep per RESEARCH §Plugin Name Question). Phase 23+ may unify.
- **Dependencies 3 → 5 entries:** added `event-bus` (subscribes to fastify.jobsModule.bus in onReady) and `db` (persistEnvelope short-circuits for persisted:false but declares forward-compat). Matches Phase 21 artifacts canonical shape.
- **persistEnvelope NOT consolidated:** 6th verbatim copy noted in comments; Phase 27+ owns the extraction per RESEARCH §Pitfall 11.
- **Subscriber handler re-reads ALS:** `TypedBus.emit` fires payload-only to `.on` subscribers (no envelope side-channel for bus.on path), so the subscriber must re-read correlationId from ALS instead of relying on envelope propagation.
- **cleanup call KEPT at job-service.ts:477:** buffer lifecycle (not an emit). Plan 22-04 lifecycle-ownership.spec allows count('this.jobBroadcaster?.cleanup(') <= 1 (SC2 non-violation; documented in Plan 22-05 MODULE.md §Non-Goals).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Post-move import path rewrites in downstream consumers**
- **Found during:** Task 2.6 TS compile check (baseline error count spiked from 8 → 34)
- **Issue:** Task 2.1's `git mv` moved 5 files/directories under `internal/` but downstream files still pointed at old paths: `contracts/ws-messages.ts`, `server/artifacts/{artifact,memory}-service.ts`, `server/artifacts/__tests__/artifact-service.spec.ts`, `server/jobs/plugin.ts`, and 5 test files under `server/streaming/__tests__/`
- **Fix:** `sed`-rewrote each occurrence of `../streaming/{job-broadcaster,device-preview,types,ws-schemas,adapters}` → `../streaming/internal/...` (or `../internal/...` for test files already under streaming/)
- **Files modified:** 10 files total
- **Verification:** `npx tsc --noEmit` error count returns to baseline 8 (all pre-existing; zero new errors attributable to Plan 22-02)
- **Committed in:** `f92539a` (Task 2.6 commit)

**2. [Rule 3 - Blocking] job-broadcaster.test.ts rewritten to WsEnvelope shape**
- **Found during:** Task 2.6 TS compile check
- **Issue:** Task 2.1 tightened `JobBroadcaster.emit/subscribe` to `WsEnvelope`, which broke 26 call sites in `server/streaming/__tests__/job-broadcaster.test.ts` that passed legacy `JobMessage` shapes
- **Fix:** Rewrote test file to use `WsEnvelope` fixtures (added `makeEnvelope(type, i)` helper producing `{type, correlationId, v:1, ts, payload}` shape; updated `received` arrays to `WsEnvelope[]`; rewired `payload` reads from `data` in the overflow assertion)
- **Files modified:** `server/streaming/__tests__/job-broadcaster.test.ts` (154 lines rewritten)
- **Verification:** `npx tsc --noEmit` clean for this file; file keeps same 8 tests + 4 describe blocks passing at runtime (pre-existing coverage preserved)
- **Committed in:** `f92539a` (Task 2.6 commit)
- **Note:** Plan 22-05 close-out will rename `.test.ts` → `.spec.ts` per MOD-04 convention.

**3. [Rule 3 - Blocking] Double-call shutdown test expectations fixed**
- **Found during:** Task 2.7 initial vitest run (9/10 pass, 1 fail)
- **Issue:** The "double-call shutdown does not re-unsub" test mocked `on` with `mockReturnValue(unsubLog)` (singular), meaning all 3 subscription calls returned the same unsub fn → shutdown counted 3 calls, not 1
- **Fix:** Changed to `mockReturnValueOnce(unsubLog).mockReturnValueOnce(unsubStep).mockReturnValueOnce(unsubStatus)` matching the factory spec's 3-distinct-handlers expectation, then asserted each unsub invoked exactly once
- **Files modified:** `server/streaming/__tests__/module.spec.ts` (test body for "double-call shutdown does not throw and does not re-unsub")
- **Verification:** 10/10 tests pass in <500ms
- **Committed in:** `94a11ef` (Task 2.7 commit)

### Known Acceptances (plan-anticipated)

**4. [Known — plan-anticipated] 6 new dep-check violations on `no-deep-imports-into-streaming-internal`**
- **Baseline:** 1 violation (`server/jobs/plugin.ts → server/bus/bus.ts`, Phase 23 scope)
- **Current:** 7 violations (baseline + 6 new)
- **New violations:**
  - `server/jobs/plugin.ts → server/streaming/internal/adapters/index.ts` (runtime import of `createAdapterFactory`)
  - `server/jobs/job-service.ts → server/streaming/internal/job-broadcaster.ts` (type-only)
  - `server/jobs/job-service.ts → server/streaming/internal/device-preview.ts` (type-only)
  - `server/artifacts/memory-service.ts → server/streaming/internal/types.ts` (type-only)
  - `server/artifacts/artifact-service.ts → server/streaming/internal/types.ts` (type-only)
  - `server/artifacts/__tests__/artifact-service.spec.ts → server/streaming/internal/types.ts` (type-only)
- **Plan acknowledgment:** Task 2.6 action text says "If `npm run dep-check` fails because dep-cruiser counts `import type` as a violation...add an exception comment noting Phase 23 will remove" — these match RESEARCH §Pitfall 5/6 expectations.
- **Phase 23 scope:** Jobs Keystone will remove the type-only imports entirely (JobBroadcaster/DevicePreviewManager accessed solely via fastify decorator surface by then). The adapters runtime import may be bridged via a streaming barrel export (Plan 22-05) or similar.

**Total deviations:** 3 auto-fixed (3 Rule 3 Blocking — all caused by Task 2.1 file moves or Task 2.1 signature tightening) + 1 known acceptance (plan-anticipated dep-check violations).
**Impact on plan:** Deviations were mechanical plumbing — import path rewrites + test fixture shape updates. Core plan logic unchanged. No scope creep.

## Issues Encountered

- **TS error count spike from 8 → 34 mid-plan** was expected (Tasks 2.1-2.5 intentionally leave broken import paths until Task 2.6 lands the surgery). Plan Task 2.1 acceptance criteria explicitly says "npx tsc --noEmit STILL FAILS (expected — job-service.ts/index.ts still reference old paths; Task 2.3+ fix)."
- **Vitest double-call shutdown test** failed on first run due to mock factory design (see deviation 3). Fixed by matching the factory's 3-handler expectation with 3 distinct `mockReturnValueOnce` calls.

## Next Phase Readiness

- **Plan 22-03 (Wave 3 DB-gated proofs)** unblocked — the factory surface + subscriber wiring are in place for end-to-end bus→envelope→WS tests (`subscriber.spec` + `correlation.spec` + `envelope.spec`).
- **Plan 22-04 (Wave 4 lifecycle-ownership grep-guard)** unblocked — `this.jobBroadcaster?.emit(` count is 0 in job-service.ts; `this.jobBroadcaster!.cleanup(` count is 1 (exactly matches SC2 non-violation allowance).
- **Plan 22-05 (Wave 5 close-out)** — MODULE.md + barrel expansion can now reference the 6-key StreamingModule surface. The `.test.ts` → `.spec.ts` renames will land here (MOD-04).
- **Phase 23 Jobs Keystone** has explicit cleanup scope: remove the 4 remaining type-only imports from `internal/` and replace the 1 runtime `createAdapterFactory` import with a barrel export.

## Self-Check: PASSED

- `server/streaming/plugin.ts` exists — FOUND
- `server/streaming/__tests__/module.spec.ts` exists — FOUND
- `server/streaming/internal/module.ts` has `createStreamingModule` — FOUND
- `server/streaming/internal/job-broadcaster.ts` has `Map<string, WsEnvelope[]>` — FOUND
- `server/streaming/websocket-plugin.ts` does NOT exist — CONFIRMED
- `server/index.ts` has `from './streaming/plugin.js'` — FOUND
- `server/jobs/job-service.ts` has 0 `this.jobBroadcaster?.emit(` — CONFIRMED
- `server/jobs/job-service.ts` has 1 `this.jobBroadcaster!.cleanup(` — CONFIRMED
- Task commits all present in `git log`:
  - `d515989` (Task 2.1) — FOUND
  - `dcf27d3` (Task 2.2) — FOUND
  - `a8abfd5` (Task 2.3) — FOUND
  - `a01560d` (Task 2.4) — FOUND
  - `ea58637` (Task 2.5) — FOUND
  - `f92539a` (Task 2.6) — FOUND
  - `94a11ef` (Task 2.7) — FOUND
- `npx vitest run server/streaming/__tests__/module.spec.ts` — 10/10 PASS
- `npx tsc --noEmit` — 8 errors (baseline unchanged)
- `npm run lint` — clean

---
*Phase: 22-streaming-module*
*Completed: 2026-04-22*
