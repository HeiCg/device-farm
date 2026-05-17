/**
 * Phase 21 / Plan 21-04 — createArtifactsModule factory (MOD-06) + inline bus subscribers.
 *
 * Overwrites Plan 21-00 throw-stub. Owns construction of:
 *   - ArtifactService / RecordingService / ScreenshotService / MemoryService /
 *     ScrcpyService / CaptureService instances (back-compat — the same 6
 *     fastify.<X>Service decorators that artifact-plugin.ts used to write).
 *   - per-module TypedBus<ArtifactsRegistry>
 *   - persistEnvelope middleware (10 lines duplicated from Phase 16/18/19/20 —
 *     5TH SAMPLE POINT — Phase 27+ consolidation trigger REACHED; do NOT
 *     consolidate in this plan per RESEARCH §Pitfall 5 — scope creep).
 *   - emit via makeArtifactsEmitters(bus, persistEnvelope)
 *   - recording.upload worker via registerArtifactsWorker (plan 21-03 queue.ts).
 *   - 3 bus subscribers deferred to fastify.addHook('onReady') per RESEARCH
 *     §Pitfall 7 (artifact-plugin registers at step 11 < jobs-plugin at step 13;
 *     fastify.jobsModule is NOT yet decorated during plugin body — onReady
 *     fires after ALL plugins register).
 *
 * Subscribers:
 *   - job.started       → start recording + memory sampling + emit recording.started.
 *   - job.completed     → stop recording + enqueue recording.upload +
 *                         stop memory sampling + create memory artifact +
 *                         screenshot directory scan + emit artifact.created per row.
 *   - maestro.log.written → createArtifact({type:'log'}) + emit artifact.created.
 *
 * activeRecordings: module-local Map<jobId, recordingId> — ephemeral state threading
 * the recordingId from job.started subscriber through to job.completed subscriber
 * so stopRecording + enqueue recording.upload + emit recording.stopped all share
 * the same recordingId. On server restart this Map is lost (in-flight recordings
 * orphan, pool reaper + job cancellation flows eventually reconcile). Documented
 * in MODULE.md §Non-Goals.
 *
 * shutdown: idempotent (stopped flag); unsubscribes 3 handlers; offWork each
 * registered workerId; awaits scrcpyService.stopAll (preserves Phase 17+
 * onClose behaviour from the old artifact-plugin.ts).
 */
import { randomUUID } from 'node:crypto';
import type pino from 'pino';
import type { FastifyInstance } from 'fastify';
import { ScrcpyService } from '@device-stream/android';
import { CaptureService } from '@device-stream/ios-simulator';

import { TypedBus } from '../../bus/bus.js';
import { events as eventsTable } from '../../db/schema.js';
import type { Envelope } from '../../events/envelope.js';
import type { Database } from '../../db/index.js';
import type { AppConfig } from '../../config/schema.js';

import { ArtifactService } from '../artifact-service.js';
import { RecordingService } from '../recording-service.js';
import { ScreenshotService } from '../screenshot-service.js';
import { MemoryService } from '../memory-service.js';
import {
  artifactsRegistry,
  makeArtifactsEmitters,
  type ArtifactsRegistry,
  type ArtifactsEmitters,
} from '../events.js';
import {
  registerArtifactsWorker,
  RECORDING_UPLOAD_QUEUE_NAME,
  type RecordingUploadPayload,
} from '../queue.js';

export interface CreateArtifactsModuleDeps {
  fastify: FastifyInstance;
  db: Database;
  config: AppConfig;
  logger: pino.Logger;
}

export interface ArtifactsModule {
  artifactService: ArtifactService;
  recordingService: RecordingService;
  screenshotService: ScreenshotService;
  memoryService: MemoryService;
  scrcpyService: ScrcpyService;
  captureService: CaptureService;
  emit: ArtifactsEmitters;
  bus: TypedBus<ArtifactsRegistry>;
  /** Registers recording.upload worker + defers bus subscriptions to onReady (plugin-order workaround). */
  registerWorkersAndSubscribers: () => Promise<void>;
  /** Idempotent — unsubscribes bus + offWork's each worker id + stops scrcpy. */
  shutdown: () => Promise<void>;
}

