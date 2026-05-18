/**
 * Phase 21 / Plan 21-03 — Artifacts module queue contract (QUEUE-06 + SC3 queue layer).
 *
 * Exports:
 *   - RECORDING_UPLOAD_QUEUE_NAME (alias of QUEUE_NAMES.RECORDING_UPLOAD).
 *   - recordingUploadPayloadSchema + RecordingUploadPayload type.
 *   - registerArtifactsWorker(deps) — factory that performs the canonical
 *     2-step sequence for recording.upload:
 *       1. createQueue(RECORDING_UPLOAD, {policy: 'stately', retryLimit: 3,
 *          retryBackoff: true, retryDelay: 5}) — RESEARCH §Pitfall 2:
 *          policy:'stately' is REQUIRED for singletonKey dedup to activate;
 *          default 'standard' policy's singletonKey field is ignored.
 *       2. queue.work(RECORDING_UPLOAD, handler) → handler:
 *            (a) parse inbound payload via Zod (EVENTS-06 consumer input validation)
 *            (b) await artifactService.createArtifactIdempotent({...with recordingId})
 *            (c) if returned {id}: emit.artifactCreated(artifactId, full payload)
 *                                 and log INFO
 *            (d) if returned null:  log WARN (SC3 idempotency replay path — DB unique
 *                                 skipped insert) and DO NOT emit (artifact.created
 *                                 was already emitted on the first successful attempt)
 *            (e) null-return is NOT an error; no explicit throw — Zod.parse throws
 *                on malformed payload and that's pg-boss's responsibility.
 *
 * Returns {workerIds: [uploadWorkerId]}.
 *
 * NO DLQ per RESEARCH §Pitfall 3 — failed local uploads are operator-debuggable
 * via boss.findJobs + the file-on-disk. Phase 27+ may add DLQ if operational
 * need emerges; adding it now without a consumer traps failed jobs silently.
 *
 * NO schedule call — recording.upload is on-demand, enqueued from the plan-21-04
 * job.completed subscriber with singletonKey: recordingId. Matches Phase 16
 * hook.run + Phase 19 webhook.deliver shape, NOT Phase 18/20 schedule shape.
 *
 * Correlation trace: fastify.queue.send (called from plan-21-04 subscriber)
 * reads ALS and injects correlationId into the job envelope; fastify.queue.work
 * restores ALS BEFORE invoking the handler. Retries read the SAME envelope
 * (pg-boss updates the SAME row's state across attempts per RESEARCH §Pitfall 3)
 * so all <=4 attempts share ONE correlationId end-to-end.
 */
import { z } from 'zod';
import type pino from 'pino';
import type { FastifyInstance } from 'fastify';

import { QUEUE_NAMES } from '../queue/names.js';
import type { ArtifactsEmitters } from './events.js';
import type { ArtifactService } from './artifact-service.js';

// ============================================================
// Queue name alias (unchanged from Plan 21-00 stub).
// ============================================================
export const RECORDING_UPLOAD_QUEUE_NAME = QUEUE_NAMES.RECORDING_UPLOAD;

// ============================================================
// Payload schema — EVENTS-06 consumer input validation.
// ============================================================

/**
 * Payload the job.completed subscriber (plan 21-04) sends on the recording.upload
 * queue. Worker `.parse`s this at the top of the handler so typos / schema drift
 * fail fast (throws ZodError → pg-boss records the attempt → retry path or
 * eventual `failed` state after retryLimit exceeded).
 *
 * fileName + mimeType included so the worker doesn't need to re-derive them
 * (subscriber already knows — either 'recording.mp4' / 'video/mp4' for scrcpy
 * + capture-service, or same for adb-screenrecord fallback).
 *
 * fileSizeBytes is NOT in the payload — the worker calls artifactService.getFileSize
 * AFTER createArtifactIdempotent returns (RESEARCH §Pitfall 6 — stat can fail
 * asynchronously on slow filesystems; payload captures only the minimal shape).
 */
