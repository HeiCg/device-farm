/**
 * Phase 18 / Plan 18-02 — Lifecycle module queue contract (QUEUE-06, QUEUE-08).
 *
 * Exports:
 *   - Queue name constants (aliases of QUEUE_NAMES.LIFECYCLE_*) for ergonomic imports.
 *   - Cron expressions per schedule.
 *   - lifecycleJobPayloadSchema — re-exported from ./schemas.js for downstream consumers.
 *   - registerLifecycleSchedulesAndWorkers(deps) — factory that performs the canonical
 *     three-step sequence per RESEARCH §Pattern 1 + §Pitfall 2 FOR EACH of the 3 queues:
 *       1. createQueue(name, {policy:'stately', retryLimit:1, retryBackoff:true, retryDelay:30})
 *       2. queue.schedule(name, cron, {}, {singletonKey: name})   — envelope stored with
 *          correlationId:null so queue.work generates a fresh UUID per fire (Plan 18-00 Option B).
 *       3. queue.work(name, handler)  → returns workerId for later boss.offWork on shutdown.
 *
 * Worker handlers invoke the pure task bodies (`runCompressionTask` etc. — unchanged)
 * and emit `compressionCompleted` / `retentionCompleted` / `diskChecked` on success;
 * on throw they emit `taskFailed({task, error, durationMs})` THEN re-throw for
 * pg-boss retry accounting (RESEARCH §Pattern 1 + §Anti-Patterns).
 *
 * Ordering is load-bearing — pg-boss v12 requires createQueue BEFORE schedule
 * (throws "Queue ${name} not found" otherwise). Schedule is idempotent-upsert on
 * (name, key); safe to call every boot.
 */
import type pino from 'pino';
import type { FastifyInstance } from 'fastify';

import { QUEUE_NAMES } from '../queue/names.js';
import type { Database } from '../db/index.js';
import type { AppConfig } from '../config/schema.js';

import { runCompressionTask } from './compression-task.js';
import { runRetentionTask } from './retention-task.js';
import { runDiskPressureTask } from './disk-pressure-task.js';

import { lifecycleJobPayloadSchema, type LifecycleJobPayload } from './schemas.js';
import { LIFECYCLE_AGGREGATE_ID, type LifecycleEmitters } from './events.js';
import type { LifecycleStats } from './stats.js';

// ============================================================
// Re-exports (keeps consumers importing from queue.ts stable).
// ============================================================

export { lifecycleJobPayloadSchema };
export type { LifecycleJobPayload };

export const LIFECYCLE_COMPRESS_DAILY_QUEUE_NAME  = QUEUE_NAMES.LIFECYCLE_COMPRESS_DAILY;
export const LIFECYCLE_RETENTION_DAILY_QUEUE_NAME = QUEUE_NAMES.LIFECYCLE_RETENTION_DAILY;
export const LIFECYCLE_DISK_HOURLY_QUEUE_NAME     = QUEUE_NAMES.LIFECYCLE_DISK_HOURLY;

// ============================================================
// Cron expressions.
// ============================================================
//
// Three separate schedules per ROADMAP §Phase 18 SC1 + RESEARCH §Open Question #1.
// Daily compression and retention share '0 3 * * *' — RESEARCH noted they can run
// concurrently (deletion is orthogonal to compression at the artifact-set level).
// Disk pressure is hourly.
//
// Staggering (e.g. 0 3 vs 30 3) can be introduced later if operational concerns
// arise; document as "deliberate behaviour change from v2.0's sequential closure".

export const COMPRESS_CRON  = '0 3 * * *';
export const RETENTION_CRON = '0 3 * * *';
export const DISK_CRON      = '0 * * * *';

// ============================================================
// Worker registration factory.
// ============================================================

export interface RegisterLifecycleSchedulesAndWorkersDeps {
  fastify: FastifyInstance;
  db: Database;
  config: AppConfig;
  emit: LifecycleEmitters;
  stats: LifecycleStats;
  logger: pino.Logger;
}

export interface LifecycleQueueRegistration {
  workerIds: string[];
}

