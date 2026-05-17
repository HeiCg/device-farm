/**
 * Phase 16 / Plan 16-02 — createHooksModule factory (MOD-06).
 *
 * Owns construction of the per-module TypedBus<HooksRegistry>, the persistEnvelope
 * middleware (10 lines duplicated from server/bus/plugin.ts per RESEARCH Open Question #1),
 * the emit helpers, the bus→queue bridge subscriber, and the shutdown lifecycle.
 *
 * The Fastify plugin (server/hooks/plugin.ts) becomes a thin wrapper: it calls this
 * factory, decorates fastify.hookExecutor + fastify.hooksModule, starts the worker from
 * plan 16-01, calls module.registerBusSubscribers(), and wires onClose → module.shutdown().
 */
import type pino from 'pino';
import type { FastifyInstance } from 'fastify';

import { TypedBus } from '../../bus/bus.js';
import { events as eventsTable } from '../../db/schema.js';
import type { Envelope } from '../../events/envelope.js';

import { HookExecutor } from '../hook-executor.js';
import type { HookDefinition } from '../schemas.js';
import { hooksRegistry, makeHookEmitters, type HooksRegistry, type HookEmitters } from '../events.js';

import { registerHookRunWorker } from '../queue.js';
import { wireBusToQueue } from './subscribers.js';
import type { DrizzleDb } from './idempotency.js';

export interface CreateHooksModuleDeps {
  /** Fastify instance — used ONLY to reach fastify.boss + fastify.queue + fastify.onPersisted. */
  fastify: FastifyInstance;
  db: DrizzleDb;
  logger: pino.Logger;
  /** Hooks pre-loaded from config (optional). */
  hooks?: HookDefinition[];
}

export interface HooksModule {
  executor: HookExecutor;
  emit: HookEmitters;
  bus: TypedBus<HooksRegistry>;
  registerBusSubscribers: () => Promise<void>;
  shutdown: () => Promise<void>;
}

/**
 * Duplicated from server/bus/plugin.ts lines 80-112 (RESEARCH Open Question #1 —
 * keep Phase 15 surface frozen; revisit consolidation in Phase 27+).
 *
 * Fires the side-channel <type>.envelope event for onPersisted subscribers, then
 * fire-and-forgets an INSERT into `events` when the registry entry has persisted=true.
 */
function makePersistEnvelope(deps: {
  db: DrizzleDb;
  bus: TypedBus<HooksRegistry>;
  logger: pino.Logger;
}) {
  const ee = (deps.bus as unknown as { ee: import('node:events').EventEmitter }).ee;
  return function persistEnvelope(envelope: Envelope): void {
    ee.emit(`${envelope.type}.envelope`, envelope);

    const entry = hooksRegistry[envelope.type as keyof HooksRegistry];
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
        deps.logger.error({ err, envelope }, 'Failed to persist hooks event');
      }
    })();
  };
}

export function createHooksModule(deps: CreateHooksModuleDeps): HooksModule {
  const logger = deps.logger.child({ module: 'hooks' });

  const executor = new HookExecutor(logger);
  if (deps.hooks && deps.hooks.length > 0) {
    executor.setHooks(deps.hooks);
    logger.info({ count: deps.hooks.length }, 'Hooks loaded into executor');
  }

  const bus = new TypedBus(hooksRegistry);
  const persistEnvelope = makePersistEnvelope({ db: deps.db, bus, logger });
  const emit = makeHookEmitters(bus, persistEnvelope);

  let workerId: string | null = null;
  let unsubscribeBus: (() => void) | null = null;
  let stopped = false;

  return {
    executor,
    emit,
    bus,
    registerBusSubscribers: async () => {
      // Start the pg-boss worker (plan 16-01 factory).
      workerId = await registerHookRunWorker({
        fastify: deps.fastify,
        db: deps.db,
        executor,
        emit,
        logger,
      });
      // Wire the bus subscriber.
      unsubscribeBus = wireBusToQueue({
        onPersisted: deps.fastify.onPersisted,
        queueSend: deps.fastify.queue.send.bind(deps.fastify.queue),
        executor,
        emit,
        logger,
      });
      logger.info({ workerId }, 'Hooks module bus subscribers registered');
    },
    shutdown: async () => {
      if (stopped) return; // idempotent
      stopped = true;
      if (unsubscribeBus) {
        try {
          unsubscribeBus();
        } catch (err) {
          logger.warn({ err }, 'Bus unsubscribe failed');
        }
        unsubscribeBus = null;
      }
      if (workerId) {
        try {
          await deps.fastify.boss.offWork(workerId);
        } catch (err) {
          logger.warn({ err }, 'Worker offWork failed');
        }
        workerId = null;
      }
      logger.info('Hooks module shutdown complete');
    },
  };
}
