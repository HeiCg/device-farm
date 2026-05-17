---
phase: 21-artifacts-module
plan: 02
subsystem: events
tags: [zod, event-bus, typed-emitters, uuid-v5, correlation-ids, als]

# Dependency graph
requires:
  - phase: 21-artifacts-module
    provides: Plan 21-00 stub events.ts + empty artifactsRegistry + ARTIFACTS_EVENT_NAMES substrate
  - phase: 19-reporting-migration-webhooks-dlq
    provides: server/jobs/events.ts minimal bridgehead (job.completed) + createEventHelpers + JobsRegistry pattern
  - phase: 20-pool-module-devices
    provides: Plan 20-01 canonical full events.ts body pattern + plain-object ALS store shape + v5 UUID derivation
  - phase: 15-foundations
    provides: server/bus/helpers.ts createEventHelpers + TypedBus + envelopeSchema
provides:
  - Full canonical artifacts events.ts body (3 events + 3 Zod payload schemas + v5 aggregate UUID + makeArtifactsEmitters factory)
  - ARTIFACTS_AGGREGATE_ID real v5 UUID (0bfe29be-7bd1-5f23-ae17-dd867fd062b5) derived from uuidv5('artifacts', URL_NAMESPACE)
  - Extended jobs events.ts bridgehead adding job.started + maestro.log.written (non-persisted) for Phase 21 subscriber wiring
  - 12 tests proving MOD-03 + EVENTS-03 + TRACE-04 + TRACE-08 invariants (ALS correlationId envelope stamping; v5 re-derivation; payload schema accept/reject)
  - Typed makeJobsEmitters returning {started, completed, maestroLogWritten} — types propagate to job-service.ts call sites
affects: [21-04-factory-subscribers-job-service-surgery, 21-03-queue-worker, 21-05-db-gated-proofs, 23-jobs-module-keystone, 27-trace-tree]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "events.ts canonical body pattern (pool/20-01 precedent): event names + v5 aggregate UUID + Zod payloads + registry + makeEmitters factory"
    - "Bridgehead extension pattern for jobs/events.ts (mirrors Phase 19 Plan 19-01 scope discipline — minimal additions without barrel/MODULE.md expansion)"
    - "Plain-object ALS store shape in specs (Phase 20 canonical; no legacy Map([[)"

key-files:
  created: []
  modified:
    - server/artifacts/events.ts (54 → 158 lines; full canonical body + v5 UUID + 3 Zod payloads + makeArtifactsEmitters)
    - server/artifacts/__tests__/events.spec.ts (23 → 177 lines; 1 → 12 tests; 5 describe blocks)
    - server/jobs/events.ts (86 → 158 lines; extended JOB_EVENT_NAMES + 2 new payloads + 3-helper emitter factory)

key-decisions:
  - "ARTIFACTS_AGGREGATE_ID computed offline via uuidv5('artifacts', URL_NAMESPACE) = 0bfe29be-7bd1-5f23-ae17-dd867fd062b5; spec re-derives and asserts exact match"
  - "Persistence per TRACE-08: only artifact.created=true (end-state); recording.started/stopped=false (transient; derivable from subsequent artifact.created)"
  - "aggregateId convention: artifact.created carries artifactId; recording.started/stopped carry recordingId (per-event aggregate); ARTIFACTS_AGGREGATE_ID reserved for future artifacts-wide telemetry"
  - "jobs/events.ts extension keeps bridgehead scope (no MODULE.md, no barrel, no queue.ts) — matches Phase 19 Plan 19-01 precedent; Phase 23 owns full saga"
  - "job.started + maestro.log.written both persisted:false — transient lifecycle derivable from subsequent job.completed + artifact.created rows; preserves events-table budget"
  - "Specs use PLAIN-OBJECT ALS store shape (Phase 20 canonical); 0 matches for legacy `new Map([[` pattern"

patterns-established:
  - "Events.ts body follows pool/20-01 canonical template: (1) file-level docblock enumerating events + persistence + aggregateId; (2) ARTIFACTS_EVENT_NAMES; (3) <MODULE>_AGGREGATE_ID v5 literal; (4) Zod payload schemas with doc-comments citing emit site; (5) <module>Registry `as const satisfies EventRegistry`; (6) make<Module>Emitters factory via createEventHelpers"
  - "Bridgehead extension pattern for jobs/events.ts: add event names + payloads + registry entries + emitter helpers without touching file-level NOTE comments or expanding into MODULE.md/barrel scope"

