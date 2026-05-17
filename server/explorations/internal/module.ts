/**
 * Explorations module factory — MOD-06 (Phase 35 Plan 35-01).
 *
 * Replaces the Plan 35-00 throw-stub with the full factory body:
 *   - per-module TypedBus<ExplorationsRegistry>
 *   - persistEnvelope closure (12TH SAMPLE POINT — DEFERRED-26-B continues
 *     through Phase 27+ consolidation tracker; mirror Phase 26 + Phase 34 shape
 *     verbatim with explorationsRegistry substitution).
 *   - emit helpers via makeExplorationsEmitters(bus, persistEnvelope)
 *   - enqueueRun(runId) — imperative façade over fastify.boss.send with
 *     singletonKey:runId so the queue cannot accept duplicate enqueues for
 *     the same run (defense-in-depth alongside Plan 35-02's worker
 *     idempotency guard).
 *   - shutdown — idempotent via stopped flag.
 *
 * The queue itself (boss.createQueue + boss.work) is registered in Plan 35-02
 * alongside the agent runner worker body. enqueueRun here only `boss.send`s
 * the message — pg-boss accepts sends to a queue that has not yet had a
 * worker registered (the row sits in the table until a worker attaches).
 */
import type { FastifyInstance } from 'fastify';
import type pino from 'pino';

import * as schema from '../../db/schema.js';
import { events as eventsTable } from '../../db/schema.js';
import { TypedBus } from '../../bus/bus.js';
import type { Database } from '../../db/index.js';
import type { Envelope } from '../../events/envelope.js';

import {
  explorationsRegistry,
  makeExplorationsEmitters,
  type ExplorationsRegistry,
  type ExplorationsEmitters,
} from '../events.js';
import {
  EXPLORATION_RUN_QUEUE_NAME,
  registerExplorationsRunWorker,
  type ExplorationRunPayload,
} from '../queue.js';
import * as repo from './repo.js';
import type { ExplorationRunnerDeps } from './agent-runner.js';
import { ExplorationsBroadcaster } from './broadcaster.js';
import { registerExplorationSubscribers } from './subscribers.js';

export interface CreateExplorationsModuleDeps {
  fastify: FastifyInstance;
  db?: Database;
  bus?: TypedBus<ExplorationsRegistry>;
  logger?: pino.Logger;
}

export interface ExplorationsModule {
  readonly bus: TypedBus<ExplorationsRegistry>;
  readonly emit: ExplorationsEmitters;
  /**
   * Plan 35-03 — per-run in-memory broadcaster. WS route subscribes sockets;
   * subscribers translate 6 bus events into WS frames + publish here.
   */
  readonly broadcaster: ExplorationsBroadcaster;
  /**
   * Enqueue an agent run via pg-boss. Returns the message id (or null when
   * the queue refused the send — e.g. the singleton key already exists with
   * an unprocessed message).
   */
  enqueueRun(runId: string): Promise<string | null>;
  /**
   * Plan 35-02 — register the pg-boss `exploration.run` worker (idempotent).
   * Plugin onReady invokes this with the runner deps (db, emit, loadArtifact,
   * serverUrl, sessionToken). Stores the workerId so shutdown can offWork().
   */
  registerWorker(deps: ExplorationRunnerDeps): Promise<void>;
  /**
   * Plan 35-03 — register bus subscribers that translate 6 explorationsRegistry
   * events into broadcaster WS frames. Called from plugin onReady (idempotent).
   */
  registerSubscribers(): void;
  shutdown(): Promise<void>;
}

/**
 * 12TH SAMPLE POINT for persistEnvelope duplication (DEFERRED-26-B continues).
 *
 * Phase 16/18/19/20/21/22/23/24/25/26/34 each duplicated this ~10-line block.
 * Phase 27+ owns consolidation. DO NOT consolidate here — mirror Phase 34
 * shape verbatim with explorationsRegistry substitution.
 */
function makePersistEnvelope(deps: {
  db: Database;
  bus: TypedBus<ExplorationsRegistry>;
  logger: pino.Logger;
}) {
  const ee = (deps.bus as unknown as { ee: import('node:events').EventEmitter }).ee;
  return function persistEnvelope(envelope: Envelope): void {
    ee.emit(`${envelope.type}.envelope`, envelope);

    const entry = explorationsRegistry[envelope.type as keyof ExplorationsRegistry];
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
        deps.logger.error({ err, envelope }, 'Failed to persist explorations event');
      }
    })();
  };
}

