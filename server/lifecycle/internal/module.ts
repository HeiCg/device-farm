/**
 * Phase 18 / Plan 18-03 — createLifecycleModule factory (MOD-06).
 *
 * Owns construction of the per-module TypedBus<LifecycleRegistry>, the
 * persistEnvelope middleware (10 lines duplicated from server/bus/plugin.ts
 * per RESEARCH Open Question #1 — same decision as Phase 16 hooks pilot:
 * consolidation is deferred to Phase 27+), the emit helpers, the three
 * schedule+worker registrations via plan 18-02's factory, and the shutdown
 * lifecycle that offWork's each registered worker id.
 *
 * The Fastify plugin (server/lifecycle/plugin.ts) becomes a thin wrapper: it
 * calls this factory, decorates fastify.lifecycleStats + fastify.lifecycleModule,
 * calls module.registerSchedulesAndWorkers(), and wires onClose → module.shutdown().
 */
import type pino from 'pino';
import type { FastifyInstance } from 'fastify';

import { TypedBus } from '../../bus/bus.js';
import { events as eventsTable } from '../../db/schema.js';
import type { Envelope } from '../../events/envelope.js';
import type { Database } from '../../db/index.js';
import type { AppConfig } from '../../config/schema.js';

import {
  lifecycleRegistry,
  makeLifecycleEmitters,
  type LifecycleRegistry,
  type LifecycleEmitters,
} from '../events.js';
import { registerLifecycleSchedulesAndWorkers } from '../queue.js';
import type { LifecycleStats } from '../stats.js';

export interface CreateLifecycleModuleDeps {
  /** Fastify instance — used to reach fastify.boss + fastify.queue. */
  fastify: FastifyInstance;
  db: Database;
  config: AppConfig;
  logger: pino.Logger;
}

export interface LifecycleModule {
  stats: LifecycleStats;
  emit: LifecycleEmitters;
  bus: TypedBus<LifecycleRegistry>;
  registerSchedulesAndWorkers: () => Promise<void>;
  shutdown: () => Promise<void>;
}

/**
 * Duplicated from server/bus/plugin.ts lines 80-112 + server/hooks/internal/module.ts
 * lines 51-84 (RESEARCH Open Question #1 — keep Phase 15 surface frozen;
 * revisit consolidation in Phase 27+).
 *
 * Fires the side-channel <type>.envelope event for onPersisted subscribers, then
 * fire-and-forgets an INSERT into `events` when the registry entry has persisted=true.
 */
function makePersistEnvelope(deps: {
  db: Database;
  bus: TypedBus<LifecycleRegistry>;
  logger: pino.Logger;
}) {
  const ee = (deps.bus as unknown as { ee: import('node:events').EventEmitter }).ee;
  return function persistEnvelope(envelope: Envelope): void {
    ee.emit(`${envelope.type}.envelope`, envelope);

    const entry = lifecycleRegistry[envelope.type as keyof LifecycleRegistry];
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
        deps.logger.error({ err, envelope }, 'Failed to persist lifecycle event');
      }
    })();
  };
}

export function createLifecycleModule(deps: CreateLifecycleModuleDeps): LifecycleModule {
  const logger = deps.logger.child({ module: 'lifecycle' });

  const bus = new TypedBus(lifecycleRegistry);
  const persistEnvelope = makePersistEnvelope({ db: deps.db, bus, logger });
  const emit = makeLifecycleEmitters(bus, persistEnvelope);

  const stats: LifecycleStats = {
    lastCompressionRun: null,
    lastRetentionRun:   null,
    lastDiskCheck:      null,
  };

  let workerIds: string[] = [];
  let stopped = false;

  return {
    stats,
    emit,
    bus,
    registerSchedulesAndWorkers: async () => {
      const registration = await registerLifecycleSchedulesAndWorkers({
        fastify: deps.fastify,
        db: deps.db,
        config: deps.config,
        emit,
        stats,
        logger,
      });
      workerIds = registration.workerIds;
      logger.info(
        { workerIds, queueCount: workerIds.length },
        'Lifecycle schedules and workers registered',
      );
    },
    shutdown: async () => {
      if (stopped) return;   // idempotent
      stopped = true;
      for (const id of workerIds) {
        try {
          await deps.fastify.boss.offWork(id);
        } catch (err) {
          logger.warn({ err, workerId: id }, 'offWork failed during lifecycle shutdown');
        }
      }
      workerIds = [];
      logger.info('Lifecycle module shutdown complete');
    },
  };
}
