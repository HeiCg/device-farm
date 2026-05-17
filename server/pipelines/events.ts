/**
 * Pipelines module — typed event surface (Phase 25 Plan 25-01).
 *
 * Declares the 5 pipeline-lifecycle events that drive the v3.0 pipeline
 * subscriber chain (replaces the legacy in-process Promise chain in
 * server/pipelines/executor.ts):
 *
 *   - pipeline.run.started        (transient — high-freq trigger signal)
 *   - pipeline.stage.advanced     (transient — derivable from stage rows)
 *   - pipeline.run.completed      (PERSISTED — terminal saga fact, TRACE-08)
 *   - pipeline.run.failed         (PERSISTED — terminal saga fact, TRACE-08)
 *   - pipeline.schedule.upserted  (transient — schedule mutation telemetry)
 *
 * Persistence policy per TRACE-08:
 *   - run.completed / run.failed:     persisted (2 terminal entries)
 *   - run.started / stage.advanced /
 *     schedule.upserted:              transient (3 entries)
 *
 * aggregateType discriminator:
 *   - 'pipeline-run' for the 4 run-scoped events; aggregateId = runId.
 *   - 'pipeline-schedule' for schedule.upserted; aggregateId = scheduleId.
 *
 * `createEventHelpers` (Phase 15 substrate at server/bus/helpers.ts) wraps
 * TypedBus.emit + envelope stamping (ALS-sourced correlationId) + optional
 * onEmit side-channel (used by createPipelinesModule in Plan 25-03 to
 * forward to bus persistence middleware for the `events` table).
 *
 * MOD-03 + EVENTS-03 (`noun.verbed` past-tense dotted) + EVENTS-08 (emit
 * helpers in events.ts; direct bus.emit forbidden by lint).
 *
 * This file is allowlisted by eslint-local-rules/no-direct-bus-emit.js
 * (pattern /\/events\.ts$/) and by the .dependency-cruiser.cjs rule
 * `no-direct-bus-emit-outside-events-ts`. All `bus.emit(...)` call sites
 * in the pipelines module MUST route through these helpers.
 */
import { z } from 'zod';
import { v5 as uuidv5 } from 'uuid';

import { createEventHelpers } from '../bus/helpers.js';
import type { TypedBus } from '../bus/bus.js';
import type { EventRegistry } from '../bus/types.js';
import type { Envelope } from '../events/envelope.js';

/** Event-name constants. Use these anywhere the literal string is referenced. */
export const PIPELINE_EVENT_NAMES = {
  RUN_STARTED:        'pipeline.run.started',
  STAGE_ADVANCED:     'pipeline.stage.advanced',
  RUN_COMPLETED:      'pipeline.run.completed',
  RUN_FAILED:         'pipeline.run.failed',
  SCHEDULE_UPSERTED:  'pipeline.schedule.upserted',
} as const;

export type PipelineEventName = typeof PIPELINE_EVENT_NAMES[keyof typeof PIPELINE_EVENT_NAMES];

/** Aggregate-type literals for envelope.aggregateType field. */
export const PIPELINE_RUN_AGGREGATE_TYPE = 'pipeline-run' as const;
export const PIPELINE_SCHEDULE_AGGREGATE_TYPE = 'pipeline-schedule' as const;

/**
 * Stable v5 UUID for pipeline-run events that have no run-specific aggregateId
 * (e.g. emitter-level fallback). Derived at module load via:
 *   uuidv5('pipeline-run', '6ba7b811-9dad-11d1-80b4-00c04fd430c8')  // URL namespace
 *
 * Computed at runtime via the `uuid` library (already a project dep) rather
 * than embedded as a literal that could drift from the spec re-derivation.
 * The events.spec re-derives at test time and asserts equality — single
 * source of truth (matches Phase 18 LIFECYCLE_AGGREGATE_ID + Phase 20
 * POOL_AGGREGATE_ID derivations).
 *
 * Specific run events stamp aggregateId=runId; this constant is reserved for
 * future pool-wide pipeline telemetry that does not bind to a single run.
 */
const URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
export const PIPELINE_RUN_AGGREGATE_ID = uuidv5('pipeline-run', URL_NAMESPACE);

// ---------- Payload schemas ----------

/**
 * Fires from service.startRun() at run creation time. triggerType discriminates
 * between API call (POST /api/pipelines/:id/run), schedule fire (boss.work
 * handler in Plan 25-02), and manual UI trigger.
 */
