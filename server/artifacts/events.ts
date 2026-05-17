/**
 * Phase 21 / Plan 21-02 — Artifacts module event registry + emit helpers (MOD-03).
 *
 * Declares the 3 artifact-lifecycle events that Phase 21 wires subscribers
 * to (see plan 21-04 createArtifactsModule factory):
 *
 *   - artifact.created     (PERSISTED — end-state fact; TRACE-08). Fires from
 *     the recording.upload worker (plan 21-03) after createArtifactIdempotent
 *     returns a new row, and from the job.completed subscriber's screenshot /
 *     memory / maestro.log synchronous paths after each createArtifact row.
 *     Payload carries artifactId + jobId + type + filePath + fileName + mimeType
 *     + fileSizeBytes. Phase 27 trace-tree consumes the events-table rows.
 *
 *   - recording.started    (NOT persisted — transient). Fires from the
 *     job.started subscriber after RecordingService.startRecording resolves.
 *     Payload discriminates method via recording-service getRecordingMethod
 *     (added in Plan 21-01 per RESEARCH §Pitfall 8).
 *
 *   - recording.stopped    (NOT persisted — transient; derivable from the
 *     subsequent artifact.created row). Fires from the job.completed
 *     subscriber after RecordingService.stopRecording returns a RecordingResult.
 *     Payload carries outputPath + durationSec + frameCount + codec.
 *
 * Persistence policy per TRACE-08:
 *   - artifact.created: PERSISTED (Phase 27 trace-tree + audit trail)
 *   - recording.started / recording.stopped: NOT persisted (events-table bloat
 *     unjustified; artifact.created row + its correlation chain captures the
 *     recording lifecycle sufficient for operator debug)
 *
 * aggregateType: 'artifacts' on all 3 entries.
 *
 * aggregateId per event:
 *   - artifact.created:  artifactId (each artifact is its own aggregate — matches
 *     aggregateType 'artifacts' + scales with artifact-per-job fan-out)
 *   - recording.started/stopped: recordingId (a recording is an aggregate across
 *     start/stop lifecycle; Phase 22 Streaming may subscribe per-recordingId)
 *
 * ARTIFACTS_AGGREGATE_ID below is the v5 UUID derived from 'artifacts' under the
 * URL namespace — RESERVED for future artifacts-wide telemetry (e.g.
 * artifacts.gc.completed). NOT used by the 3 events above; they carry
 * artifactId/recordingId as aggregateId.
 *
 * `createEventHelpers` (Phase 15 substrate at server/bus/helpers.ts) wraps
 * TypedBus.emit + envelope stamping (ALS correlationId) + optional onEmit
 * side-channel (used by createArtifactsModule factory in plan 21-04 to forward
 * to bus persistence middleware).
 *
 * This file is allowlisted by eslint-local-rules/no-direct-bus-emit.js
 * (pattern /\/events\.ts$/) and by the .dependency-cruiser.cjs rule
 * `no-direct-bus-emit-outside-events-ts`. All bus.emit(...) call sites in
 * the artifacts module MUST route through these helpers.
 */
import { z } from 'zod';

import { createEventHelpers } from '../bus/helpers.js';
import type { TypedBus } from '../bus/bus.js';
import type { EventRegistry } from '../bus/types.js';
import type { Envelope } from '../events/envelope.js';
import { artifactTypeSchema } from './schemas.js';

/** Event-name constants (EVENTS-03 past-tense dotted). */
export const ARTIFACTS_EVENT_NAMES = {
  ARTIFACT_CREATED:    'artifact.created',
  RECORDING_STARTED:   'recording.started',
  RECORDING_STOPPED:   'recording.stopped',
} as const;

export type ArtifactsEventName = typeof ARTIFACTS_EVENT_NAMES[keyof typeof ARTIFACTS_EVENT_NAMES];

/**
 * Fixed singleton UUID for future artifacts-wide telemetry (artifact.created
 * and recording.* use artifactId/recordingId as their aggregateId). Stable v5
 * derived from 'artifacts' under URL namespace (RFC 4122 §4.3). Matches the
 * derivation pattern established by Phase 18 (lifecycle) / Phase 19 (reporting)
 * / Phase 20 (pool).
 *
 * Value = uuidv5('artifacts', '6ba7b811-9dad-11d1-80b4-00c04fd430c8').
 * Spec events.spec.ts re-derives at test time and asserts exact match —
 * this literal is the single source of truth grep-friendly symbol.
 */