requirements-completed: [SC1, SC2, MOD-03, EVENTS-03, EVENTS-08, TRACE-04, TRACE-08]

# Metrics
duration: 21min
completed: 2026-04-22
---

# Phase 21 Plan 02: Events Registry + Jobs Bridgehead Extension Summary

**Full canonical artifacts events.ts body (3 events + v5 UUID + makeArtifactsEmitters factory) plus jobs events.ts bridgehead extension adding job.started + maestro.log.written for Phase 21 subscriber wiring**

## Performance

- **Duration:** ~21 min
- **Started:** 2026-04-22T16:56:15Z (immediately after Plan 21-00 close)
- **Completed:** 2026-04-22T17:17:07Z
- **Tasks:** 3 (all `type="auto"` + `tdd="true"`)
- **Files modified:** 3 (server/artifacts/events.ts + server/artifacts/__tests__/events.spec.ts + server/jobs/events.ts)

## Accomplishments
- `server/artifacts/events.ts` full canonical body replacing Plan 21-00 empty stub: ARTIFACTS_EVENT_NAMES (3 dotted past-tense keys); ARTIFACTS_AGGREGATE_ID real v5 UUID `0bfe29be-7bd1-5f23-ae17-dd867fd062b5` derived from `uuidv5('artifacts', '6ba7b811-9dad-11d1-80b4-00c04fd430c8')`; 3 Zod payload schemas (artifactCreated, recordingStarted, recordingStopped); artifactsRegistry with TRACE-08 persistence flags (artifact.created=true; recording.started/stopped=false); makeArtifactsEmitters factory returning 3 typed helpers.
- `server/artifacts/__tests__/events.spec.ts` extended from 1-test stub to 12 tests in 5 describe blocks; proves EVENTS-03 (dotted past-tense); MOD-03 (registry shape + aggregateType='artifacts' on all 3); TRACE-08 (persistence policy); ARTIFACTS_AGGREGATE_ID re-derivation (single-source-of-truth); payload schema accept/reject; makeArtifactsEmitters returns 3 typed helpers; TRACE-04 (emit.artifactCreated stamps envelope with ALS correlationId + aggregateType + aggregateId + v=1).
- `server/jobs/events.ts` extended with 2 new bridgehead events (per RESEARCH §Pattern 4): JOB_EVENT_NAMES gains STARTED='job.started' + MAESTRO_LOG_WRITTEN='maestro.log.written'; jobStartedPayload + maestroLogWrittenPayload (both persisted:false, aggregateType:'job'); makeJobsEmitters returns `{started, completed, maestroLogWritten}`. Existing COMPLETED entry + jobCompletedPayload + persisted:true flag unchanged. Phase 19 Plan 19-01 file-level NOTE comments preserved (bridgehead scope + Phase 23 owns full saga).

## Task Commits

Each task was committed atomically:

1. **Task 2.1: Replace artifacts/events.ts stub with full canonical body** — `6dd0b3b` (feat)
2. **Task 2.2: Extend artifacts events.spec to 12 tests** — `0cb034e` (test)
3. **Task 2.3: Extend jobs/events.ts bridgehead with job.started + maestro.log.written** — `bbd98ad` (feat)

**Plan metadata:** [final commit] (docs: complete 21-02 plan)

## Files Created/Modified
- `server/artifacts/events.ts` - Full canonical body (158 lines; was 54-line stub); MOD-03 compliance
- `server/artifacts/__tests__/events.spec.ts` - 12 tests proving invariants (177 lines; was 23-line stub)
- `server/jobs/events.ts` - Bridgehead extension (158 lines; was 86); unblocks Plan 21-04 subscribers

## Decisions Made

