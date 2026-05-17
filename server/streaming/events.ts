/**
 * Phase 22 / Plan 22-01 — Streaming module event registry + emit helpers (MOD-03).
 *
 * Declares the 1 streaming-lifecycle event that Phase 22 wires from the
 * subscriber safeParse drop path (see plan 22-02 createStreamingModule factory):
 *
 *   - ws.frame.dropped     (NOT persisted — programmer-error signal; structured
 *     log is sufficient; events-table bloat unjustified). Fires from inside the
 *     streaming subscriber on fastify.jobsModule.bus.on('job.log'|'job.step'|
 *     'job.status', ...) when wsEnvelopeSchema.safeParse(candidate) returns
 *     success:false. Payload carries jobId + eventType + reason + zodError.
 *     Plan 22-02 factory calls emit.frameDropped(jobId, payload) instead of
 *     broadcaster.emit when safeParse fails.
 *
 * Persistence policy per TRACE-08:
 *   - ws.frame.dropped: NOT persisted (Phase 27 trace-tree can derive from
 *     structured pino log lines if ever needed; event bus surface kept for
 *     future ops dashboards per Phase 19 DLQ notable-event precedent).
 *
 * aggregateType: 'streaming' on the 1 entry.
 *
 * aggregateId for ws.frame.dropped: jobId (the job whose frame was dropped —
 * scales with per-job fan-out; matches Phase 21's artifactId/recordingId pattern
 * where the aggregate is the specific business entity, not the singleton
 * STREAMING_AGGREGATE_ID reserved below).
 *
 * STREAMING_AGGREGATE_ID below is the v5 UUID derived from 'streaming' under the
 * URL namespace — RESERVED for future streaming-wide telemetry (e.g.
 * streaming.buffer.overflow). NOT used by ws.frame.dropped; that event carries
 * jobId as aggregateId.
 *
 * `createEventHelpers` (Phase 15 substrate at server/bus/helpers.ts) wraps
 * TypedBus.emit + envelope stamping (ALS correlationId) + optional onEmit
 * side-channel (used by createStreamingModule factory in plan 22-02 to forward
 * to bus persistence middleware — the 6TH SAMPLE POINT of persistEnvelope
 * duplication; Phase 27+ consolidation trigger).
 *
 * This file is allowlisted by eslint-local-rules/no-direct-bus-emit.js
 * (pattern /\/events\.ts$/) and by the .dependency-cruiser.cjs rule
 * `no-direct-bus-emit-outside-events-ts`. All bus.emit(...) call sites in
 * the streaming module MUST route through these helpers.
 *
 * Module owns NO queue (CONTEXT §Decisions explicit deviation from Phase
 * 16-21 template). WebSocket fan-out is in-process only; there is no
 * queue.ts file in this module. MODULE.md §Queue Produced/Consumed = "None".
 */
import { z } from 'zod';

import { createEventHelpers } from '../bus/helpers.js';
import type { TypedBus } from '../bus/bus.js';
import type { EventRegistry } from '../bus/types.js';
import type { Envelope } from '../events/envelope.js';

/** Event-name constants (EVENTS-03 past-tense dotted). */
export const STREAMING_EVENT_NAMES = {
  FRAME_DROPPED: 'ws.frame.dropped',
} as const;

export type StreamingEventName = typeof STREAMING_EVENT_NAMES[keyof typeof STREAMING_EVENT_NAMES];

/**
 * Fixed singleton UUID for future streaming-wide telemetry. `ws.frame.dropped`
 * uses jobId as its aggregateId. Stable v5 derived from 'streaming' under URL
 * namespace (RFC 4122 §4.3). Matches the derivation pattern established by
 * Phase 18 (lifecycle) / Phase 19 (reporting) / Phase 20 (pool) / Phase 21
 * (artifacts).
 *
 * Value = uuidv5('streaming', '6ba7b811-9dad-11d1-80b4-00c04fd430c8').
 * Spec events.spec.ts re-derives at test time and asserts exact match —
 * this literal is the single source of truth grep-friendly symbol.
 */
export const STREAMING_AGGREGATE_ID = 'fff0592e-b92c-5221-a40a-d10a141f0158' as const;

// ---------- Payload schemas ----------

/**
 * Programmer-error signal. Fires from plan-22-02 subscriber when
 * wsEnvelopeSchema.safeParse(candidate) returns success:false. The subscriber
 * is the only caller — no producer code emits this directly.
 *
 * eventType enumerates the 3 inbound bus events the subscriber handles
 * (job.log / job.step / job.status). reason discriminates the two drop paths:
 *   - 'safeParse-failed': envelope builder produced malformed shape (missing
 *     correlationId, wrong type discriminator, etc.) — Zod reports details.
 *   - 'unknown': defensive catch-all; subscriber received an event whose
 *     mapping to envelope.type isn't defined (forward-compat for Phase 23+
 *     saga additions to jobsRegistry).
 *
 * zodError is optional — only populated when reason='safeParse-failed'.
 */
export const wsFrameDroppedPayload = z.object({
  jobId: z.string(),
  eventType: z.enum(['log', 'step', 'status']),
  reason: z.enum(['safeParse-failed', 'unknown']),
  zodError: z.string().optional(),
});

// ---------- Registry ----------
//
// Per TRACE-08 persistence policy:
//   ws.frame.dropped: NOT persisted (programmer-error; structured log sufficient).

export const streamingRegistry = {
  [STREAMING_EVENT_NAMES.FRAME_DROPPED]: { schema: wsFrameDroppedPayload, persisted: false, aggregateType: 'streaming' },
} as const satisfies EventRegistry;

export type StreamingRegistry = typeof streamingRegistry;

// ---------- Emit helpers factory ----------

/**
 * Called by createStreamingModule (plan 22-02) to construct the 1 typed emit
 * helper. The factory passes its own `persistEnvelope`-equivalent via onEmit
 * so emitted events flow through the bus + (short-circuit since persisted:false)
 * skip the events-table write — matching Phase 19/20/21 persistEnvelope shape.
 *
 * Callers read like:
 *   emit.frameDropped(jobId, {jobId, eventType: 'log', reason: 'safeParse-failed', zodError: '...'});
 */
export function makeStreamingEmitters(
  bus: TypedBus<StreamingRegistry>,
  onEmit?: (envelope: Envelope) => void,
) {
  const emit = createEventHelpers(bus, onEmit);
  return {
    frameDropped: emit(STREAMING_EVENT_NAMES.FRAME_DROPPED),
  };
}

export type StreamingEmitters = ReturnType<typeof makeStreamingEmitters>;
