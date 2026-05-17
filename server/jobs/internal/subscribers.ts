/**
 * Phase 23 Plan 23-04 — Saga subscribers wiring (jobs-owned).
 *
 * Per RESEARCH §Pattern 2 (subscriber lives in OWNER module), this file
 * houses ONLY the subscribers jobs owns:
 *   - device.allocated → write jobs.status='allocated' + emit job.allocated
 *   - job.completed → write terminal status + emit job.cleanup.requested
 *   - job.failed → write status='failed' + emit job.cleanup.requested
 *
 * Other modules own their subscribers:
 *   - artifacts: job.completed → recording.upload queue.send (Phase 21)
 *   - reporting: job.completed → webhook.deliver queue.send (Phase 19)
 *   - streaming: job.cleanup.requested → broadcaster.cleanup (Phase 23 Plan 23-04)
 *   - pool:      job.failed → release device (Phase 23 Plan 23-04)
 *
 * All subscriptions deferred to onReady (Pitfall 5 — pool plugin at step 8;
 * jobs plugin at step 13 reads pool decorator inside onReady to be safe).
 */
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type pino from 'pino';

import * as schema from '../../db/schema.js';
import type { JobsModule } from './module.js';

export interface WireJobsSagaSubscribersDeps {
  fastify: FastifyInstance;
  jobsModule: JobsModule;
  logger: pino.Logger;
}

/**
 * Wires the 3 saga subscribers and returns an array of unsubscribe
 * functions for idempotent shutdown.
 */
export function wireJobsSagaSubscribers(
  deps: WireJobsSagaSubscribersDeps,
): Array<() => void> {
  const { fastify, jobsModule, logger } = deps;
  const log = logger.child({ module: 'jobs.subscribers' });
  const unsubscribers: Array<() => void> = [];

  // ----------------------------------------------------------------
  // 1. device.allocated → write jobs.status='allocated' + emit job.allocated
  // ----------------------------------------------------------------
  // Pool's bus emits device.allocated when allocate() succeeds (Phase 20).
  // poolModule decorator may not exist on all builds (older code uses
  // fastify.pool directly), so we look it up defensively at handler time.
  const poolBus =
    (fastify as FastifyInstance & {
      poolModule?: { bus: { on: (name: string, handler: (env: unknown) => void) => () => void } };
    }).poolModule?.bus;

  if (poolBus) {
    const u1 = poolBus.on('device.allocated', async (raw: unknown) => {
      // TypedBus.on delivers parsed payload directly. Defensive cast — pool's
      // device.allocated payload shape is {deviceId, jobId, platform}.
      const payload = raw as { deviceId: string; jobId: string; platform: 'android' | 'ios' };
      if (!payload || !payload.jobId) return;
      try {
        await fastify.db
          .update(schema.jobs)
          .set({
            status: 'allocated' as never,
            deviceId: payload.deviceId,
          })
          .where(eq(schema.jobs.id, payload.jobId));
        jobsModule.emit.allocated(payload.jobId, {
          jobId: payload.jobId,
          deviceId: payload.deviceId,
          platform: payload.platform,
        });
      } catch (err) {
        log.warn(
          { err, jobId: payload.jobId },
          'Failed to write status=allocated on device.allocated',
        );
      }
    });
    unsubscribers.push(u1);
  } else {
    log.warn('poolModule.bus not decorated; device.allocated subscriber not wired');
  }

  // ----------------------------------------------------------------
  // 2. job.completed → emit cleanup.requested + write terminal row
  // ----------------------------------------------------------------
  // Note: artifacts subscriber owns recording stop + recording.upload enqueue.
  // jobs subscriber owns terminal DB write + cleanup hand-off.
  // TypedBus.on delivers the (parsed) payload directly — NOT an envelope.
  const u2 = jobsModule.bus.on('job.completed', async (payload) => {
    try {
      // jobs.status enum allows passed/failed/cancelled/timeout — these match
      // ExecutionResult.status from job-executor.ts.
      await fastify.db
        .update(schema.jobs)
        .set({ status: payload.status as never, finishedAt: new Date() })
        .where(eq(schema.jobs.id, payload.jobId));
      // Saga hand-off — streaming subscriber catches and calls broadcaster.cleanup.
      jobsModule.emit.cleanupRequested(payload.jobId, { jobId: payload.jobId });
    } catch (err) {
      log.warn(
        { err, jobId: payload.jobId },
        'Failed to write terminal status on job.completed',
      );
    }
  });
  unsubscribers.push(u2);

  // ----------------------------------------------------------------
  // 3. job.failed → write status='failed' + emit cleanup.requested
  // ----------------------------------------------------------------
  const u3 = jobsModule.bus.on('job.failed', async (payload) => {
    try {
      await fastify.db
        .update(schema.jobs)
        .set({
          status: 'failed' as never,
          finishedAt: new Date(),
          errorMessage: payload.reason,
        })
        .where(eq(schema.jobs.id, payload.jobId));
      jobsModule.emit.cleanupRequested(payload.jobId, { jobId: payload.jobId });
    } catch (err) {
      log.warn(
        { err, jobId: payload.jobId },
        'Failed to write status=failed on job.failed',
      );
    }
  });
  unsubscribers.push(u3);

  log.info(
    { count: unsubscribers.length },
    'jobs saga subscribers wired (device.allocated / job.completed / job.failed)',
  );

  return unsubscribers;
}
