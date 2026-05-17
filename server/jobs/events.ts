/**
 * Phase 19 / Plan 19-01 — Minimal jobs module event registry (MOD-03 prep).
 *
 * Declares ONE event: `job.completed`.
 *
 * Scope discipline: this file is the MINIMAL bridgehead that unblocks ROADMAP
 * Phase 19 SC3 ("Reporting module subscribes to `job.completed` from the bus").
 * Phase 23 (Jobs Module Keystone) extends this registry with the full saga:
 *   job.queued → job.allocated → job.running → job.completed → job.recording → job.webhook → job.cleanup
 * Per EVENTS-10 in .planning/REQUIREMENTS.md.
 *
 * Phase 21 / Plan 21-02 — Bridgehead extension (RESEARCH §Pattern 4 + §Open
 * Question Q3 option b2). Adds TWO transient events the artifacts module
 * subscribes to:
 *   - `job.started`          (not persisted) — fires from job-service.ts after
 *     device is allocated + DB status='running' + BEFORE Maestro execution.
 *     Artifacts subscriber → starts recording + memory sampling.
 *   - `maestro.log.written`  (not persisted) — fires from job-service.ts after
 *     writeFile(maestro.log) resolves. Artifacts subscriber creates the log
 *     artifact row (SC1: zero direct calls from job-service into artifact
 *     services; EVENTS-04 thin-payload rule preserved — rawOutput does NOT
 *     cross the bus envelope).
 *
 * Phase 19 does NOT create a jobs/MODULE.md, jobs/index.ts barrel, or
 * jobs/queue.ts — those are Phase 23's scope. Phase 21 Plan 21-02 ALSO does
 * NOT ship those (bridgehead scope discipline matches Phase 19 Plan 19-01).
 * The bus subscriber that consumes `job.completed` lives in
 * server/reporting/internal/module.ts (plan 19-03); the subscribers that
 * consume `job.started` + `maestro.log.written` land in
 * server/artifacts/internal/module.ts (plan 21-04).
 *
 * aggregateId for `job.*` = the jobId (which is a UUID per the existing jobs
 * DB schema). This differs from reporting's singleton aggregate — there are
 * many jobs, each its own aggregate.
 *
 * Phase 22 / Plan 22-00 — Extends JOB_EVENT_NAMES with 3 placeholder keys
 * (LOG, STEP, STATUS) for streaming module bridgehead. Plan 22-01 adds the
 * payload schemas + jobsRegistry entries + makeJobsEmitters return-shape
 * extension (mirrors Phase 21 Plan 21-02 shape). job-service.ts 7-callsite
 * surgery lands in Plan 22-02.
 *
 * Phase 23 / Plan 23-00 — Extends JOB_EVENT_NAMES with 5 new keys for the
 * jobs keystone saga: ALLOCATED, RUNNING, RECORDING_REQUESTED,
 * CLEANUP_REQUESTED, FAILED. Plan 23-01 adds the payload schemas + registry
 * entries + makeJobsEmitters return-shape extension. Plan 23-04 wires the
 * saga subscribers + emits. EVENTS-10 saga semantics:
 *   - job.allocated:   pool emits device.allocated → jobs subscriber writes
 *                      jobs.status='allocated' + emits job.allocated
 *   - job.running:     job-execute worker starts maestro → emits job.running
 *   - job.recording.requested: post-completion artifact hand-off (PERSISTED)
 *   - job.cleanup.requested:   post-completion broadcaster cleanup hand-off (PERSISTED)
 *   - job.failed:      saga error path; subscribers do per-step recovery (PERSISTED)
 *
 * Phase 22 / Plan 22-01 — Bridgehead extension (RESEARCH §Jobs Events
 * Bridgehead Extension + Primary recommendation Option A). Adds THREE
 * transient events the streaming module subscribes to:
 *   - `job.log`              (not persisted) — fires from job-service.ts
 *     onStdoutLine + onCommandStatus callbacks (10-100/sec during active job).
 *     Streaming subscriber wraps in wsEnvelope + pushes to JobBroadcaster ring
 *     buffer + fans out to live WS listeners. Derivable from on-disk
 *     maestro.log so NOT persisted.
 *   - `job.step`             (not persisted) — fires from job-service.ts
 *     onFlowStart + onFlowResult callbacks (10-50/job). Derivable from
 *     jobSteps DB table so NOT persisted.
 *   - `job.status`           (not persisted) — fires from job-service.ts at
 *     running/passed/failed/cancelled/timeout transitions (2-5/job). The
 *     terminal transition (to passed/failed/cancelled/timeout) is ALREADY
 *     persisted via job.completed (Phase 19) — job.status duplicates the
 *     surface for streaming purposes with NO persistence to avoid bloat.
 *
 * Phase 22 does NOT create a jobs/MODULE.md, jobs/index.ts barrel, or
 * jobs/queue.ts — those are Phase 23 keystone scope (mirrors Phase 21's
 * scope discipline). The bus subscribers that consume `job.log`/`job.step`/
 * `job.status` live in server/streaming/internal/module.ts (plan 22-02).
 *
 * NOTE on status enum: the plan text specified the three values
 * ['completed', 'failed', 'cancelled'] as a forward-looking saga shape, but
 * the current runtime `ExecutionResult.status` at server/jobs/job-executor.ts:20
 * is `'passed' | 'failed' | 'timeout' | 'cancelled'` (matches jobStatusEnum
 * in server/db/schema.ts). We use the runtime-accurate union so job-service
 * (the sole Phase 19 emitter) does not violate the schema at emit time. Phase
 * 23 can reshape this when it lands the full saga — widening vs narrowing vs
 * semantic mapping (`passed`→`completed`) is a Phase 23 decision, not a
 * Phase 19 blocker.
 *
 * This file is allowlisted by eslint-local-rules/no-direct-bus-emit.js
 * (pattern /\/events\.ts$/).
 */
