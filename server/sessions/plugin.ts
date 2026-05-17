/**
 * Sessions plugin — thin Fastify wirer (Phase 34 Plan 34-01 / extended 34-02 / extended 34-03).
 *
 * Constructs the sessions module via createSessionsModule, decorates
 * fastify.sessionsModule, registers REST routes, and (Plan 34-02) registers
 * the WS upgrade route under /ws/sessions/:id via `registerSessionWebSocket`.
 * Hooks onClose → module.shutdown().
 *
 * Plan 34-02 additions:
 *   - 'websocket-plugin' added to dependencies array (WS needs @fastify/websocket).
 *   - registerSessionWebSocket called after route registration.
 *
 * Plan 34-03 additions:
 *   - fastify.sessionsResolver now holds the REAL TargetResolver built via
 *     `createResolver({logger})` — pure MaestroAiResolver by default; chained
 *     FallbackResolver(Maestro + Claude) when SESSION_RESOLVER=claude-vision.
 *     The Plan 34-02 STUB_RESOLVER is no longer wired into fastify (still
 *     exported from ws.ts as a default for buildActionContext's safety net).
 *
 * Dependencies (6 entries):
 *   - config:           fastify.config (server.host/port for wsUrl)
 *   - db:               fastify.db (sessions INSERT + events persist)
 *   - event-bus:        module uses TypedBus<SessionsRegistry>
 *   - pool-plugin:      fastify.pool (allocate/release device)
 *   - auth:             fastify.authService (requireAuth + WS token check)
 *   - websocket-plugin: @fastify/websocket-backed upgrade route
 *
 * NOTE: 'queue' is NOT in deps for Plan 34-02 (sweeper consumer lands 34-04).
 */
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type pino from 'pino';

import { createSessionsModule, type SessionsModule } from './internal/module.js';
import { registerSessionRoutes } from './internal/routes.js';
import { registerSessionWebSocket } from './internal/ws.js';
import { createResolver, type TargetResolver } from './internal/resolver/index.js';
import { registerSessionSweeper, type SweeperHandle } from './internal/sweeper.js';

declare module 'fastify' {
  interface FastifyInstance {
    sessionsModule: SessionsModule;
    /**
     * NL target resolver. Plan 34-02 decorated with a throw-stub; Plan 34-03
     * (this file) replaces with the factory-built real resolver — either
     * pure MaestroAiResolver or FallbackResolver(Maestro + Claude) depending
     * on SESSION_RESOLVER env. Tests inject a different resolver into the
     * ActionContext bundle directly without touching fastify.
     */
    sessionsResolver: TargetResolver;
  }
}

export default fp(
  async (fastify: FastifyInstance) => {
    const logger = fastify.log as unknown as pino.Logger;

    const sessionsModule = createSessionsModule({
      fastify,
      db: fastify.db,
      logger,
    });

    fastify.decorate('sessionsModule', sessionsModule);

    // Plan 34-03 — build the real NL resolver via the factory. Reads
    // SESSION_RESOLVER env once at boot. Pure MaestroAiResolver by default;
    // FallbackResolver(Maestro + Claude) when SESSION_RESOLVER=claude-vision.
    const sessionsResolver = createResolver({ logger });
    fastify.decorate('sessionsResolver', sessionsResolver);

    await registerSessionRoutes({
      fastify,
      sessionsModule,
      logger,
    });

    // Plan 34-02 — register WS upgrade route on the same plugin so the deps
    // array stays unified. websocket-plugin (server/streaming/plugin.ts) must
    // register first so @fastify/websocket is already loaded.
    await registerSessionWebSocket({
      fastify,
      sessionsModule,
      authService: fastify.authService,
      db: fastify.db,
      logger,
    });

    // Plan 34-04 — register the pg-boss-driven TTL sweeper. Strategy resolves
    // at boot (6-field cron preferred; 5-field + 30s interval fallback). The
    // chosen path is logged + surfaced via the handle for shutdown cleanup.
    let sweeperHandle: SweeperHandle | null = null;
    sweeperHandle = await registerSessionSweeper({
      fastify,
      sessionsModule,
      logger,
    });
    fastify.log.info(
      { strategy: sweeperHandle.strategy },
      'Sessions sweeper registered',
    );

    // Plan 34-04 — wire cross-module subscribers (device.health.failed) once
    // the pool plugin's `poolModule.bus` decorator is guaranteed available.
    fastify.addHook('onReady', async () => {
      await sessionsModule.registerSubscribers();
    });

    fastify.addHook('onClose', async () => {
      if (sweeperHandle?.intervalHandle) clearInterval(sweeperHandle.intervalHandle);
      await sessionsModule.shutdown();
    });

    fastify.log.info('Sessions plugin registered (REST + WS + sweeper)');
  },
  {
    name: 'sessions',
    dependencies: ['config', 'db', 'event-bus', 'queue', 'pool-plugin', 'auth', 'websocket-plugin'],
  },
);
