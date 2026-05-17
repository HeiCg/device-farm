/**
 * Phase 20 / Plan 20-03 — createPoolModule factory (MOD-06).
 *
 * Overwrites the plan 20-00 throw-stub. Owns construction of:
 *   - PoolManager instance (from ../pool-manager.js — allocation/release/
 *     state machine; 4th constructor param is the real emit wired here)
 *   - HealthChecker instance (from ../health-checker.js — 30s in-process
 *     setInterval probe loop; 4th constructor param is the real emit)
 *   - per-module TypedBus<PoolRegistry>
 *   - persistEnvelope middleware (10 lines duplicated from server/bus/plugin.ts
 *     per RESEARCH Open Question #1 — 4th sample point; Phase 27+ consolidation
 *     trigger reached once this plan ships)
 *   - emit helpers (makePoolEmitters with persistence onEmit)
 *   - registerWorkersAndSubscribers: starts healthChecker.start(30_000) +
 *     awaits registerPoolQueues (creates device.reap queue + schedule + worker)
 *   - idempotent shutdown: stopped flag; calls healthChecker.stop() + offWork
 *     per registered worker id
 *
 * The Fastify plugin (server/pool/plugin.ts) becomes a thin wrapper: it
 * calls this factory, decorates fastify.pool + processTracker + healthChecker +
 * poolModule (4 decorators — back-compat + new surface), registers the
 * platform drivers on `module.pool`, calls module.registerWorkersAndSubscribers(),
 * and wires onClose → module.shutdown().
 *
 * pool.shutdown() (kills emulator processes) STAYS imperative in
 * server/index.ts (RESEARCH §Open Question 1) because the current flow
 * needs it to run AFTER jobService.shutdown (waits for running jobs) but
 * BEFORE app.close (plugin onClose). Future phase may migrate; Phase 20
 * scope is healthChecker + reaper lifecycle only.
 */
import type pino from 'pino';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';

import { TypedBus } from '../../bus/bus.js';
import * as schema from '../../db/schema.js';
import { events as eventsTable } from '../../db/schema.js';
import type { Envelope } from '../../events/envelope.js';
import type { Database } from '../../db/index.js';
import type { AppConfig } from '../../config/schema.js';

import { PoolManager } from '../pool-manager.js';
import { HealthChecker } from '../health-checker.js';
import { ProcessTracker } from '../process-tracker.js';
import {
  poolRegistry,
  makePoolEmitters,
  type PoolRegistry,
  type PoolEmitters,
} from '../events.js';
import { registerPoolQueues } from '../queue.js';
import {
  createDeviceDiscoveryService,
  createAndroidAdapter,
  createIosAdapter,
  type DeviceDiscoveryService,
  type DiscoveredDevice,
} from './discovery/index.js';
import { PhysicalAndroidDriver } from '../android/physical.js';
import { createPairingService, type PairingService } from './wireless/index.js';

export interface CreatePoolModuleDeps {
  /** Fastify instance — used to reach fastify.boss + fastify.queue. */
  fastify: FastifyInstance;
  db: Database;
  config: AppConfig;
  logger: pino.Logger;
  processTracker: ProcessTracker;
}

export interface PoolModule {
  pool: PoolManager;
  /**
   * Phase 37 Plan 37-04 — direct accessor for the new batch-allocation API.
   * Exposed at the PoolModule level (not just under `pool.`) so the jobs
   * executor's parallel-deploy branch can call `poolModule.allocateMany(...)`
   * without reaching through the PoolManager class instance. Implementation
   * delegates to PoolManager.allocateMany (no extra wrapping logic).
   */
  allocateMany: PoolManager['allocateMany'];
  healthChecker: HealthChecker;
  emit: PoolEmitters;
  bus: TypedBus<PoolRegistry>;
  /**
   * Phase 36 / Plan 36-01 — DeviceDiscoveryService instance.
   * Exposed so tests can drive `pollOnce()` deterministically and so
   * future plans can read `getSnapshot()` without re-running adb/simctl.
   */
  discoveryService: DeviceDiscoveryService;
  /**
   * Phase 36 / Plan 36-02 — Wireless PairingService instance.
   * Consumed by server/api/pairing.ts (POST /api/devices/pair/start +
   * WS /api/devices/pair/stream). Sessions live in-memory with 60s TTL.
   */
  pairingService: PairingService;
  /** Start healthChecker setInterval + register device.reap schedule+worker. */
  registerWorkersAndSubscribers: () => Promise<void>;
  /** Idempotent — stops healthChecker + offWork's every registered worker id. */
  shutdown: () => Promise<void>;
}