export const recordingUploadPayloadSchema = z.object({
  jobId:           z.string().uuid(),
  recordingId:     z.string().uuid(),
  outputPath:      z.string(),
  durationSec:     z.number().nonnegative(),
  frameCount:      z.number().int().nonnegative(),
  codec:           z.string(),
  fileName:        z.string(),    // e.g. 'recording.mp4'
  mimeType:        z.string(),    // e.g. 'video/mp4'
  videoStartedAt:  z.coerce.date().optional(),  // Task 1.6 — wall-clock when recording started
});
export type RecordingUploadPayload = z.infer<typeof recordingUploadPayloadSchema>;

// ============================================================
// Worker registration factory.
// ============================================================

export interface RegisterArtifactsWorkerDeps {
  /** Fastify instance — used to reach fastify.boss + fastify.queue. */
  fastify: FastifyInstance;
  artifactService: ArtifactService;
  emit: ArtifactsEmitters;
  logger: pino.Logger;
}

export interface ArtifactsWorkerRegistration {
  workerIds: string[];
}

export async function registerArtifactsWorker(
  deps: RegisterArtifactsWorkerDeps,
): Promise<ArtifactsWorkerRegistration> {
  const { fastify, artifactService, emit, logger } = deps;

  // ------------------------------------------------------------
  // 1. Create the queue. policy:'stately' (NOT 'standard') is what
  //    makes singletonKey dedup activate — RESEARCH §Pitfall 2.
  //    Phase 16 Plan 16-01 empirically verified this against
  //    node_modules/pg-boss/dist/plans.js:467-485.
  // ------------------------------------------------------------
  await fastify.boss.createQueue(RECORDING_UPLOAD_QUEUE_NAME, {
    policy: 'stately',
    retryLimit: 3,
    retryBackoff: true,
    retryDelay: 5,           // seconds; exponential 5 -> 10 -> 20 for retries 1/2/3
  } as never);

  // ------------------------------------------------------------
  // 2. Register the worker handler.
  //    fastify.queue.work restores ALS from envelope.correlationId BEFORE
  //    invoking the handler (Phase 15 substrate). Worker body:
  //      parse -> idempotent insert -> (emit OR warn) — NO throw on null return.
  // ------------------------------------------------------------
  const uploadWorkerId = await fastify.queue.work<RecordingUploadPayload>(
    RECORDING_UPLOAD_QUEUE_NAME,
    async (data, jobId) => {
      const parsed = recordingUploadPayloadSchema.parse(data);
      const log = logger.child({
        queue: RECORDING_UPLOAD_QUEUE_NAME,
        bossJobId: jobId,
        recordingId: parsed.recordingId,
        artifactJobId: parsed.jobId,
      });

      // SC3 DB-LAYER: atomic insert with ON CONFLICT DO NOTHING.
      // Returns {id} on new row; returns null when recordingId already exists.
      const fileSizeBytes = await artifactService.getFileSize(parsed.outputPath);
      const created = await artifactService.createArtifactIdempotent({
        jobId: parsed.jobId,
        recordingId: parsed.recordingId,
        type: 'video',
        filePath: parsed.outputPath,
        fileName: parsed.fileName,
        mimeType: parsed.mimeType,
        fileSizeBytes,
        videoStartedAt: parsed.videoStartedAt,
      });

      if (created) {
        // RESEARCH §Pitfall 6: emit AFTER DB commit. createArtifactIdempotent's
        // await resolves after the INSERT row is visible (Drizzle default is
        // autocommit per statement).
        emit.artifactCreated(created.id, {
          artifactId: created.id,
          jobId: parsed.jobId,
          type: 'video',
          filePath: parsed.outputPath,
          fileName: parsed.fileName,
          mimeType: parsed.mimeType,
          fileSizeBytes: fileSizeBytes ?? null,
        });
        log.info({ artifactId: created.id }, 'Recording artifact created from upload worker');
      } else {
        // SC3 REPLAY PATH — DO NOT throw; NOT an error, this is the idempotent
        // behaviour. Also NOT an emit — the original successful attempt already
        // emitted artifact.created with the canonical artifactId.
        log.warn(
          'Recording upload replayed — existing artifact row preserved (SC3 idempotency)',
        );
      }
    },
  );

  logger.info(
    { uploadWorkerId, queue: RECORDING_UPLOAD_QUEUE_NAME },
    'Artifacts workers registered',
  );
  return { workerIds: [uploadWorkerId] };
}
