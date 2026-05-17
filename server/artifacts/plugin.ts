/**
 * Phase 21 / Plan 21-04 — Artifacts plugin (thin Fastify wrapper).
 *
 * Replaces the deleted server/artifacts/artifact-plugin.ts. Responsibilities:
 *   1. Call createArtifactsModule({fastify, db, config, logger}) to build the module.
 *   2. Decorate:
 *        - fastify.artifactService   — back-compat (ArtifactService)
 *        - fastify.recordingService  — back-compat (RecordingService)
 *        - fastify.screenshotService — back-compat (ScreenshotService)
 *        - fastify.memoryService     — back-compat (MemoryService)
 *        - fastify.scrcpyService     — back-compat (ScrcpyService @device-stream/android)
 *        - fastify.captureService    — back-compat (CaptureService @device-stream/ios-simulator)
 *        - fastify.artifactsModule   — NEW barrel-friendly surface
 *   3. Call module.registerWorkersAndSubscribers() — registers recording.upload
 *      worker + defers 3 bus subscriptions to onReady (plugin-order fix per
 *      RESEARCH §Pitfall 7).
 *   4. Wire onClose → module.shutdown() (idempotent; includes scrcpy stopAll +
 *      unsub + offWork).
 *
 * Dependencies extended (RESEARCH §Architecture Patterns):
 *   - config       (fastify.config.storage.artifacts.path for ArtifactService basePath)
 *   - db           (persistEnvelope INSERT to events table for artifact.created)
 *   - queue        (fastify.boss + fastify.queue — createQueue, send, work, offWork)
 *   - event-bus    (fastify.bus + fastify.onPersisted + per-module TypedBus)
 *   - pool-plugin  (fastify.pool.getDevice for adbSerial resolution in job.started subscriber)
 *
 * Plugin NAME stays 'artifact-plugin' (NOT 'artifacts-plugin') — other plugins'
 * dependencies lists reference this name (grep: `dependencies.*artifact-plugin`
 * in server/ → ≥2 plugins — jobs + api likely). Renaming would require a
 * cross-plugin search/replace; unnecessary churn.
 */
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type pino from 'pino';
import type { ScrcpyService } from '@device-stream/android';
import type { CaptureService } from '@device-stream/ios-simulator';

import { createArtifactsModule, type ArtifactsModule } from './internal/module.js';
import type { ArtifactService } from './artifact-service.js';
import type { RecordingService } from './recording-service.js';
import type { ScreenshotService } from './screenshot-service.js';
import type { MemoryService } from './memory-service.js';

declare module 'fastify' {
  interface FastifyInstance {
    artifactService: ArtifactService;
    recordingService: RecordingService;
    screenshotService: ScreenshotService;
    memoryService: MemoryService;
    scrcpyService: ScrcpyService;
    captureService: CaptureService;
    artifactsModule: ArtifactsModule;
  }
}

async function artifactsPlugin(fastify: FastifyInstance): Promise<void> {
  const module = createArtifactsModule({
    fastify,
    db: fastify.db,
    config: fastify.config,
    logger: fastify.log as unknown as pino.Logger,
  });

  fastify.decorate('artifactService', module.artifactService);
  fastify.decorate('recordingService', module.recordingService);
  fastify.decorate('screenshotService', module.screenshotService);
  fastify.decorate('memoryService', module.memoryService);
  fastify.decorate('scrcpyService', module.scrcpyService);
  fastify.decorate('captureService', module.captureService);
  fastify.decorate('artifactsModule', module);

  await module.registerWorkersAndSubscribers();

  fastify.addHook('onClose', async () => {
    await module.shutdown();
  });

  fastify.log.info(
    'Artifacts plugin registered: recording.upload queue + 3 bus subscribers (job.started / job.completed / maestro.log.written deferred to onReady)',
  );
}

export default fp(artifactsPlugin, {
  name: 'artifact-plugin',
  dependencies: ['config', 'db', 'queue', 'event-bus', 'pool-plugin'],
});
