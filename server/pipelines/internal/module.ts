/**
 * Pipelines module factory (Phase 25 Plan 25-03 — MOD-06).
 *
 * 9TH PERSISTENCE-ENVELOPE SAMPLE POINT — DEFERRED-25-A explicitly says
 * do NOT consolidate. Phase 27+ owns the consolidation.
 *
 * Wires:
 *   - PipelineBroadcaster (in-memory WS fanout per run)
 *   - SecretsService (encrypted secret store)
 *   - GitService (git clone for source-checkout pipelines)
 *   - PipelineService (CRUD + run start; executeRun deleted)
 *   - PipelineScheduler (Plan 25-02 — boss.schedule wrapper)
 *   - per-module TypedBus<PipelinesRegistry>
 *   - persistEnvelope closure
 *   - emit helpers via makePipelinesEmitters
 *   - boss queue + worker for PIPELINE_SCHEDULED_EXECUTE
 *   - bus subscriber on jobsModule.bus 'job.completed' (deferred to onReady — Pitfall 5)
 *   - graceful shutdown (offWork + unsubscribe, idempotent via stopped flag)
 */

import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type pino from 'pino';
import type { PgBoss } from 'pg-boss';

import * as schema from '../../db/schema.js';
import { events as eventsTable } from '../../db/schema.js';
import type { Database } from '../../db/index.js';
import { TypedBus } from '../../bus/bus.js';
import type { Envelope } from '../../events/envelope.js';
import type { JobsModule } from '../../jobs/index.js';

import {
  pipelinesRegistry,
  makePipelinesEmitters,
  type PipelinesRegistry,
  type PipelinesEmitters,
} from '../events.js';
import {
  PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME,
  registerPipelineScheduledExecuteQueue,
  registerPipelineScheduledExecuteWorker,
} from '../queue.js';
import { PipelineBroadcaster } from './broadcaster.js';
import { SecretsService } from './secrets.js';
import { GitService } from './git-service.js';
import { PipelineService } from './service.js';
import { PipelineScheduler } from './scheduler.js';
import { wirePipelinesStageAdvancementSubscriber } from './subscribers.js';
import { createConcurrencyGuard } from './concurrency-guard.js';

export interface CreatePipelinesModuleDeps {
  fastify: FastifyInstance;
  db: Database;
  boss: PgBoss;
  logger: pino.Logger;
  jobsModule: JobsModule;
}

export interface PipelinesModule {
  scheduler: PipelineScheduler;
  service: PipelineService;
  broadcaster: PipelineBroadcaster;
  secretsService: SecretsService;
  gitService: GitService;
  emit: PipelinesEmitters;
  bus: TypedBus<PipelinesRegistry>;
  /**
   * Registers boss.createQueue + boss.work for the schedule-fire queue,
   * reconciles existing schedules at boot (Pitfall 6), and DEFERS the
   * cross-module subscriber wiring to fastify.addHook('onReady', ...) per
   * Pitfall 5 (jobsModule.bus may not be decorated when this plugin's body
   * runs; onReady fires after all plugins register).
   */
  registerWorkersAndSubscribers(): Promise<void>;
  /** Idempotent: stopped flag + boss.offWork + bus unsubscribe. */
  shutdown(): Promise<void>;
}

