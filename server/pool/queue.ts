/**
 * Phase 20 / Plan 20-03 — Pool module queue contract (QUEUE-06).
 *
 * Exports:
 *   - DEVICE_REAP_QUEUE_NAME / DEVICE_BOOT_QUEUE_NAME (aliases of QUEUE_NAMES.*).
 *   - REAP_CRON = '* * * * *' (every minute).
 *   - registerPoolQueues(deps) — factory that performs the canonical
 *     3-step sequence for device.reap ONLY:
 *       1. createQueue(DEVICE_REAP, {policy:'stately', retryLimit:1, retryBackoff:true, retryDelay:30})
 *       2. queue.schedule(DEVICE_REAP, REAP_CRON, {}, {singletonKey: DEVICE_REAP})
 *       3. queue.work(DEVICE_REAP, handler) → handler calls processTracker.reapOrphans()
 *     Returns {workerIds: [reapWorkerId]}.
 *
 * DEVICE_BOOT is intentionally NOT registered in Phase 20 — RESEARCH
 * §Queue Semantics: Phase 23 jobs keystone owns the consumer. Exporting
 * the NAME constant above gives Phase 23 a forward-compat hook without
 * Phase 20 runtime risk.
 *
 * Ordering is load-bearing — pg-boss v12 requires createQueue BEFORE
 * schedule (throws "Queue device.reap not found" otherwise — RESEARCH
 * §Pitfall 5 cross-references lifecycle + reporting). Schedule is
 * idempotent-upsert on (name, key); safe to call every boot.
 *
 * policy:'stately' + singletonKey is what makes back-to-back schedule
 * fires return null on the duplicate (prevents overlap if a reap cycle
 * runs long — e.g. slow `ps axo` on macOS). Matches Phase 18 lifecycle
 * pattern exactly.
 */
import type pino from 'pino';
import type { FastifyInstance } from 'fastify';

import { QUEUE_NAMES } from '../queue/names.js';
import type { ProcessTracker } from './process-tracker.js';

export const DEVICE_REAP_QUEUE_NAME = QUEUE_NAMES.DEVICE_REAP;
export const DEVICE_BOOT_QUEUE_NAME = QUEUE_NAMES.DEVICE_BOOT;  // reserved; NOT registered in Phase 20

/**
 * Cron for the reaper schedule — every minute. Plan 20-03 passes this to
 * `fastify.queue.schedule(DEVICE_REAP_QUEUE_NAME, REAP_CRON, ...)`.
 */
export const REAP_CRON = '* * * * *';

export interface RegisterPoolQueuesDeps {
  fastify: FastifyInstance;
  processTracker: ProcessTracker;
  logger: pino.Logger;
}

export interface PoolQueueRegistration {
  workerIds: string[];
}

export async function registerPoolQueues(
  deps: RegisterPoolQueuesDeps,
): Promise<PoolQueueRegistration> {
  const { fastify, processTracker, logger } = deps;
  const workerIds: string[] = [];

  // 1. Create the queue BEFORE scheduling (pg-boss ordering constraint).
  await fastify.boss.createQueue(DEVICE_REAP_QUEUE_NAME, {
    policy: 'stately',       // drops duplicates if reap cycle runs long
    retryLimit: 1,
    retryBackoff: true,
    retryDelay: 30,
  } as never);

  // 2. Register the cron schedule. Idempotent-upsert on (name, singletonKey).
  await fastify.queue.schedule(
    DEVICE_REAP_QUEUE_NAME,
    REAP_CRON,
    {} as never,
    { singletonKey: DEVICE_REAP_QUEUE_NAME },
  );

  // 3. Register the worker handler. `fastify.queue.work` restores ALS
  //    from envelope.correlationId BEFORE invoking the handler (Phase 15
  //    substrate at server/queue/plugin.ts). Each scheduled fire generates
  //    a fresh correlationId per Plan 18-00 Option B (server/queue/plugin.ts
  //    schedule envelope has correlationId=null so queue.work stamps fresh UUID).
  const reapWorkerId = await fastify.queue.work<unknown>(
    DEVICE_REAP_QUEUE_NAME,
    async (_payload, jobId) => {
      const log = logger.child({ queue: DEVICE_REAP_QUEUE_NAME, jobId });
      try {
        await processTracker.reapOrphans();
      } catch (err) {
        log.error({ err }, 'Reaper fire failed');
        throw err;  // re-throw for pg-boss retry accounting
      }
    },
  );
  workerIds.push(reapWorkerId);

  logger.info(
    { reapWorkerId, queue: DEVICE_REAP_QUEUE_NAME },
    'Pool schedules + workers registered',
  );
  return { workerIds };
}