/**
 * Duplicated from server/bus/plugin.ts + server/hooks/internal/module.ts +
 * server/lifecycle/internal/module.ts + server/reporting/internal/module.ts.
 * Fourth sample point — Phase 27+ consolidation trigger.
 *
 * Fires the side-channel <type>.envelope event for onPersisted subscribers,
 * then fire-and-forgets an INSERT into `events` when the registry entry
 * has persisted=true.
 */
function makePersistEnvelope(deps: {
  db: Database;
  bus: TypedBus<PoolRegistry>;
  logger: pino.Logger;
}) {
  const ee = (deps.bus as unknown as { ee: import('node:events').EventEmitter }).ee;
  return function persistEnvelope(envelope: Envelope): void {
    ee.emit(`${envelope.type}.envelope`, envelope);

    const entry = poolRegistry[envelope.type as keyof PoolRegistry];
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
        deps.logger.error({ err, envelope }, 'Failed to persist pool event');
      }
    })();
  };
}

export function createPoolModule(deps: CreatePoolModuleDeps): PoolModule {
  const logger = deps.logger.child({ module: 'pool' });

  // ---------- Per-module typed bus + persistence ----------
  const bus = new TypedBus(poolRegistry);
  const persistEnvelope = makePersistEnvelope({ db: deps.db, bus, logger });
  const emit = makePoolEmitters(bus, persistEnvelope);

  // ---------- Class instances with REAL emit wired (replaces NOOP_POOL_EMIT) ----------
  const pool = new PoolManager(deps.config, deps.processTracker, logger, emit);
  const healthChecker = new HealthChecker(pool, deps.processTracker, logger, emit);

  // ---------- Phase 36 / Plan 36-02 — register PhysicalAndroidDriver ----------
  // Distinct driver key from the emulator-only 'android' platform key so
  // adoptDiscoveredDevice (Plan 36-01) can resolve to a real DeviceDriver
  // when admitting Physical kind devices. Without this, physical devices
  // are admitted as port-less Idle entries with no working lifecycle.
  pool.registerDriver('android-physical', new PhysicalAndroidDriver(logger));

  // ---------- Phase 36 / Plan 36-01 — DeviceDiscoveryService (5s poller) ----------
  // The SOLE bare `adb devices` / `simctl list devices` caller in the codebase
  // (enforced by discovery-sole-caller.spec.ts grep-guard + dep-cruiser rule
  // 13 `no-bare-adb-list-outside-discovery`). Emits via the typed bus so the
  // dashboard live-list, command palette device source, and PoolManager
  // physical-device adoption all consume the same event stream.
  const discoveryService = createDeviceDiscoveryService({
    adapters: [createAndroidAdapter(logger), createIosAdapter(logger)],
    emit,
    logger,
    intervalMs: 5_000,
  });

  // ---------- Phase 36 / Plan 36-02 — Wireless PairingService ----------
  // 60s-TTL pairing sessions; orchestrates mDNS browsers + adb pair/connect
  // + QR. Consumed by server/api/pairing.ts. shutdownAll() is invoked in
  // module shutdown so any in-flight sessions tear down their bonjour
  // browsers (Pitfall 5 — ghost services prevention).
  const pairingService = createPairingService({ emit, logger });

  // ---------- Shutdown state ----------
  let workerIds: string[] = [];
  let stopped = false;
  // Phase 23 Plan 23-04 — pool subscribes to job.failed for device release.
  // Phase 36 Plan 36-01 — pool subscribes to device.discovered.added/removed
  // for physical-device adoption.
  const unsubscribers: Array<() => void> = [];

  return {
    pool,
    // Phase 37 Plan 37-04 — bind class method to instance so callers can
    // `const { allocateMany } = poolModule;` without losing `this`.
    allocateMany: pool.allocateMany.bind(pool),
    healthChecker,
    emit,
    bus,
    discoveryService,
    pairingService,

    registerWorkersAndSubscribers: async () => {
      // 1. Start in-process health-checker (30s interval — NOT pg-boss per
      //    RESEARCH §Don't Hand-Roll: ephemeral health state doesn't need durability).
      healthChecker.start(30_000);

      // 2. Register the reaper schedule via pg-boss (singleton protection +
      //    graceful drain via onClose).
      const registration = await registerPoolQueues({
        fastify: deps.fastify,
        processTracker: deps.processTracker,
        logger,
      });
      workerIds = registration.workerIds;

      // 3. Phase 36 / Plan 36-01 — subscribe to discovery events for
      //    physical-device adoption. Filter on deviceType==='Physical' so
      //    emulator + simulator events flow through the bus untouched
      //    (consumed by the dashboard, command palette, etc.).
      const uDiscoveredAdded = bus.on('device.discovered.added', async (raw: unknown) => {
        const payload = raw as { device: DiscoveredDevice };
        if (payload.device.deviceType !== 'Physical') return;
        try {
          await pool.adoptDiscoveredDevice(payload.device);
        } catch (err) {
          logger.warn(
            { err, deviceId: payload.device.id },
            'pool.adoptDiscoveredDevice failed',
          );
        }
      });
      const uDiscoveredRemoved = bus.on('device.discovered.removed', async (raw: unknown) => {
        const payload = raw as { device: DiscoveredDevice };
        if (payload.device.deviceType !== 'Physical') return;
        try {
          await pool.handleDiscoveryRemoval(payload.device.id);
        } catch (err) {
          logger.warn(
            { err, deviceId: payload.device.id },
            'pool.handleDiscoveryRemoval failed',
          );
        }
      });
      unsubscribers.push(uDiscoveredAdded, uDiscoveredRemoved);

      // 4. Phase 36 / Plan 36-01 — start the 5s discovery poll loop AFTER
      //    subscribers are wired so no `discovered.added` event fires into
      //    a void during boot. start() is idempotent + runs the first tick
      //    immediately.
      discoveryService.start();

      // 5. Phase 23 Plan 23-04 — subscribe to job.failed for device release
      //    (saga error-path side effect; pool owns device lifecycle).
      //    Deferred to onReady because pool plugin registers at step 8 and
      //    fastify.jobsModule is not decorated until step 13.
      deps.fastify.addHook('onReady', async () => {
        const jobsModule = (
          deps.fastify as FastifyInstance & {
            jobsModule?: { bus: { on: (name: string, handler: (raw: unknown) => void) => () => void } };
          }
        ).jobsModule;
        if (!jobsModule || !jobsModule.bus) {
          logger.warn(
            'pool: fastify.jobsModule.bus not decorated; job.failed subscriber not wired',
          );
          return;
        }

        const uFailed = jobsModule.bus.on('job.failed', async (raw: unknown) => {
          const payload = raw as { jobId: string; step: string; reason: string };
          try {
            // Lookup deviceId from the jobs row — release should be idempotent
            // if pool already released via release() callsite.
            const rows = await deps.db
              .select({ deviceId: schema.jobs.deviceId })
              .from(schema.jobs)
              .where(eq(schema.jobs.id, payload.jobId))
              .limit(1);
            const deviceId = rows[0]?.deviceId;
            if (deviceId) {
              await pool.release(deviceId);
            }
          } catch (err) {
            logger.warn(
              { err, jobId: payload.jobId },
              'pool.releaseDevice on job.failed failed',
            );
          }
        });
        unsubscribers.push(uFailed);
        logger.info('pool subscribed to fastify.jobsModule.bus.job.failed (device release)');
      });

      logger.info(
        { workerIds, healthCheckerRunning: true, queues: ['device.reap'] },
        'Pool module workers + subscribers registered',
      );
    },

    shutdown: async () => {
      if (stopped) return;  // idempotent
      stopped = true;

      // 0. Phase 23 Plan 23-04 — unsubscribe job.failed subscriber.
      for (const unsub of unsubscribers) {
        try { unsub(); } catch (err) { logger.warn({ err }, 'pool subscriber unsubscribe failed'); }
      }
      unsubscribers.length = 0;

      // 1a. Phase 36 / Plan 36-01 — stop the discovery poll loop BEFORE the
      //     health checker so its setInterval can't fire one more tick into
      //     a tearing-down bus.
      discoveryService.stop();

      // 1b. Phase 36 / Plan 36-02 — cancel any in-flight pairing sessions
      //     (stops bonjour browsers — Pitfall 5 ghost-service prevention).
      try {
        pairingService.shutdownAll();
      } catch (err) {
        logger.warn({ err }, 'pairingService.shutdownAll failed');
      }

      // 1. Stop the in-process health checker.
      healthChecker.stop();

      // 2. offWork each registered reaper worker id.
      for (const id of workerIds) {
        try {
          await deps.fastify.boss.offWork(id);
        } catch (err) {
          logger.warn({ err, workerId: id }, 'offWork failed during pool shutdown');
        }
      }
      workerIds = [];

      // NOTE: pool.shutdown() (kills emulator processes) is NOT called here —
      // RESEARCH §Open Question 1: current flow in server/index.ts requires
      // pool.shutdown to run AFTER jobService.shutdown but BEFORE app.close.
      // Keeping it imperative in server/index.ts preserves that ordering.
      // MODULE.md §Non-Goals documents the split.
      logger.info('Pool module shutdown complete');
    },
  };
}