export function createExplorationsModule(
  deps: CreateExplorationsModuleDeps,
): ExplorationsModule {
  const { fastify } = deps;
  const db = deps.db ?? fastify.db;
  const logger = (deps.logger ?? (fastify.log as unknown as pino.Logger)).child({
    module: 'explorations',
  });

  if (!db) {
    throw new Error('createExplorationsModule: db dependency is required');
  }

  const bus = deps.bus ?? new TypedBus<ExplorationsRegistry>(explorationsRegistry);
  const persistEnvelope = makePersistEnvelope({ db, bus, logger });
  const emit = makeExplorationsEmitters(bus, persistEnvelope);
  const broadcaster = new ExplorationsBroadcaster(logger);

  let stopped = false;
  let workerId: string | null = null;
  let unsubscribeBus: (() => void) | null = null;

  async function enqueueRun(runId: string): Promise<string | null> {
    // singletonKey:runId blocks double-spawn of the agent runner for the same
    // run. The pg-boss queue + worker registration land in Plan 35-02. Sends
    // to a not-yet-created queue throw — defer the call until then by writing
    // the row first and letting the worker pick it up after createQueue.
    const boss = (fastify as FastifyInstance & {
      boss?: {
        send: <T>(
          name: string,
          data: T,
          options?: { singletonKey?: string },
        ) => Promise<string | null>;
      };
    }).boss;
    if (!boss) {
      logger.warn(
        { runId },
        'fastify.boss not decorated; enqueueRun is a no-op (queue plugin missing)',
      );
      return null;
    }
    try {
      return await boss.send<ExplorationRunPayload>(
        EXPLORATION_RUN_QUEUE_NAME,
        { runId },
        { singletonKey: runId },
      );
    } catch (err) {
      // Plan 35-02 registers the queue via createQueue. Until then, send
      // throws "queue does not exist". We catch + log + return null so the
      // POST handler still returns the runId (the row exists in the DB; the
      // agent run is just deferred until Plan 35-02 lands).
      logger.warn(
        { err, runId, queue: EXPLORATION_RUN_QUEUE_NAME },
        'enqueueRun: boss.send threw (likely queue not yet created — Plan 35-02 wires the worker)',
      );
      return null;
    }
  }

  async function registerWorker(runnerDeps: ExplorationRunnerDeps): Promise<void> {
    const boss = (fastify as FastifyInstance & {
      boss?: import('pg-boss').PgBoss;
    }).boss;
    if (!boss) {
      logger.warn(
        'fastify.boss not decorated; cannot register exploration.run worker',
      );
      return;
    }
    // Defensive: test builds inject a boss stub with only `.send()` — skip
    // worker registration when createQueue/work aren't present.
    const bossLike = boss as unknown as {
      createQueue?: unknown;
      work?: unknown;
    };
    if (typeof bossLike.createQueue !== 'function' || typeof bossLike.work !== 'function') {
      logger.warn(
        'fastify.boss lacks createQueue/work (likely a test stub); skipping exploration.run worker registration',
      );
      return;
    }
    if (workerId !== null) {
      logger.warn({ workerId }, 'exploration.run worker already registered');
      return;
    }
    workerId = await registerExplorationsRunWorker(boss, runnerDeps);
    logger.info({ queue: EXPLORATION_RUN_QUEUE_NAME, workerId }, 'exploration.run worker registered');
  }

  function registerSubscribers(): void {
    if (unsubscribeBus !== null) {
      logger.warn('explorations subscribers already registered; skipping');
      return;
    }
    unsubscribeBus = registerExplorationSubscribers({ bus, broadcaster });
    logger.info('explorations bus → broadcaster subscribers registered (6 events)');
  }

  async function shutdown(): Promise<void> {
    if (stopped) return;
    stopped = true;
    if (unsubscribeBus) {
      try {
        unsubscribeBus();
      } catch (err) {
        logger.warn({ err }, 'shutdown: unsubscribeBus failed');
      }
      unsubscribeBus = null;
    }
    try {
      broadcaster.shutdown();
    } catch (err) {
      logger.warn({ err }, 'shutdown: broadcaster.shutdown failed');
    }
    const boss = (fastify as FastifyInstance & {
      boss?: { offWork: (id: string) => Promise<void> };
    }).boss;
    if (workerId !== null && boss?.offWork) {
      try {
        await boss.offWork(workerId);
      } catch (err) {
        logger.warn({ err, workerId }, 'shutdown: boss.offWork failed');
      }
      workerId = null;
    }
    logger.info('explorations module shutdown complete');
  }

  return { bus, emit, broadcaster, enqueueRun, registerWorker, registerSubscribers, shutdown };
}

// Re-export schema namespace for tests that want to assert against the
// underlying table shape without re-importing from server/db/schema.js.
export { schema, repo };