import { z } from 'zod';

import { createEventHelpers } from '../bus/helpers.js';
import type { TypedBus } from '../bus/bus.js';
import type { EventRegistry } from '../bus/types.js';
import type { Envelope } from '../events/envelope.js';

/**
 * Event-name constants. Phase 23 will add the full saga (queued / allocated /
 * running / recording / cleanup).
 *
 * Phase 19 Plan 19-01 — added COMPLETED (reporting bridgehead).
 * Phase 21 Plan 21-02 — added STARTED + MAESTRO_LOG_WRITTEN (artifacts bridgehead).
 * Phase 22 Plan 22-00 — adds LOG + STEP + STATUS placeholders (streaming bridgehead;
 *                        payload schemas + registry entries + makeJobsEmitters return-shape
 *                        extension land in Plan 22-01 following Phase 21 Plan 21-02 pattern).
 */
export const JOB_EVENT_NAMES = {
  STARTED:             'job.started',
  COMPLETED:           'job.completed',
  MAESTRO_LOG_WRITTEN: 'maestro.log.written',
  // Phase 22 Plan 22-00 — streaming bridgehead (now full body in Plan 22-01).
  LOG:                 'job.log',
  STEP:                'job.step',
  STATUS:              'job.status',
  // Phase 23 Plan 23-00 — keystone saga placeholder keys; payload schemas
  // + registry entries + makeJobsEmitters return-shape extension land in
  // Plan 23-01. EVENTS-10 saga: queued → allocated → running → completed
  // → recording → webhook → cleanup. `queued` already covered by HTTP
  // route handler (POST /api/jobs); webhook is a `reporting` queue trigger
  // (Phase 19), not an emit. The 5 emits owned by jobs are:
  ALLOCATED:           'job.allocated',
  RUNNING:             'job.running',
  RECORDING_REQUESTED: 'job.recording.requested',
  CLEANUP_REQUESTED:   'job.cleanup.requested',
  FAILED:              'job.failed',
  // Phase 23 Plan 23-05 — system.drain.* events (DEFERRED-23-B: live in
  // jobsRegistry for proximity to drain endpoint; Phase 27+ may extract to
  // a system module). aggregateType:'system' (NOT 'job') discriminates for
  // trace-tree consumption. Both PERSISTED per TRACE-08 (operational telemetry).
  DRAIN_COMPLETED:     'system.drain.completed',
  DRAIN_RESUMED:       'system.drain.resumed',
} as const;

export type JobEventName = typeof JOB_EVENT_NAMES[keyof typeof JOB_EVENT_NAMES];

// ---------- Payload schemas ----------

/**
 * Payload shape for job.completed. Thin (EVENTS-04 default): jobId + status
 * + platform + optional summary. Consumers (reporting) re-fetch the full
 * job row from DB if they need more.
 *
 * `status` enum matches ExecutionResult.status at runtime (Phase 19 Rule-1
 * deviation — see file-level NOTE). Phase 23 owns any saga-time widening.
 */