export const ARTIFACTS_AGGREGATE_ID = '0bfe29be-7bd1-5f23-ae17-dd867fd062b5' as const;

// ---------- Payload schemas ----------

/**
 * Terminal fact. Fires from plan-21-03 recording.upload worker after
 * createArtifactIdempotent returns a new row AND from plan-21-04 job.completed
 * subscriber after each synchronous screenshot/memory/maestro.log
 * createArtifact row. Persisted for Phase 27 trace-tree.
 *
 * fileSizeBytes nullable — adb-screenrecord fallback in recording-service.ts
 * line 177 may return duration=0 + size not-yet-known when pull fails.
 */
export const artifactCreatedPayload = z.object({
  artifactId: z.string().uuid(),
  jobId: z.string().uuid(),
  type: artifactTypeSchema,                      // 'video' | 'screenshot' | 'memory' | 'log'
  filePath: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  fileSizeBytes: z.number().int().nonnegative().nullable(),
});

/**
 * Transient. Fires from plan-21-04 job.started subscriber after
 * RecordingService.startRecording resolves. method discriminator populated via
 * RecordingService.getRecordingMethod (plan 21-01 per RESEARCH §Pitfall 8).
 */
export const recordingStartedPayload = z.object({
  jobId: z.string().uuid(),
  recordingId: z.string().uuid(),
  deviceId: z.string().uuid(),
  platform: z.enum(['android', 'ios']),
  method: z.enum(['scrcpy', 'adb-screenrecord', 'capture-service']),
});

/**
 * Transient. Fires from plan-21-04 job.completed subscriber after
 * RecordingService.stopRecording returns a RecordingResult. Payload shape
 * matches @device-stream RecordingResult ({outputPath, duration, frameCount, codec}),
 * plus the recordingId that the subscriber generated at start time +
 * the jobId context. durationSec can be 0 for adb-screenrecord pull failures.
 */
export const recordingStoppedPayload = z.object({
  jobId: z.string().uuid(),
  recordingId: z.string().uuid(),
  outputPath: z.string(),
  durationSec: z.number().nonnegative(),
  frameCount: z.number().int().nonnegative(),
  codec: z.string(),
});

// ---------- Registry ----------
//
// Per TRACE-08 persistence policy:
//   artifact.created:       PERSISTED (end-state; Phase 27 trace-tree)
//   recording.started/stopped: NOT persisted (transient; derivable)

export const artifactsRegistry = {
  [ARTIFACTS_EVENT_NAMES.ARTIFACT_CREATED]:   { schema: artifactCreatedPayload,   persisted: true,  aggregateType: 'artifacts' },
  [ARTIFACTS_EVENT_NAMES.RECORDING_STARTED]:  { schema: recordingStartedPayload,  persisted: false, aggregateType: 'artifacts' },
  [ARTIFACTS_EVENT_NAMES.RECORDING_STOPPED]:  { schema: recordingStoppedPayload,  persisted: false, aggregateType: 'artifacts' },
} as const satisfies EventRegistry;

export type ArtifactsRegistry = typeof artifactsRegistry;

// ---------- Emit helpers factory ----------

/**
 * Called by createArtifactsModule (plan 21-04) to construct the 3 typed emit
 * helpers. The factory passes its own `persistEnvelope`-equivalent via onEmit
 * so persisted events (artifact.created) land in the `events` table per TRACE-08.
 *
 * Callers read like:
 *   emit.artifactCreated(artifactId, {artifactId, jobId, type, filePath, fileName, mimeType, fileSizeBytes});
 *   emit.recordingStarted(recordingId, {jobId, recordingId, deviceId, platform, method});
 *   emit.recordingStopped(recordingId, {jobId, recordingId, outputPath, durationSec, frameCount, codec});
 */
export function makeArtifactsEmitters(
  bus: TypedBus<ArtifactsRegistry>,
  onEmit?: (envelope: Envelope) => void,
) {
  const emit = createEventHelpers(bus, onEmit);
  return {
    artifactCreated:   emit(ARTIFACTS_EVENT_NAMES.ARTIFACT_CREATED),
    recordingStarted:  emit(ARTIFACTS_EVENT_NAMES.RECORDING_STARTED),
    recordingStopped:  emit(ARTIFACTS_EVENT_NAMES.RECORDING_STOPPED),
  };
}

export type ArtifactsEmitters = ReturnType<typeof makeArtifactsEmitters>;
