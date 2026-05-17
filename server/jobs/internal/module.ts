/**
 * Phase 23 Plan 23-04 — Jobs module factory (MOD-06).
 *
 * Replaces the imperative coupling in jobs/job-service.ts with a chained-
 * subscriber saga over the typed bus (RESEARCH §Pattern 1 + §Pattern 2).
 *
 * SHAPE (mirrors Phase 21 artifacts + Phase 22 streaming):
 *   - per-module TypedBus<JobsRegistry>
 *   - persistEnvelope 10-line duplicate (7TH SAMPLE POINT — DEFERRED-22-E carries to Phase 27+)
 *   - emit helpers via makeJobsEmitters(bus, persistEnvelope)
 *   - module-local runningJobs Map<jobId, {abortController, deviceId}>
 *   - registerWorkerAndSubscribers — queue + worker + onReady subscribers
 *   - enqueueJob — drain admission + queue.send with singletonKey:jobId
 *   - shutdown — idempotent stopped flag; offWork; unsubscribe
 *
 * DEFERRED-21 resolution: this file imports TypedBus from `../../bus/bus.js`
 * which is exempted from the dep-cruiser rule (rule allows imports from
 * `^server/jobs/`). The OUTER plugin file (server/jobs/plugin.ts) no longer
 * imports from `bus/bus.ts` — the long-standing violation is cleared.
 */
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type pino from 'pino';

import * as schema from '../../db/schema.js';
import { events as eventsTable } from '../../db/schema.js';
import { TypedBus } from '../../bus/bus.js';
import type { Envelope } from '../../events/envelope.js';
import type { Database } from '../../db/index.js';
import type { AppConfig } from '../../config/schema.js';

import {
  jobsRegistry,
  makeJobsEmitters,
  type JobsRegistry,
  type JobsEmitters,
} from '../events.js';
import {
  JOB_EXECUTE_QUEUE_NAME,
  registerJobsExecuteQueue,
  registerJobsExecuteWorker,
  type JobExecutePayload,
} from '../queue.js';
import { runJob, type RunningJobEntry } from './executor.js';
import { wireJobsSagaSubscribers } from './subscribers.js';
import { registerJobsAdminRoutes, honorDrainOnBoot } from './routes.js';
import {
  createInputBroadcaster,
  type InputBroadcaster,
  type SessionDispatcher,
} from './input-broadcaster.js';

export interface CreateJobsModuleDeps {
  fastify: FastifyInstance;
  db: Database;
  config: AppConfig;
  logger: pino.Logger;
}

export interface JobsModule {
  emit: JobsEmitters;
  bus: TypedBus<JobsRegistry>;
  runningJobs: Map<string, RunningJobEntry>;
  getInFlightCount: () => number;
  /**
   * Enqueue a job for execution. Throws 503 (statusCode + code='DRAINING')
   * when system_state has a `drain_requested_at` row. Otherwise forwards
   * to fastify.queue.send with singletonKey:jobId for queue-layer dedup.
   *
   * Returns pg-boss's job id (UUID string), or null on dedup collision
   * (Pitfall 3 — second send with same singletonKey returns null, not throw).
   */
  enqueueJob: (jobId: string, payload: JobExecutePayload) => Promise<string | null>;
  /**
   * Registers job.execute queue + worker + saga subscribers (deferred to onReady).
   * Idempotent — calling twice is safe (pg-boss createQueue is upsert-like).
   */
  registerWorkerAndSubscribers: () => Promise<void>;
  /**
   * Phase 23 Plan 23-05 — re-registers ONLY the pg-boss worker (without
   * touching Fastify routes/hooks). Used by /admin/drain/resume after
   * boss.offWork removed the worker. Safe to call after fastify.ready().
   * Idempotent against pg-boss (createQueue is upsert-like; new worker id
   * each call but old worker was already offWork'd).
   */
  registerWorkerOnly: () => Promise<void>;
  /**
   * Phase 37 Plan 37-04 Wave 1 Track D — InputBroadcaster for fan-out
   * tap/key/text across N session sessions. Wired into the POST
   * /api/sessions/broadcast route by the jobs plugin.
   *
   * Resolves the SessionDispatcher contract via the fastify.sessionsModule
   * decorator at construction time. When sessionsModule is absent (test
   * harnesses that skip sessions plugin), the broadcaster is wired with a
   * throw-stub dispatcher so the symbol exists but invocations fail
   * explicitly.
   */
  broadcaster: InputBroadcaster;
  /**
   * Idempotent. Unsubscribes all bus handlers + offWorks each registered worker
   * + aborts in-flight jobs. Subsequent calls are no-ops (stopped flag).
   */
  shutdown: () => Promise<void>;
}

/**
 * 7TH SAMPLE POINT for persistEnvelope duplication.
 *
 * Phase 16/18/19/20/21/22 each duplicated this ~10-line block. Phase 27+
 * consolidates (DEFERRED-22-E + DEFERRED-23-X). DO NOT consolidate here.
 */
