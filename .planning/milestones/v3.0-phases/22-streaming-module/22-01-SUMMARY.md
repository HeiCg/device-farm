---
phase: 22-streaming-module
plan: 01
subsystem: streaming
tags: [zod, event-bus, websocket, typedbus, uuid-v5, ALS, MOD-03, TRACE-06, EVENTS-03, TRACE-08]

# Dependency graph
requires:
  - phase: 22-streaming-module
    provides: Plan 22-00 Wave 0 substrate — streaming/events.ts stub + streaming/__tests__/events.spec.ts stub + streaming/ws-schemas.ts placeholder + JOB_EVENT_NAMES.LOG/STEP/STATUS placeholder keys
  - phase: 21-artifacts-module
    provides: Plan 21-02 precedent — events.ts full body shape + jobs/events.ts bridgehead extension pattern (streaming mirrors artifacts for 1-event/3-new-bridgehead-events variant)
  - phase: 15-foundations
    provides: createEventHelpers factory at server/bus/helpers.ts (ALS-aware envelope stamping); TypedBus<R>; EventRegistry shape
provides:
  - streamingRegistry (MOD-03) with 1 event (ws.frame.dropped) persisted:false + aggregateType:'streaming'
  - Real STREAMING_AGGREGATE_ID v5 UUID fff0592e-b92c-5221-a40a-d10a141f0158 derived from uuidv5('streaming', URL_NAMESPACE)
  - wsFrameDroppedPayload Zod schema (jobId + eventType + reason + zodError?)
  - makeStreamingEmitters factory (1 typed helper: frameDropped)
  - Strict wsEnvelopeSchema (TRACE-06) — v:literal(1) required, correlationId uuid required, ts datetime, payload unknown; .loose() removed
  - jobsRegistry extension 3→6 entries (job.log + job.step + job.status all persisted:false)
  - makeJobsEmitters extension 3→6 helpers (log, step, status added)
  - 12 tests proving EVENTS-03 + TRACE-04 + TRACE-08 + MOD-03 invariants for streaming module
affects: [phase-22-plan-22-02, phase-22-plan-22-03, phase-22-plan-22-04, phase-22-plan-22-05, phase-23-jobs-module-keystone, phase-27-trace-tree, phase-29-web-refactor]

# Tech tracking
tech-stack:
  added: []  # no new npm deps
  patterns:
    - "MOD-03 1-event registry pattern (matches Phase 19 reporting single-event variant)"
    - "Bridgehead events pattern (Phase 19/21 precedent — add events + payload + registry + emit helpers to jobs/events.ts without creating jobs/MODULE.md or jobs/index.ts; Phase 23 owns full saga)"
    - "TRACE-06 strict envelope locked — v=1 required, correlationId uuid required, ts datetime, payload unknown; subscriber safeParse contract ready"
    - "Plain-object ALS store shape canonical (Phase 20 form; legacy Map shape forbidden by grep-guard)"
    - "Nullable+optional schema fields tolerate existing job-service.ts callsite shapes (jobStepPayload.command + durationMs — Pitfall 5 handling)"

key-files:
  created: []
  modified:
    - server/streaming/events.ts (stub → full body, 133 lines)
    - server/streaming/__tests__/events.spec.ts (29-line stub → 160-line spec with 12 tests)
    - server/streaming/ws-schemas.ts (21-line placeholder → 77-line strict envelope)
    - server/jobs/events.ts (169 lines → 262 lines; 3 new payloads + 3 registry entries + 3 new emitter helpers)

key-decisions:
  - "ws.frame.dropped stays persisted:false — programmer-error signal sufficient via structured pino log per TRACE-08 (events-table bloat unjustified)"
  - "aggregateId for ws.frame.dropped = jobId (not STREAMING_AGGREGATE_ID) — scales with per-job fan-out; STREAMING_AGGREGATE_ID RESERVED for future streaming-wide telemetry (streaming.buffer.overflow)"
  - "jobStepPayload.command + durationMs are .nullable().optional() — tolerates both onFlowStart (no command/duration) and onFlowResult (no command) callsites without producer-side changes (RESEARCH §Pitfall 5)"
  - "jobStatusPayload.status enum is INTENTIONALLY wider than jobCompletedPayload.status (adds 'running') — job.status is streaming-signal; job.completed is persisted-terminal-fact; do NOT unify (RESEARCH §Open Questions point 5 — Phase 23 scope)"
  - "wsEnvelopeSchema tightened with no backward-compat alias — consumers (contracts/ws-messages.ts) continue to parse; tightening is pure widening of required fields"
  - "1 streaming event (ws.frame.dropped) — CONTEXT §Decisions contract verbatim; not flipped to 2+ events"