export async function registerLifecycleSchedulesAndWorkers(
  deps: RegisterLifecycleSchedulesAndWorkersDeps,
): Promise<LifecycleQueueRegistration> {
  const { fastify, db, config, emit, stats, logger } = deps;
  const workerIds: string[] = [];

  // Shared queue options — see RESEARCH §Pattern 1 + §Pitfall 1.
  // policy:'stately' is what makes back-to-back send(name, payload, {singletonKey})
  // return null on the duplicate (covered by queue.spec.ts test 3).
  const queueOpts = {
    policy: 'stately',
    retryLimit: 1,
    retryBackoff: true,
    retryDelay: 30,
  } as never;

  // -------- Compression (daily 0 3 * * *) --------
  await fastify.boss.createQueue(LIFECYCLE_COMPRESS_DAILY_QUEUE_NAME, queueOpts);
  await fastify.queue.schedule(
    LIFECYCLE_COMPRESS_DAILY_QUEUE_NAME,
    COMPRESS_CRON,
    {} as never,
    { singletonKey: LIFECYCLE_COMPRESS_DAILY_QUEUE_NAME },
  );
  const compressWorkerId = await fastify.queue.work<unknown>(
    LIFECYCLE_COMPRESS_DAILY_QUEUE_NAME,
    async (_payload, jobId) => {
      const log = logger.child({ queue: LIFECYCLE_COMPRESS_DAILY_QUEUE_NAME, jobId });
      const started = Date.now();
      try {
        const result = await runCompressionTask(db, config, log);
        const durationMs = Date.now() - started;
        stats.lastCompressionRun = { timestamp: new Date().toISOString(), result };
        emit.compressionCompleted(LIFECYCLE_AGGREGATE_ID, {
          compressed: result.compressed,
          savedBytes: result.savedBytes,
          durationMs,
        });
      } catch (err) {
        const durationMs = Date.now() - started;
        emit.taskFailed(LIFECYCLE_AGGREGATE_ID, {
          task: 'compression',
          error: err instanceof Error ? err.message : String(err),
          durationMs,
        });
        throw err;  // re-throw for pg-boss retry accounting
      }
    },
  );
  workerIds.push(compressWorkerId);

  // -------- Retention (daily 0 3 * * *) --------
  await fastify.boss.createQueue(LIFECYCLE_RETENTION_DAILY_QUEUE_NAME, queueOpts);
  await fastify.queue.schedule(
    LIFECYCLE_RETENTION_DAILY_QUEUE_NAME,
    RETENTION_CRON,
    {} as never,
    { singletonKey: LIFECYCLE_RETENTION_DAILY_QUEUE_NAME },
  );
  const retentionWorkerId = await fastify.queue.work<unknown>(
    LIFECYCLE_RETENTION_DAILY_QUEUE_NAME,
    async (_payload, jobId) => {
      const log = logger.child({ queue: LIFECYCLE_RETENTION_DAILY_QUEUE_NAME, jobId });
      const started = Date.now();
      try {
        const result = await runRetentionTask(db, config, log);
        const durationMs = Date.now() - started;
        stats.lastRetentionRun = { timestamp: new Date().toISOString(), result };
        emit.retentionCompleted(LIFECYCLE_AGGREGATE_ID, {
          deleted: result.deleted,
          freedBytes: result.freedBytes,
          durationMs,
        });
      } catch (err) {
        const durationMs = Date.now() - started;
        emit.taskFailed(LIFECYCLE_AGGREGATE_ID, {
          task: 'retention',
          error: err instanceof Error ? err.message : String(err),
          durationMs,
        });
        throw err;
      }
    },
  );
  workerIds.push(retentionWorkerId);

  // -------- Disk pressure (hourly 0 * * * *) --------
  await fastify.boss.createQueue(LIFECYCLE_DISK_HOURLY_QUEUE_NAME, queueOpts);
  await fastify.queue.schedule(
    LIFECYCLE_DISK_HOURLY_QUEUE_NAME,
    DISK_CRON,
    {} as never,
    { singletonKey: LIFECYCLE_DISK_HOURLY_QUEUE_NAME },
  );
  const diskWorkerId = await fastify.queue.work<unknown>(
    LIFECYCLE_DISK_HOURLY_QUEUE_NAME,
    async (_payload, jobId) => {
      const log = logger.child({ queue: LIFECYCLE_DISK_HOURLY_QUEUE_NAME, jobId });
      const started = Date.now();
      try {
        const result = await runDiskPressureTask(db, config, log);
        const durationMs = Date.now() - started;
        stats.lastDiskCheck = { timestamp: new Date().toISOString(), result };
        emit.diskChecked(LIFECYCLE_AGGREGATE_ID, {
          currentUsageBytes: result.currentUsageBytes,
          maxBytes: result.maxBytes,
          deleted: result.deleted,
          freedBytes: result.freedBytes,
          durationMs,
        });
      } catch (err) {
        const durationMs = Date.now() - started;
        emit.taskFailed(LIFECYCLE_AGGREGATE_ID, {
          task: 'disk-pressure',
          error: err instanceof Error ? err.message : String(err),
          durationMs,
        });
        throw err;
      }
    },
  );
  workerIds.push(diskWorkerId);

  logger.info(
    {
      compressWorkerId,
      retentionWorkerId,
      diskWorkerId,
      queues: [
        LIFECYCLE_COMPRESS_DAILY_QUEUE_NAME,
        LIFECYCLE_RETENTION_DAILY_QUEUE_NAME,
        LIFECYCLE_DISK_HOURLY_QUEUE_NAME,
      ],
    },
    'Lifecycle schedules and workers registered',
  );

  return { workerIds };
}