function makePersistEnvelope(deps: {
  db: Database;
  bus: TypedBus<JobsRegistry>;
  logger: pino.Logger;
}) {
  const ee = (deps.bus as unknown as { ee: import('node:events').EventEmitter }).ee;
  return function persistEnvelope(envelope: Envelope): void {
    ee.emit(`${envelope.type}.envelope`, envelope);

    const entry = jobsRegistry[envelope.type as keyof JobsRegistry];
    if (!entry || !entry.persisted) return;

    void (async () => {
      try {
        await deps.db.insert(eventsTable).values({
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
        deps.logger.error({ err, envelope }, 'Failed to persist jobs event');
      }
    })();
  };
}

export function createJobsModule(deps: CreateJobsModuleDeps): JobsModule {
  const { fastify, db, logger } = deps;
  const log = logger.child({ module: 'jobs' });

  // ---------- Per-module typed bus + persistence ----------
  const bus = new TypedBus(jobsRegistry);
  const persistEnvelope = makePersistEnvelope({ db, bus, logger: log });
  const emit = makeJobsEmitters(bus, persistEnvelope);

  // ---------- Module-local in-flight tracking ----------
  const runningJobs = new Map<string, RunningJobEntry>();
  const workerIds: string[] = [];
  const unsubscribers: Array<() => void> = [];
  let stopped = false;

  // ---------- Phase 37 Plan 37-04 — InputBroadcaster wiring ----------
  // The dispatcher is resolved lazily at first-call time so the
  // sessionsModule decorator (registered earlier by sessions/plugin.ts) is
  // available even though jobs/plugin.ts may not have observed the decoration
  // yet at the moment createJobsModule runs (Fastify plugin lifecycle:
  // decorators land synchronously during register, but our broadcaster
  // contract is invoked asynchronously from HTTP route handlers AFTER all
  // plugins are ready).
  const sessionDispatcher: SessionDispatcher = {
    async dispatch(sessionId, action) {
      const sm = (fastify as FastifyInstance & {
        sessionsModule?: { dispatch?: (id: string, action: unknown) => Promise<void> };
      }).sessionsModule;
      if (!sm || typeof sm.dispatch !== 'function') {
        throw new Error('sessionsModule.dispatch not available (sessions plugin not registered?)');
      }
      await sm.dispatch(sessionId, action);
    },
  };
  const broadcaster = createInputBroadcaster({
    dispatcher: sessionDispatcher,
    logger: log,
  });

  const module: JobsModule = {
    emit,
    bus,
    runningJobs,
    broadcaster,
    getInFlightCount: () => runningJobs.size,

    enqueueJob: async (jobId, payload) => {
      // ---------- Drain admission (RESEARCH §Code Examples §1) ----------
      const drain = await db
        .select()
        .from(schema.systemState)
        .where(eq(schema.systemState.key, 'drain_requested_at'))
        .limit(1);
      if (drain.length > 0) {
        const err = Object.assign(new Error('system_draining'), {
          statusCode: 503,
          code: 'DRAINING',
        });
        throw err;
      }
      return fastify.queue.send(JOB_EXECUTE_QUEUE_NAME, payload, {
        singletonKey: jobId,
      });
    },

    registerWorkerOnly: async () => {
      // Plan 23-05 — used by /admin/drain/resume to re-register the pg-boss
      // worker after boss.offWork removed it. Does NOT touch Fastify routes
      // or hooks (safe post-ready()).
      await registerJobsExecuteQueue(fastify.boss);
      const workerId = await registerJobsExecuteWorker(
        fastify.boss,
        async (payload: JobExecutePayload, _bossJobId: string) => {
          await runJob(
            payload.jobId,
            { fastify, jobsModule: module, logger: log },
            runningJobs,
          );
        },
      );
      workerIds.push(workerId);
    },

    registerWorkerAndSubscribers: async () => {
      // 1. Queue + worker registration (synchronous; idempotent).
      await module.registerWorkerOnly();

      // 2. Saga subscribers — defer to onReady (Pitfall 5).
      // jobs plugin registers at step 13 in server/index.ts; pool decorator (step 8)
      // is available, but onReady is the canonical pattern across Phase 19-22.
      fastify.addHook('onReady', async () => {
        const unsubs = wireJobsSagaSubscribers({
          fastify,
          jobsModule: module,
          logger: log,
        });
        unsubscribers.push(...unsubs);
      });

      // 3. Phase 23 Plan 23-05 — admin routes (drain + resume).
      // Route registration happens in plugin body scope (Fastify lifecycle rules).
      await registerJobsAdminRoutes({ fastify, jobsModule: module, logger: log });

      // 4. Phase 23 Plan 23-05 — restart safety: honor existing drain row on boot.
      // onReady ensures fastify.boss is fully initialised before we offWork.
      fastify.addHook('onReady', async () => {
        await honorDrainOnBoot(fastify, log);
      });

      log.info(
        { workerIds, queue: JOB_EXECUTE_QUEUE_NAME },
        'Jobs module worker + saga subscribers + admin routes registered',
      );
    },

    shutdown: async () => {
      if (stopped) return;
      stopped = true;

      // 1. Unsubscribe bus handlers.
      for (const unsub of unsubscribers) {
        try {
          unsub();
        } catch (err) {
          log.warn({ err }, 'Subscriber unsubscribe failed during jobs shutdown');
        }
      }
      unsubscribers.length = 0;

      // 2. offWork every registered worker id.
      for (const id of workerIds) {
        try {
          await fastify.boss.offWork(id);
        } catch (err) {
          log.warn({ err, workerId: id }, 'offWork failed during jobs shutdown');
        }
      }
      workerIds.length = 0;

      // 3. Abort any in-flight jobs.
      for (const [jobId, entry] of runningJobs.entries()) {
        try {
          entry.abortController.abort();
        } catch {
          /* ignore */
        }
        log.warn({ jobId }, 'Aborted in-flight job during jobs shutdown');
      }

      log.info('Jobs module shutdown complete');
    },
  };

  return module;
}