patterns-established:
  - "1-event module registry (followed Phase 19 reporting precedent; artifacts has 3, streaming has 1 — shape identical)"
  - "Strict WS envelope schema (v:literal, correlationId uuid, ts datetime, payload unknown) supersedes Phase 17 placeholder"
  - "Jobs bridgehead extension discipline (add events + schemas + registry entries + emit helpers WITHOUT jobs/MODULE.md or jobs/index.ts; Phase 23 owns full saga)"

requirements-completed: [TRACE-06, MOD-03, EVENTS-03, EVENTS-04, EVENTS-08, TRACE-04, TRACE-08]

# Metrics
duration: 15min
completed: 2026-04-22
---

# Phase 22 Plan 22-01: Streaming Events Body + Strict Envelope + Jobs Bridgehead Summary

**Replaced Plan 22-00 streaming/events.ts stub with full MOD-03 body (1-event registry + real v5 UUID + wsFrameDroppedPayload + makeStreamingEmitters), tightened ws-schemas.ts wsEnvelopeSchema to TRACE-06 strict (v/correlationId/ts/payload required), and extended jobs/events.ts with 3 bridgehead payloads (job.log / job.step / job.status) + registry entries + makeJobsEmitters log/step/status helpers — Plan 22-02 subscriber wiring now has both sides typed.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-04-22T22:33:57Z
- **Completed:** 2026-04-22T22:49:49Z
- **Tasks:** 4
- **Files modified:** 4

## Accomplishments

- **streaming/events.ts full canonical body** — replaced 54-line Plan 22-00 stub with 133 lines: 1-entry `streamingRegistry` (`ws.frame.dropped`, persisted:false, aggregateType:'streaming') + real v5 UUID `fff0592e-b92c-5221-a40a-d10a141f0158` (derived via `uuidv5('streaming', URL_NAMESPACE)` matching Phase 18/19/20/21 derivation pattern) + Zod `wsFrameDroppedPayload` schema + `makeStreamingEmitters` factory wrapping `createEventHelpers` + `StreamingRegistry`/`StreamingEmitters`/`StreamingEventName` types exported.
- **streaming/__tests__/events.spec.ts extended to 12 tests across 5 describe blocks** — proves EVENTS-03 (dotted past-tense), MOD-03 (registry shape), TRACE-08 (persistence flag), single-source-of-truth v5 derivation, wsFrameDroppedPayload validation (accepts + rejects), and TRACE-04 ALS correlationId envelope stamping using plain-object ALS store shape per Phase 20 canonical. Runs in 156ms, no DB.
- **ws-schemas.ts tightened to strict Phase 22 envelope** — `.loose()` removed, `v: z.literal(1)` now required (was optional), `ts: z.string().datetime()` added, `payload: z.unknown()` added, `type` tightened to `z.string().min(1)`. TRACE-06 contract locked: every job-channel WS frame carries correlationId + v=1 + ts + typed payload; Plan 22-02 subscriber can now call `wsEnvelopeSchema.safeParse(candidate)` with structured success/failure.
- **jobs/events.ts extended 169→262 lines** — 3 new Zod payload schemas (`jobLogPayload`, `jobStepPayload`, `jobStatusPayload`) matching existing `LogData`/`StepData`/`StatusData` shapes at `server/streaming/types.ts`; `jobsRegistry` extended 3→6 entries all `persisted:false`; `makeJobsEmitters` extended 3→6 helpers. Schema design tolerates both `onFlowStart` (no command/duration) and `onFlowResult` (no command) callsites via `.nullable().optional()`; `jobStatusPayload.status` intentionally wider (5 values incl. 'running') than `jobCompletedPayload.status` (4 terminal values).

## Task Commits

Each task was committed atomically:

1. **Task 1.1: Replace streaming/events.ts stub with full canonical body** — `0a0f41e` (feat)
2. **Task 1.2: Extend streaming events.spec.ts from stub to full coverage (12 tests)** — `40c377a` (test)
3. **Task 1.3: Tighten ws-schemas.ts to strict Phase 22 envelope** — `ef66c99` (feat)
4. **Task 1.4: Extend jobs/events.ts with log/step/status bridgehead** — `eeac5bf` (feat)

## Files Created/Modified

**Modified (4):**
- `server/streaming/events.ts` — stub (54 lines) → full canonical body (133 lines) with registry + v5 + payload schema + emit factory
- `server/streaming/__tests__/events.spec.ts` — 1-test stub (29 lines) → 12-test coverage (160 lines) across 5 describe blocks
- `server/streaming/ws-schemas.ts` — Phase 17 placeholder (21 lines) → strict Phase 22 envelope (77 lines); .loose() removed, v required, ts+payload added
- `server/jobs/events.ts` — extended 169 → 262 lines (file-header update + 3 new Zod payload schemas + 3 new registry entries + 3 new emitter helpers)

## Decisions Made