- **ARTIFACTS_AGGREGATE_ID literal vs computed-at-runtime:** Chose offline computation + hardcoded literal `0bfe29be-7bd1-5f23-ae17-dd867fd062b5` with spec re-derivation at test time. Matches Phase 18/19/20 precedent; grep-friendly single source of truth; eliminates runtime uuid dependency.
- **3-event surface (not 4):** Stuck with artifact.created + recording.started + recording.stopped per SC2 contract verbatim. Did NOT add `recording.uploaded` (Plan 21-03 queue worker concern, distinct aggregate lifecycle).
- **recording.stopped transient (not persisted):** durationSec/frameCount/codec are operational debug info; subsequent artifact.created row captures the terminal fact. Preserves events-table budget per TRACE-08 recommendation (RESEARCH §Open Question Q2).
- **Bridgehead extension pattern for jobs/events.ts:** Did NOT ship MODULE.md, barrel, or queue.ts — Phase 23 Jobs Keystone scope. Kept extension minimal (mirrors Phase 19 Plan 19-01).
- **aggregateId per-event vs singleton:** Chose per-event ID (artifactId for artifact.created; recordingId for recording.*) rather than ARTIFACTS_AGGREGATE_ID singleton. Scales with artifact-per-job fan-out; enables Phase 22 Streaming per-recordingId subscription.
- **status enum runtime-accurate ('passed'|'failed'|'cancelled'|'timeout'):** Preserved from Phase 19 Plan 19-01; does NOT switch to the forward-looking saga shape; Phase 23 decision.

## Deviations from Plan

None - plan executed exactly as written.

The plan shipped the file bodies exactly as specified:
- ARTIFACTS_AGGREGATE_ID replaced the `__COMPUTED_V5_VALUE_PASTED_HERE__` placeholder with the offline-computed v5 UUID.
- All three files match the plan's prescribed shape verbatim (event names, payload schemas, registry entries, emitter factory, test descriptions).

Minor editorial: the spec file's grep-guard comment was initially written as `NOT legacy Map shape; grep guard: no \`new Map([[\` in this file` — the literal pattern inside the comment caused the self-referencing grep to match. Updated comment to `grep guard forbids \`new\` + \`Map(\` + array-array init` so the grep count is truly 0. Not a deviation from plan substance.

## Issues Encountered

None - all three tasks shipped first-try. Each task's verification commands passed; vitest 12/12 in 139ms; npx tsc --noEmit shows 10 pre-existing errors (zero attributable to Plan 21-02); npm run lint clean; adjacent test suites (reporting + jobs + artifacts) all green (120 passed + 6 skipped DB-gated in 878ms).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 21-04 subscriber wiring unblocked: both sides of the events contract exist — artifactsRegistry (3 events) + jobsRegistry (3 events); `fastify.jobsModule.bus.on('job.started', ...)` + `fastify.onPersisted('job.completed', ...)` + `bus.on('maestro.log.written', ...)` subscribers all have typed targets in place.
- Plan 21-03 queue worker independent of this plan (no file overlap); can proceed in parallel.
- Plan 21-04 factory consumption: `makeArtifactsEmitters(bus, onEmit)` + extended `makeJobsEmitters` return types propagate to call sites — `this.jobsEmit.started(...)` at job-service.ts line ~208 + `this.jobsEmit.maestroLogWritten(...)` at line ~449 will compile.
- SC1 ("RecordingService/ScreenshotService/MemoryService triggered ONLY by job.started + job.completed bus events; zero direct calls from jobs/job-service.ts") event surface is now complete; remaining work is Plan 21-04 subscriber wiring + job-service.ts imperative-call deletion.
- SC2 ("emits artifact.created, recording.started, recording.stopped") directly satisfied by the artifacts/events.ts body.
- MOD-03 invariants proven via 12 spec tests.

## Self-Check: PASSED

- `server/artifacts/events.ts`: FOUND (158 lines; makeArtifactsEmitters + 3 event names + v5 aggregate + 3 payload schemas + 4 aggregateType='artifacts' matches)
- `server/artifacts/__tests__/events.spec.ts`: FOUND (177 lines; 12 tests in 5 describes pass in 139ms; 0 legacy Map matches)
- `server/jobs/events.ts`: FOUND (158 lines; 3 event names + 3 payloads + 3 emitter helpers + 1 persisted:true + 2 persisted:false)
- Commit `6dd0b3b`: FOUND (feat(21-02): full artifacts events.ts body with 3 events + v5 aggregate id)
- Commit `0cb034e`: FOUND (test(21-02): extend artifacts events.spec with 12 tests)
- Commit `bbd98ad`: FOUND (feat(21-02): extend jobs events.ts bridgehead with job.started + maestro.log.written)
- `npx tsc --noEmit`: 10 pre-existing errors (8 Phase 15 Map-vs-RequestContext + 2 from Plan 21-01 TDD RED artifact-service.test.ts not yet impl); ZERO new from Plan 21-02 files
- `npm run lint`: clean
- Target vitest suite: 12/12 pass in 139ms

---
*Phase: 21-artifacts-module*
*Completed: 2026-04-22*