/**
 * Duplicated from server/bus/plugin.ts + Phase 16 hooks + Phase 18 lifecycle +
 * Phase 19 reporting + Phase 20 pool. This is the 5TH SAMPLE POINT —
 * Phase 27+ consolidation trigger REACHED.
 *
 * When the consolidation PR lands, this block (+ the 4 predecessors) becomes
 * a single import from `server/bus/persist-envelope.ts` (or similar).
 * DO NOT extract here — scope creep; Phase 27+ owns it.
 */
function makePersistEnvelope(deps: {
  db: Database;
  bus: TypedBus<ArtifactsRegistry>;
  logger: pino.Logger;
}) {
  const ee = (deps.bus as unknown as { ee: import('node:events').EventEmitter }).ee;
  return function persistEnvelope(envelope: Envelope): void {
    ee.emit(`${envelope.type}.envelope`, envelope);

    const entry = artifactsRegistry[envelope.type as keyof ArtifactsRegistry];
    if (!entry || !entry.persisted) return;

    void (async () => {
      try {
        await deps.db
          .insert(eventsTable)
          .values({
            id: envelope.id,
            eventType: envelope.type,
            eventVersion: envelope.v,
            correlationId: envelope.correlationId,
            causationId: envelope.causationId ?? undefined,
            aggregateType: envelope.aggregateType,
            aggregateId: envelope.aggregateId,
            payload: envelope.payload as unknown,
            occurredAt: new Date(envelope.occurredAt),
            actor: envelope.actor,
          });
      } catch (err) {
        deps.logger.error({ err, envelope }, 'Failed to persist artifacts event');
      }
    })();
  };
}

