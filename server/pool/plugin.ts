/**
 * Phase 20 / Plan 20-03 — Pool plugin (thin Fastify wrapper).
 *
 * Responsibilities:
 *   1. Call createPoolModule({fastify, db, config, logger, processTracker}) to build module.
 *   2. Register platform drivers (android/ios) on `module.pool` (unchanged from v2.0 config).
 *   3. Decorate fastify with:
 *        - fastify.pool            — back-compat (PoolManager instance; read by api/jobs/maestro/hooks/streaming)
 *        - fastify.processTracker  — back-compat
 *        - fastify.healthChecker   — back-compat (decorator read by Phase 23/24)
 *        - fastify.poolModule      — new barrel-friendly surface for consumers that want
 *                                    event bus access (poolModule.bus.on(...))
 *   4. Call module.registerWorkersAndSubscribers() — starts healthChecker + reaper schedule.
 *   5. Wire onClose → module.shutdown() (idempotent).
 *
 * Dependencies extend from ['config'] → ['config', 'db', 'queue', 'event-bus']:
 *   - config: reads fastify.config.pool.{android,ios}
 *   - db: needed for persistEnvelope middleware (events-table INSERT for health.failed)
 *   - queue: fastify.boss + fastify.queue (createQueue, schedule, work, offWork)
 *   - event-bus: structural — pool emits via its own bus but fastify.bus is the substrate
 *
 * Plugin name stays 'pool-plugin' — 9+ downstream plugins declare it as a dep.
 */
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type pino from 'pino';

import { ProcessTracker } from './process-tracker.js';
import type { PoolManager } from './pool-manager.js';
import type { HealthChecker } from './health-checker.js';
import { DeviceStreamAndroidDriver } from './android/device-stream-driver.js';
import { DeviceStreamIosDriver } from './ios/device-stream-driver.js';
import { createPoolModule, type PoolModule } from './internal/module.js';
// Phase 33 / Plan 33-06 (gap closure) — inject the AndroidStreamingService
// singleton into the AndroidDeviceService singleton at plugin init so
// tap()/pressKey() route through gRPC when the active session is kind:'grpc'.
import { androidDeviceService, androidStreamingService } from '@device-stream/android';

declare module 'fastify' {
  interface FastifyInstance {
    pool: PoolManager;
    processTracker: ProcessTracker;
    healthChecker: HealthChecker;
    poolModule: PoolModule;
  }
}

async function poolPlugin(fastify: FastifyInstance): Promise<void> {
  const config = fastify.config;
  const logger = fastify.log as unknown as pino.Logger;
  const processTracker = new ProcessTracker(logger);

  const module = createPoolModule({
    fastify,
    db: fastify.db,
    config,
    logger,
    processTracker,
  });

  // Register platform drivers on the module's PoolManager (preserved from v2.0 plugin).
  if (config.pool.android.enabled) {
    module.pool.registerDriver('android', new DeviceStreamAndroidDriver(config.pool.android, logger));
    // Phase 33 / Plan 33-06 — wire the AndroidStreamingService singleton into
    // AndroidDeviceService so tap()/pressKey() route through gRPC when the
    // active session is kind:'grpc'. Without this, _streaming is undefined
    // and routing always falls through to the ADB shell-out path.
    androidDeviceService.setStreamingService(androidStreamingService);
    fastify.log.info(
      'Android streaming service wired into AndroidDeviceService (tap/pressKey will route through gRPC when session is gRPC)',
    );
  }
  if (config.pool.ios.enabled) {
    module.pool.registerDriver('ios', new DeviceStreamIosDriver());
  }

  fastify.decorate('pool', module.pool);
  fastify.decorate('processTracker', processTracker);
  fastify.decorate('healthChecker', module.healthChecker);
  fastify.decorate('poolModule', module);

  // Start healthChecker (30s setInterval) + reaper schedule (pg-boss every minute).
  await module.registerWorkersAndSubscribers();

  fastify.addHook('onClose', async () => {
    await module.shutdown();
  });

  fastify.log.info(
    'Pool plugin registered: healthChecker (30s in-process) + device.reap pg-boss schedule owned by module',
  );
}

export default fp(poolPlugin, {
  name: 'pool-plugin',
  dependencies: ['config', 'db', 'queue', 'event-bus'],
});