export const pipelineRunStartedPayload = z.object({
  runId: z.string(),
  pipelineId: z.string(),
  triggerType: z.enum(['api', 'schedule', 'manual', 'azure-pr']),
});

/**
 * Fires from the bus subscriber after each stage's job.completed advances
 * the run. status discriminates pass/fail/skipped per stage.
 */
export const pipelineStageAdvancedPayload = z.object({
  runId: z.string(),
  stageIndex: z.number().int().nonnegative(),
  stageName: z.string(),
  status: z.enum(['passed', 'failed', 'skipped']),
});

/**
 * Fires from the bus subscriber when the final stage resolves. PERSISTED per
 * TRACE-08 (terminal saga fact; trace-tree consumption in Phase 27+).
 */
export const pipelineRunCompletedPayload = z.object({
  runId: z.string(),
  pipelineId: z.string(),
  status: z.enum(['passed', 'failed', 'cancelled']),
  durationMs: z.number().int().nonnegative(),
});

/**
 * Fires when the saga aborts mid-run (any stage's job emits job.failed, or
 * scheduler errors out). PERSISTED per TRACE-08 (terminal error event).
 * failedStageIndex is null when failure occurs before any stage starts
 * (e.g. scheduler-time variable resolution error).
 */
export const pipelineRunFailedPayload = z.object({
  runId: z.string(),
  pipelineId: z.string(),
  reason: z.string(),
  failedStageIndex: z.number().int().nonnegative().nullable(),
});

/**
 * Fires from the scheduler module (Plan 25-02) every time a pipelineSchedules
 * row is created or updated and the corresponding pg-boss schedule is upserted
 * via boss.schedule(name, cron, data, {key: scheduleId}). Transient — the row
 * itself is the source of truth; this event is observability-only.
 */
export const pipelineScheduleUpsertedPayload = z.object({
  scheduleId: z.string(),
  pipelineId: z.string(),
  cron: z.string(),
});

// ---------- Registry ----------

export const pipelinesRegistry = {
  [PIPELINE_EVENT_NAMES.RUN_STARTED]:       { schema: pipelineRunStartedPayload,       persisted: false, aggregateType: PIPELINE_RUN_AGGREGATE_TYPE },
  [PIPELINE_EVENT_NAMES.STAGE_ADVANCED]:    { schema: pipelineStageAdvancedPayload,    persisted: false, aggregateType: PIPELINE_RUN_AGGREGATE_TYPE },
  [PIPELINE_EVENT_NAMES.RUN_COMPLETED]:     { schema: pipelineRunCompletedPayload,     persisted: true,  aggregateType: PIPELINE_RUN_AGGREGATE_TYPE },
  [PIPELINE_EVENT_NAMES.RUN_FAILED]:        { schema: pipelineRunFailedPayload,        persisted: true,  aggregateType: PIPELINE_RUN_AGGREGATE_TYPE },
  [PIPELINE_EVENT_NAMES.SCHEDULE_UPSERTED]: { schema: pipelineScheduleUpsertedPayload, persisted: false, aggregateType: PIPELINE_SCHEDULE_AGGREGATE_TYPE },
} as const satisfies EventRegistry;

export type PipelinesRegistry = typeof pipelinesRegistry;

// ---------- Emit helpers factory ----------

/**
 * Called by createPipelinesModule (Plan 25-03) to construct the 5 typed
 * emit helpers. The factory passes its own persistEnvelope-equivalent via
 * `onEmit` so persisted events (run.completed + run.failed) land in the
 * `events` table per TRACE-08.
 *
 * Returns an object with per-event helpers so callers read like:
 *   emit.runStarted(runId, { runId, pipelineId, triggerType: 'api' });
 *   emit.scheduleUpserted(scheduleId, { scheduleId, pipelineId, cron: '0 2 * * *' });
 */
export function makePipelinesEmitters(
  bus: TypedBus<PipelinesRegistry>,
  onEmit?: (envelope: Envelope) => void,
) {
  const emit = createEventHelpers(bus, onEmit);
  return {
    runStarted:       emit(PIPELINE_EVENT_NAMES.RUN_STARTED),
    stageAdvanced:    emit(PIPELINE_EVENT_NAMES.STAGE_ADVANCED),
    runCompleted:     emit(PIPELINE_EVENT_NAMES.RUN_COMPLETED),
    runFailed:        emit(PIPELINE_EVENT_NAMES.RUN_FAILED),
    scheduleUpserted: emit(PIPELINE_EVENT_NAMES.SCHEDULE_UPSERTED),
  };
}

export type PipelinesEmitters = ReturnType<typeof makePipelinesEmitters>;