export function createArtifactsModule(deps: CreateArtifactsModuleDeps): ArtifactsModule {
  const logger = deps.logger.child({ module: 'artifacts' });

  // ---------- Per-module typed bus + persistence ----------
  const bus = new TypedBus(artifactsRegistry);
  const persistEnvelope = makePersistEnvelope({ db: deps.db, bus, logger });
  const emit = makeArtifactsEmitters(bus, persistEnvelope);

  // ---------- Back-compat service instances (same as old artifact-plugin.ts) ----------
  const artifactService = new ArtifactService(deps.db, deps.config, logger);
  // Reach into fastify for processTracker (pool plugin decorator — pool registers at step 8 before artifacts at step 11; safe inside factory body because artifact-plugin declares pool-plugin as a dep).
  const recordingService = new RecordingService(logger, deps.fastify.processTracker);
  const screenshotService = new ScreenshotService(logger);
  const memoryService = new MemoryService(logger);
  const scrcpyService = new ScrcpyService();
  const captureService = new CaptureService();

  // ---------- Shutdown state ----------
  let workerIds: string[] = [];
  let unsubscribeJobStarted: (() => void) | null = null;
  let unsubscribeJobCompleted: (() => void) | null = null;
  let unsubscribeMaestroLogWritten: (() => void) | null = null;
  let stopped = false;

  // ---------- Cross-subscriber state ----------
  // jobId → recordingId generated in job.started subscriber; consumed in job.completed subscriber.
  const activeRecordings = new Map<string, string>();

  return {
    artifactService,
    recordingService,
    screenshotService,
    memoryService,
    scrcpyService,
    captureService,
    emit,
    bus,

    registerWorkersAndSubscribers: async () => {
      // 1. Register the recording.upload worker (pg-boss singleton + retry).
      const registration = await registerArtifactsWorker({
        fastify: deps.fastify,
        artifactService,
        emit,
        logger,
      });
      workerIds = registration.workerIds;

      // 2. DEFER bus subscriptions to onReady — plugin-order workaround
      //    (RESEARCH §Pitfall 7). At plugin body time, fastify.jobsModule is
      //    not yet decorated; onReady fires after all 17 plugins register.
      deps.fastify.addHook('onReady', async () => {
        // Subscriber 1: job.started → start recording + memory sampling.
        // Use fastify.jobsModule.bus.on — non-persisted events don't need the
        // onPersisted cast pattern (RESEARCH §Pitfall 4 option a).
        unsubscribeJobStarted = deps.fastify.jobsModule.bus.on(
          'job.started' as never,
          async (payload: { jobId: string; deviceId: string; platform: 'android' | 'ios' }) => {
            try {
              const deviceInfo = deps.fastify.pool.getDevice(payload.deviceId);
              const adbSerial = deviceInfo?.port != null
                ? `emulator-${deviceInfo.port}`
                : payload.deviceId;

              await artifactService.ensureJobDir(payload.jobId);

              const recordingId = randomUUID();
              const outputPath = artifactService.getArtifactPath(payload.jobId, 'recording.mp4');

              await recordingService.startRecording(
                payload.jobId,
                outputPath,
                payload.platform,
                adbSerial,
                { scrcpyService, captureService },
              );

              const method = recordingService.getRecordingMethod(payload.jobId) ?? 'scrcpy';
              emit.recordingStarted(recordingId, {
                jobId: payload.jobId,
                recordingId,
                deviceId: payload.deviceId,
                platform: payload.platform,
                method,
              });
              activeRecordings.set(payload.jobId, recordingId);

              // Android-only memory sampling.
              if (payload.platform === 'android') {
                try {
                  memoryService.startSampling(
                    payload.jobId,
                    adbSerial,
                    5000,
                    () => { /* broadcaster wiring moves to Phase 22 Streaming Module */ },
                  );
                } catch (err: unknown) {
                  logger.error({ err, jobId: payload.jobId }, 'Failed to start memory sampling from job.started subscriber');
                }
              }
            } catch (err: unknown) {
              logger.error({ err, jobId: payload.jobId }, 'job.started subscriber failed');
            }
          },
        );

        // Subscriber 2: job.completed → stop recording + enqueue upload + finalize artifacts.
        // Persisted event → use the reporting-precedent onPersisted cast.
        const onPersisted = deps.fastify.onPersisted as unknown as (
          type: 'job.completed',
          handler: (envelope: Envelope) => void | Promise<void>,
        ) => () => void;

        unsubscribeJobCompleted = onPersisted('job.completed', async (envelope) => {
          const payload = envelope.payload as { jobId: string; status: string; platform: 'android' | 'ios' };

          // 2a. Stop recording + enqueue upload.
          const recordingId = activeRecordings.get(payload.jobId);
          if (recordingId) {
            try {
              const result = await recordingService.stopRecording(payload.jobId);
              if (result) {
                emit.recordingStopped(recordingId, {
                  jobId: payload.jobId,
                  recordingId,
                  outputPath: result.outputPath,
                  durationSec: result.duration,
                  frameCount: result.frameCount,
                  codec: result.codec,
                });

                const uploadPayload: RecordingUploadPayload = {
                  jobId: payload.jobId,
                  recordingId,
                  outputPath: result.outputPath,
                  durationSec: result.duration,
                  frameCount: result.frameCount,
                  codec: result.codec,
                  fileName: 'recording.mp4',
                  mimeType: 'video/mp4',
                };
                await deps.fastify.queue.send(
                  RECORDING_UPLOAD_QUEUE_NAME,
                  uploadPayload as never,
                  { singletonKey: recordingId } as never,
                );
              }
            } catch (err: unknown) {
              logger.error({ err, jobId: payload.jobId }, 'job.completed recording stop/enqueue failed');
            }
            activeRecordings.delete(payload.jobId);
          }

          // 2b. Stop memory sampling + create memory artifact (android only).
          if (payload.platform === 'android') {
            try {
              const { samples } = memoryService.stopSampling(payload.jobId);
              if (samples.length > 0) {
                const memoryPath = artifactService.getArtifactPath(payload.jobId, 'memory.json');
                await memoryService.writeSamples(memoryPath, samples);
                const fileSize = await artifactService.getFileSize(memoryPath);
                const created = await artifactService.createArtifact({
                  jobId: payload.jobId,
                  type: 'memory',
                  filePath: memoryPath,
                  fileName: 'memory.json',
                  mimeType: 'application/json',
                  fileSizeBytes: fileSize,
                });
                emit.artifactCreated(created.id, {
                  artifactId: created.id,
                  jobId: payload.jobId,
                  type: 'memory',
                  filePath: memoryPath,
                  fileName: 'memory.json',
                  mimeType: 'application/json',
                  fileSizeBytes: fileSize ?? null,
                });
              }
            } catch (err: unknown) {
              logger.error({ err, jobId: payload.jobId }, 'Memory artifact creation failed');
            }
          }

          // 2c. Screenshot directory scan (mid-flow captures during execution).
          try {
            const { readdir } = await import('node:fs/promises');
            const screenshotsDir = artifactService.getArtifactPath(payload.jobId, 'screenshots');
            try {
              const files = await readdir(screenshotsDir);
              for (const file of files) {
                if (!file.endsWith('.png')) continue;
                const filePath = `${screenshotsDir}/${file}`;
                const fileSize = await artifactService.getFileSize(filePath);
                const created = await artifactService.createArtifact({
                  jobId: payload.jobId,
                  type: 'screenshot',
                  filePath,
                  fileName: file,
                  mimeType: 'image/png',
                  fileSizeBytes: fileSize,
                });
                emit.artifactCreated(created.id, {
                  artifactId: created.id,
                  jobId: payload.jobId,
                  type: 'screenshot',
                  filePath,
                  fileName: file,
                  mimeType: 'image/png',
                  fileSizeBytes: fileSize ?? null,
                });
              }
            } catch {
              // screenshots dir may not exist if no failures occurred — normal.
            }
          } catch (err: unknown) {
            logger.error({ err, jobId: payload.jobId }, 'Screenshot directory scan failed');
          }
        });

        // Subscriber 3: maestro.log.written → create log artifact + emit.
        unsubscribeMaestroLogWritten = deps.fastify.jobsModule.bus.on(
          'maestro.log.written' as never,
          async (payload: { jobId: string; filePath: string; fileName: string; mimeType: string; fileSizeBytes: number | null }) => {
            try {
              const created = await artifactService.createArtifact({
                jobId: payload.jobId,
                type: 'log',
                filePath: payload.filePath,
                fileName: payload.fileName,
                mimeType: payload.mimeType,
                fileSizeBytes: payload.fileSizeBytes ?? undefined,
              });
              emit.artifactCreated(created.id, {
                artifactId: created.id,
                jobId: payload.jobId,
                type: 'log',
                filePath: payload.filePath,
                fileName: payload.fileName,
                mimeType: payload.mimeType,
                fileSizeBytes: payload.fileSizeBytes,
              });
            } catch (err: unknown) {
              logger.error({ err, jobId: payload.jobId }, 'maestro.log.written subscriber failed');
            }
          },
        );

        logger.info('Artifacts bus subscribers registered (onReady)');
      });

      logger.info(
        { workerIds, queues: [RECORDING_UPLOAD_QUEUE_NAME] },
        'Artifacts module workers registered (subscribers deferred to onReady)',
      );
    },

    shutdown: async () => {
      if (stopped) return;
      stopped = true;

      // Unsubscribe bus handlers first so no new work is dispatched during shutdown.
      for (const unsub of [unsubscribeJobStarted, unsubscribeJobCompleted, unsubscribeMaestroLogWritten]) {
        if (unsub) {
          try { unsub(); } catch (err) { logger.warn({ err }, 'unsubscribe failed during artifacts shutdown'); }
        }
      }
      unsubscribeJobStarted = null;
      unsubscribeJobCompleted = null;
      unsubscribeMaestroLogWritten = null;

      // offWork per registered worker id.
      for (const id of workerIds) {
        try {
          await deps.fastify.boss.offWork(id);
        } catch (err) {
          logger.warn({ err, workerId: id }, 'offWork failed during artifacts shutdown');
        }
      }
      workerIds = [];

      // Preserve old artifact-plugin.ts onClose scrcpy cleanup.
      try {
        await scrcpyService.stopAll();
      } catch (err) {
        logger.warn({ err }, 'scrcpyService.stopAll failed during artifacts shutdown');
      }

      logger.info('Artifacts module shutdown complete');
    },
  };
}