export const jobCompletedPayload = z.object({
  jobId: z.string(),
  status: z.enum(['passed', 'failed', 'cancelled', 'timeout']),
  platform: z.enum(['android', 'ios']),
  summary: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Phase 21 Plan 21-02 — fires from job-service.ts after device is allocated
 * + DB status updated to 'running', BEFORE Maestro execution. The artifacts
 * module subscribes via fastify.jobsModule.bus.on('job.started', ...) and
 * starts recording + memory sampling.
 *
 * Thin payload per EVENTS-04. Platform discriminator lets the subscriber
 * choose Android vs iOS code paths without re-fetching the job row.
 *
 * jobId is z.string() (NOT .uuid()) to match the existing Phase 19 bridgehead
 * jobCompletedPayload's relaxed typing — the runtime jobId IS a UUID but the
 * existing jobCompletedPayload has `z.string()` too (Phase 19 Plan 19-01 NOTE
 * explains the rationale).
 */
export const jobStartedPayload = z.object({
  jobId: z.string(),
  deviceId: z.string(),
  platform: z.enum(['android', 'ios']),
});

/**
 * Phase 21 Plan 21-02 — RESEARCH §Open Question Q3 option b2 (strict SC1).
 *
 * Fires from job-service.ts AFTER writeFile(maestro.log) resolves but BEFORE
 * any artifactService.createArtifact call — the artifacts module subscribes,
 * reads file stat if fileSizeBytes is null, and creates the log artifact row
 * idempotently via its own subscriber path. This inverts the last imperative
 * `artifactService.createArtifact({type: 'log'})` call in job-service.ts
 * (lines 445-462) without requiring the full rawOutput to cross the bus
 * envelope (EVENTS-04 thin-payload rule).
 *
 * Phase 23 Jobs Keystone may replace this with a saga-native event
 * (e.g. job.logged) when it rewrites job-service.ts entirely. Phase 21 uses
 * this bridgehead extension exactly matching the Phase 19 Plan 19-01 shape.
 */
export const maestroLogWrittenPayload = z.object({
  jobId: z.string(),
  filePath: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  fileSizeBytes: z.number().int().nonnegative().nullable(),
});

/**
 * Phase 22 Plan 22-01 — fires from job-service.ts onStdoutLine and
 * onCommandStatus callbacks inside executeJob (lines 333-338 and 341-347).
 * Payload carries the line + stream discriminator. Streaming subscriber
 * wraps in wsEnvelope{type:'log', payload:data} and pushes to the
 * JobBroadcaster ring buffer.
 *
 * Thin payload per EVENTS-04. Schema shape matches LogData interface at
 * server/streaming/types.ts:17-20 exactly so job-service.ts emit sites
 * pass .parse() at the bus boundary.
 */
export const jobLogPayload = z.object({
  jobId: z.string(),
  data: z.object({
    line: z.string(),
    stream: z.enum(['stdout', 'stderr']),
  }),
});

/**
 * Phase 22 Plan 22-01 — fires from job-service.ts onFlowStart (line 307-313)
 * and onFlowResult (line 314-320) callbacks. Two distinct callsites emit
 * different payload subsets:
 *   - onFlowStart: {flowName, status: 'running'} — no command, no duration
 *   - onFlowResult: {flowName, status, durationMs} — no command
 *
 * To accept both shapes without a discriminated union (which would require
 * producer-side changes), command and durationMs are .nullable().optional().
 * This matches the existing StepData interface at server/streaming/types.ts:22-27
 * which already permits command: string | null.
 *
 * Thin payload per EVENTS-04. Schema is strict (NOT .loose()); the
 * .optional() fields are the widening.
 */
export const jobStepPayload = z.object({
  jobId: z.string(),
  data: z.object({
    flowName: z.string(),
    command: z.string().nullable().optional(),
    status: z.string(),
    durationMs: z.number().int().nonnegative().nullable().optional(),
  }),
});

/**
 * Phase 22 Plan 22-01 — fires from job-service.ts at status transitions
 * (line 262-267 sets 'running'; line 429-434 sets the terminal status
 * from ExecutionResult). Status enum matches StatusData at
 * server/streaming/types.ts:35-37 exactly (5 values: running + 4 terminal).
 *
 * IMPORTANT: this enum is INTENTIONALLY wider than jobCompletedPayload.status
 * (which has 4 terminal values, no 'running'). job.status is a streaming
 * signal covering the full lifecycle; job.completed is a persisted terminal
 * fact. Do NOT unify — Phase 23 saga may reshape, but Phase 22 keeps them
 * separate per RESEARCH §Open Questions point 5.
 */
export const jobStatusPayload = z.object({
  jobId: z.string(),
  data: z.object({
    status: z.enum(['running', 'passed', 'failed', 'cancelled', 'timeout']),
  }),
});

/**
 * Phase 23 Plan 23-01 — fires from jobs subscriber on `device.allocated`
 * (pool emits it, jobs subscribes via fastify.poolModule.bus.on).
 * Subscriber writes jobs.status='allocated' + sets jobs.deviceId + jobs.startedAt
 * then emits this. NOT persisted — transient; derivable from the persisted
 * device.allocated row.
 *
 * Thin payload per EVENTS-04. platform discriminator lets downstream subs
 * choose android/ios paths without re-fetching the job.
 */
export const jobAllocatedPayload = z.object({
  jobId: z.string(),
  deviceId: z.string(),
  platform: z.enum(['android', 'ios']),
});

/**
 * Phase 23 Plan 23-01 — fires from job.execute worker (Plan 23-04) AFTER
 * the saga has set jobs.status='running' but BEFORE Maestro execution. The
 * subscriber set is intentionally empty in Phase 23 (job.started handles
 * the artifacts hand-off via Phase 21 bridgehead); job.running exists for
 * trace observability + future consumer expansion. NOT persisted —
 * transient; derivable from jobs.status='running'.
 *
 * Distinct from job.started: job.started is the cross-module bridgehead
 * Phase 21 added for artifacts; job.running is the saga-native event Phase
 * 23 owns. Phase 30+ may collapse them; for now, both coexist (Phase 22
 * Plan 22-01 NOTE explains the analogous job.status vs job.completed
 * coexistence).
 */
export const jobRunningPayload = z.object({
  jobId: z.string(),
  deviceId: z.string(),
  platform: z.enum(['android', 'ios']),
});

/**
 * Phase 23 Plan 23-01 — fires from saga at terminal step BEFORE recording
 * upload kicks off. Resolves the implicit hand-off currently encoded as
 * `await artifactService.recordingService.stopRecording → queue.send` in
 * job-service.ts. Plan 23-04 deletes that imperative path; the artifacts
 * module subscribes to this event (extending its existing job.completed
 * subscriber) to enqueue recording.upload.
 *
 * PERSISTED per TRACE-08: notable cross-module hand-off — debugging "why
 * didn't recording fire?" requires tracing this row.
 *
 * Thin payload: jobId + recordingId + outputPath. Recording metadata
 * (frameCount, codec, durationSec) re-fetched from the recording session
 * by the artifacts subscriber.
 */
export const jobRecordingRequestedPayload = z.object({
  jobId: z.string(),
  recordingId: z.string(),
  outputPath: z.string(),
});

/**
 * Phase 23 Plan 23-01 — fires from saga at terminal step (after recording
 * + webhook hand-offs). Resolves DEFERRED-22-D `setTimeout(...broadcaster.cleanup, 5000)`
 * pattern by replacing the imperative timer with a bus event the streaming
 * module subscribes to.
 *
 * PERSISTED per TRACE-08: terminal hand-off — debugging post-completion
 * cleanup requires tracing this row.
 *
 * Thin payload: jobId only. Streaming subscriber calls
 * jobBroadcaster.cleanup(jobId) with no further arguments.
 */
export const jobCleanupRequestedPayload = z.object({
  jobId: z.string(),
});

/**
 * Phase 23 Plan 23-01 — fires from any saga step that throws. Replaces
 * `.catch(() => {})` swallow patterns in job-service.ts (SC1 grep-guard
 * count goes to 0 in Plan 23-04). Subscribers handle per-step recovery:
 *   - jobs/subscribers.ts → mark jobs.status='failed', emit job.cleanup.requested
 *   - pool/subscribers.ts → release device if allocated
 *   - artifacts/subscribers.ts → stop recording if active
 *   - reporting/subscribers.ts → fire failure webhook
 *
 * PERSISTED per TRACE-08: TERMINAL ERROR EVENT (EVENTS-07 analogue for
 * jobs module; the saga error-path is observable via this row + correlationId).
 *
 * Thin payload: jobId + step (which saga step failed) + reason (human-readable).
 * `step` enum matches the saga steps: allocate / run / complete / recording
 * / webhook / cleanup. Future widening accepted.
 */
export const jobFailedPayload = z.object({
  jobId: z.string(),
  step: z.enum(['allocate', 'run', 'complete', 'recording', 'webhook', 'cleanup']),
  reason: z.string(),
});

/**
 * Phase 23 Plan 23-05 — operational telemetry; persisted for audit trail
 * of drain rehearsal events. aggregateType:'system' (NOT 'job') discriminates
 * for trace-tree consumption (DEFERRED-23-B; Phase 27+ may extract to system module).
 *
 * Fired by /admin/drain endpoint (server/jobs/internal/routes.ts) after the
 * long-poll loop confirms in-flight count = 0. durationMs is wall-time from
 * drain request to in-flight=0 (useful for capacity planning).
 */
export const systemDrainCompletedPayload = z.object({
  drainedAt: z.string().datetime(),
  durationMs: z.number().int().nonnegative(),
});

/**
 * Phase 23 Plan 23-05 — operational telemetry; persisted for audit trail.
 *
 * Fired by /admin/drain/resume endpoint after the system_state row is deleted
 * and workers are re-registered.
 */
export const systemDrainResumedPayload = z.object({
  resumedAt: z.string().datetime(),
});

// ---------- Registry ----------

export const jobsRegistry = {
  [JOB_EVENT_NAMES.STARTED]:             { schema: jobStartedPayload,             persisted: false, aggregateType: 'job' },
  [JOB_EVENT_NAMES.COMPLETED]:           { schema: jobCompletedPayload,           persisted: true,  aggregateType: 'job' },
  [JOB_EVENT_NAMES.MAESTRO_LOG_WRITTEN]: { schema: maestroLogWrittenPayload,      persisted: false, aggregateType: 'job' },
  // Phase 22 Plan 22-01 — streaming bridgehead (all non-persisted per EVENTS-04 + TRACE-08).
  [JOB_EVENT_NAMES.LOG]:                 { schema: jobLogPayload,                 persisted: false, aggregateType: 'job' },
  [JOB_EVENT_NAMES.STEP]:                { schema: jobStepPayload,                persisted: false, aggregateType: 'job' },
  [JOB_EVENT_NAMES.STATUS]:              { schema: jobStatusPayload,              persisted: false, aggregateType: 'job' },
  // Phase 23 Plan 23-01 — keystone saga events (TRACE-08: notable + terminal persisted).
  [JOB_EVENT_NAMES.ALLOCATED]:           { schema: jobAllocatedPayload,           persisted: false, aggregateType: 'job' },
  [JOB_EVENT_NAMES.RUNNING]:             { schema: jobRunningPayload,             persisted: false, aggregateType: 'job' },
  [JOB_EVENT_NAMES.RECORDING_REQUESTED]: { schema: jobRecordingRequestedPayload,  persisted: true,  aggregateType: 'job' },
  [JOB_EVENT_NAMES.CLEANUP_REQUESTED]:   { schema: jobCleanupRequestedPayload,    persisted: true,  aggregateType: 'job' },
  [JOB_EVENT_NAMES.FAILED]:              { schema: jobFailedPayload,              persisted: true,  aggregateType: 'job' },
  // Phase 23 Plan 23-05 — system.drain events (aggregateType:'system' per DEFERRED-23-B).
  [JOB_EVENT_NAMES.DRAIN_COMPLETED]:     { schema: systemDrainCompletedPayload,   persisted: true,  aggregateType: 'system' },
  [JOB_EVENT_NAMES.DRAIN_RESUMED]:       { schema: systemDrainResumedPayload,     persisted: true,  aggregateType: 'system' },
} as const satisfies EventRegistry;

export type JobsRegistry = typeof jobsRegistry;

// ---------- Emit helpers factory ----------

export function makeJobsEmitters(
  bus: TypedBus<JobsRegistry>,
  onEmit?: (envelope: Envelope) => void,
) {
  const emit = createEventHelpers(bus, onEmit);
  return {
    started:            emit(JOB_EVENT_NAMES.STARTED),
    completed:          emit(JOB_EVENT_NAMES.COMPLETED),
    maestroLogWritten:  emit(JOB_EVENT_NAMES.MAESTRO_LOG_WRITTEN),
    // Phase 22 Plan 22-01 — streaming bridgehead.
    log:                emit(JOB_EVENT_NAMES.LOG),
    step:               emit(JOB_EVENT_NAMES.STEP),
    status:             emit(JOB_EVENT_NAMES.STATUS),
    // Phase 23 Plan 23-01 — keystone saga events.
    allocated:          emit(JOB_EVENT_NAMES.ALLOCATED),
    running:            emit(JOB_EVENT_NAMES.RUNNING),
    recordingRequested: emit(JOB_EVENT_NAMES.RECORDING_REQUESTED),
    cleanupRequested:   emit(JOB_EVENT_NAMES.CLEANUP_REQUESTED),
    failed:             emit(JOB_EVENT_NAMES.FAILED),
    // Phase 23 Plan 23-05 — system.drain helpers.
    drainCompleted:     emit(JOB_EVENT_NAMES.DRAIN_COMPLETED),
    drainResumed:       emit(JOB_EVENT_NAMES.DRAIN_RESUMED),
  };
}

export type JobsEmitters = ReturnType<typeof makeJobsEmitters>;
