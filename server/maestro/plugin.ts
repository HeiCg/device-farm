/**
 * Phase 24 / Plan 24-03 — Maestro plugin (THIN WIRER).
 *
 * Replaces the 354-line plugin from Phases 1-23. New shape:
 *  - Calls createMaestroModule(deps) — factory in internal/module.ts.
 *  - Decorates fastify.maestroModule (NEW canonical surface) +
 *    fastify.{hierarchyService, appiumService, deviceInfoCollector}
 *    (3 back-compat decorators preserved per Phase 22/23 convention).
 *  - Registers 6 routes via registerMaestroRoutes(fastify) — extracted
 *    to routes.ts (Task 3.2).
 *  - Defers cross-module bus subscription to onReady (Pitfall 2 — pool
 *    plugin decorates poolModule.bus at step 8; maestro plugin runs at
 *    step 14; deferral keeps wiring agnostic to plugin-order shifts).
 *  - Calls module.shutdown on onClose (idempotent — handles
 *    closeAllSessions internally).
 *
 * DELETED from old plugin: the imperative metadata-collection onReady loop
 * at OLD lines 55-72 (the device-iteration block driving collector.collect
 * at server boot for every existing device).
 * Replaced by the bus-driven device.booted subscriber inside
 * createMaestroModule.registerSubscribers — fires once per fresh boot
 * (4 emit sites in pool-manager.ts from Plan 24-02), not at server boot
 * for every existing device.
 *
 * Plugin name 'maestro-plugin' PRESERVED for back-compat with
 * plugin-order.spec + any dependency-array references (RESEARCH §Open
 * Question 3).
 */
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type pino from 'pino';
import { createMaestroModule, type MaestroModule } from './internal/module.js';
import { registerMaestroRoutes } from './routes.js';

declare module 'fastify' {
  interface FastifyInstance {
    hierarchyService: import('./internal/hierarchy-service.js').HierarchyService;
    deviceInfoCollector: import('./internal/device-info-collector.js').DeviceInfoCollector;
    appiumService: import('./internal/appium-service.js').AppiumService;
    maestroModule: MaestroModule;
  }
}

async function maestroPlugin(fastify: FastifyInstance): Promise<void> {
  const module = createMaestroModule({
    fastify,
    db: (fastify as any).db,
    config: (fastify as any).config,
    logger: fastify.log as unknown as pino.Logger,
  });

  fastify.decorate('maestroModule', module);
  fastify.decorate('hierarchyService', module.hierarchyService);
  fastify.decorate('deviceInfoCollector', module.deviceInfoCollector);
  fastify.decorate('appiumService', module.appiumService);

  // Register routes (extracted to routes.ts — Plan 24-03 Task 3.2).
  registerMaestroRoutes(fastify);

  // Defer cross-module subscription to onReady (Pitfall 2 — Phase 23 inheritance).
  fastify.addHook('onReady', async () => {
    await module.registerSubscribers();
  });

  fastify.addHook('onClose', async () => {
    await module.shutdown();
  });

  fastify.log.info('Maestro plugin registered (Phase 24)');
}

export default fp(maestroPlugin, {
  name: 'maestro-plugin',
  // Phase 24: dependencies extended from ['config', 'pool-plugin'] to add
  // db + event-bus per substrate convention (factory needs both).
  dependencies: ['config', 'db', 'event-bus', 'pool-plugin'],
});