export function createPipelinesModule(deps: CreatePipelinesModuleDeps): PipelinesModule {
  const { fastify, db, boss, logger, jobsModule } = deps;
  const log = logger.child({ module: 'pipelines' });

  // --- 9TH persistEnvelope sample point — DEFERRED-25-A; do NOT consolidate. ---
  // Phase 16/18/19/20/21/22/23/24/25 each duplicated this ~10-line block.
  // Phase 27+ consolidates. Mirror Phase 23/24 verbatim shape.
  const moduleBus = new TypedBus(pipelinesRegistry);

  function persistEnvelope(envelope: Envelope): void {
    const ee = (moduleBus as unknown as { ee: import('node:events').EventEmitter }).ee;
    ee.emit(`${envelope.type}.envelope`, envelope);

    const entry = pipelinesRegistry[envelope.type as keyof PipelinesRegistry];
    if (!entry || !entry.persisted) return;

    void (async () => {
      try {
        await db.insert(eventsTable).values({
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
        log.error({ err, envelope }, 'Failed to persist pipelines event');
      }
    })();
  }

  const emit = makePipelinesEmitters(moduleBus, persistEnvelope);

  // --- Service construction (dep order) ---
  const broadcaster = new PipelineBroadcaster();
  const secretsService = new SecretsService(db);
  const gitService = new GitService(log, secretsService);
  const concurrencyGuard = createConcurrencyGuard({
    db,
    cap: (fastify.config as any)?.pipelines?.max_concurrent_runs ?? 2,
  });
  // Adapter onto fastify.pool (PoolManager). Wraps allocate/release into the
  // structural shape PipelineService expects so tests can supply a fake pool
  // without pulling in the full Pool module.
  const poolAdapter = {
    allocate: async (platform: 'android' | 'ios', jobId: string) => {
      const dev = await fastify.pool.allocate(platform, jobId);
      if (!dev) return null;
      return {
        id: dev.id,
        emulatorId: dev.emulatorId,
        port: dev.port,
        platform: dev.platform,
      };
    },
    release: (deviceId: string) => fastify.pool.release(deviceId),
  };

  const service = new PipelineService(
    db,
    log,
    broadcaster,
    fastify.jobService,
    gitService,
    secretsService,
    emit,
    boss,
    concurrencyGuard,
    poolAdapter,
  );
  const scheduler = new PipelineScheduler({ db, logger: log, boss });

  // --- Lifecycle state ---
  let stopped = false;
  let workerId: string | undefined;
  let unsubJobCompleted: (() => void) | undefined;

  async function registerWorkersAndSubscribers(): Promise<void> {
    // Pitfall 2: createQueue BEFORE boss.work
    await registerPipelineScheduledExecuteQueue(boss);

    workerId = await registerPipelineScheduledExecuteWorker(boss, async (payload, jobId) => {
      const wlog = log.child({
        queue: PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME,
        jobId,
        pipelineId: payload.pipelineId,
        scheduleId: payload.scheduleId,
      });
      try {
        const runId = await service.triggerRun(
          payload.pipelineId,
          'schedule',
          payload.variables,
          { scheduleId: payload.scheduleId },
        );
        if (!runId) {
          wlog.info('Schedule fire deferred: concurrency cap reached');
          return; // re-enqueued with delay inside triggerRun; skip lastRunAt update
        }
        // Update lastRunAt — preserves legacy scheduler.ts:97-100 behaviour.
        await db
          .update(schema.pipelineSchedules)
          .set({ lastRunAt: new Date() })
          .where(eq(schema.pipelineSchedules.id, payload.scheduleId));
        wlog.info('Schedule fire dispatched run');
      } catch (err) {
        wlog.error({ err }, 'Schedule fire failed');
        throw err; // pg-boss accounting (retryLimit:0)
      }
    });

    // Reconcile pgboss.schedule with pipelineSchedules at boot (Pitfall 6).
    await scheduler.reconcileSchedules();

    // Pitfall 5: cross-module subscriber DEFERRED to onReady — jobsModule.bus
    // may not be decorated when this plugin's body runs.
    fastify.addHook('onReady', async () => {
      const moduleRef: PipelinesModule = {
        scheduler,
        service,
        broadcaster,
        secretsService,
        gitService,
        emit,
        bus: moduleBus,
        registerWorkersAndSubscribers,
        shutdown,
      };
      unsubJobCompleted = wirePipelinesStageAdvancementSubscriber({
        fastify,
        pipelinesModule: moduleRef,
        jobsModule,
        logger: log,
      });
    });

    log.info(
      { workerId, queue: PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME },
      'Pipelines module worker + subscriber wiring registered',
    );
  }

  async function shutdown(): Promise<void> {
    if (stopped) return;
    stopped = true;
    try {
      unsubJobCompleted?.();
    } catch (e) {
      log.warn({ e }, 'unsubscribe failed (ignored)');
    }
    if (workerId) {
      try {
        await boss.offWork(workerId);
      } catch (e) {
        log.warn({ e }, 'offWork failed (ignored)');
      }
    }
    log.info('Pipelines module shutdown complete');
  }

  return {
    scheduler,
    service,
    broadcaster,
    secretsService,
    gitService,
    emit,
    bus: moduleBus,
    registerWorkersAndSubscribers,
    shutdown,
  };
}