- **Persistence flag:** `ws.frame.dropped` stays `persisted:false` — programmer-error signal, structured pino log is sufficient per TRACE-08; events-table bloat unjustified. Future ops dashboards can consume the bus event directly (Phase 19 DLQ notable-event precedent).
- **aggregateId for ws.frame.dropped:** jobId (not STREAMING_AGGREGATE_ID) — scales with per-job fan-out; matches Phase 21 artifactId/recordingId pattern. `STREAMING_AGGREGATE_ID` is RESERVED for future streaming-wide telemetry (e.g. `streaming.buffer.overflow`).
- **jobStepPayload schema widening:** `command: z.string().nullable().optional()` + `durationMs: z.number().int().nonnegative().nullable().optional()` tolerate both `onFlowStart` (no command/duration) and `onFlowResult` (no command) callsites in job-service.ts without producer-side changes. Prevents emit-time ZodError (RESEARCH §Pitfall 5).
- **jobStatusPayload vs jobCompletedPayload:** INTENTIONALLY separate — `job.status` (5-value enum including 'running') is a streaming signal covering full lifecycle; `job.completed` (4-value terminal enum) is a persisted terminal fact. Do NOT unify (RESEARCH §Open Questions point 5 — Phase 23 saga scope).
- **wsEnvelopeSchema strict tightening:** No backward-compat alias introduced — the only consumer (`contracts/ws-messages.ts`) just adds it to a Zod registry so tightening is a pure widening of required fields at the API boundary. Breaks nothing that used to work.
- **1 streaming event surface:** CONTEXT §Decisions contract verbatim — did NOT add a 2nd event. `ws.frame.dropped` is the ONLY event streaming module emits; all other inbound-to-outbound flow runs through JobBroadcaster.

## Deviations from Plan

None — plan executed exactly as written.

One minor polish inside the execution loop: when running the spec's grep-guard against `new Map([[` I found the spec's own doc comment contained the literal pattern inside backticks as a descriptive note (line 14), creating a self-reference false positive. I rewrote the comment to describe the guard in prose ("grep guard forbids new-Map-with-entries pattern") without using the forbidden literal. This is a pure doc tweak — no code path changed, and no actual `new Map([[...]])` is used anywhere in the spec.

## Issues Encountered

None. All 4 tasks green on first pass:
- `npx tsc --noEmit` → 8 pre-existing errors across 6 files (documented in STATE.md; ZERO new errors from Plan 22-01)
- `npm run lint` → clean (all 4 modified files are in `.ts` and pass eslint; events.ts files allow-listed by no-direct-bus-emit rule)
- `npx vitest run server/streaming/__tests__/events.spec.ts` → 12/12 pass in 156ms
- `npx vitest run server/jobs/ server/streaming/ server/reporting/ server/artifacts/` → 218 tests pass / 13 skipped (DB-gated) / 0 failed in 1.49s — no regression in sibling modules

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Plan 22-02 (Wave 2 factory + plugin rewire + 7-callsite surgery) unblocked:**
- Streaming-side typed emit ready: `makeStreamingEmitters(bus, onEmit).frameDropped(jobId, {jobId, eventType, reason, zodError?})`
- Jobs-side bus-consumption ready: `fastify.jobsModule.bus.on('job.log'|'job.step'|'job.status', handler)` with full Zod payload validation
- Jobs-side emit ready: `jobsEmit.log/step/status(jobId, {...})` — job-service.ts 7-callsite surgery at lines 263/284/308/315/334/342/430 can now replace `this.jobBroadcaster?.emit(...)` with `this.jobsEmit?.log/step/status(...)`
- TRACE-06 envelope contract locked — subscriber can call `wsEnvelopeSchema.safeParse(candidate)` with structured success/failure; failure path routes to `emit.frameDropped`

**No blockers for Plan 22-02.** ROADMAP SC1 ("Every WS frame carries `correlationId` in its envelope") + SC2 ("JobBroadcaster receives input from bus subscriptions") now both have their foundations landed.

## Self-Check: PASSED

Files verified:
- FOUND: server/streaming/events.ts (133 lines, full canonical body)
- FOUND: server/streaming/__tests__/events.spec.ts (160 lines, 12 tests pass in 156ms)
- FOUND: server/streaming/ws-schemas.ts (77 lines, strict envelope)
- FOUND: server/jobs/events.ts (262 lines, 6-event registry + 6-helper makeJobsEmitters)

Commits verified:
- FOUND: 0a0f41e (Task 1.1 — streaming/events.ts full body)
- FOUND: 40c377a (Task 1.2 — streaming events.spec extended to 12 tests)
- FOUND: ef66c99 (Task 1.3 — ws-schemas.ts tightened)
- FOUND: eeac5bf (Task 1.4 — jobs/events.ts bridgehead extension)

---
*Phase: 22-streaming-module*
*Completed: 2026-04-22*
