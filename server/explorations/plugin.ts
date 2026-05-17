/**
 * Explorations plugin — thin Fastify wirer (Phase 35 Plan 35-01).
 *
 * Constructs the explorations module via createExplorationsModule, decorates
 * fastify.explorationsModule, registers REST routes, hooks onClose →
 * module.shutdown().
 *
 * Dependencies (5 entries):
 *   - config:    fastify.config
 *   - db:        fastify.db (explorations INSERT/SELECT + events persist)
 *   - event-bus: per-module TypedBus<ExplorationsRegistry>
 *   - queue:     fastify.boss (enqueueRun → boss.send)
 *   - auth:      fastify.authService (requireAuth gate)
 *
 * 'sessions' / 'pool-plugin' are NOT listed because:
 *   - Phase 34 sessions module is OPTIONAL — routes fall back to direct pool
 *     allocation when fastify.sessionsModule is missing.
 *   - pool-plugin is registered earlier in server/index.ts; defensive
 *     `if ('sessionsModule' in fastify)` keeps this plugin loadable in test
 *     builds that omit either dep.
 */
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type pino from 'pino';
import websocket from '@fastify/websocket';

import { createExplorationsModule, type ExplorationsModule } from './internal/module.js';
import { registerExplorationRoutes } from './internal/routes.js';
import { registerExplorationEventsWs } from './internal/events-ws.js';
import { readFile } from 'node:fs/promises';

declare module 'fastify' {
  interface FastifyInstance {
    explorationsModule: ExplorationsModule;
  }
}

export default fp(
  async (fastify: FastifyInstance) => {
    const logger = fastify.log as unknown as pino.Logger;

    const explorationsModule = createExplorationsModule({ fastify, logger });
    fastify.decorate('explorationsModule', explorationsModule);

    // Plan 35-03 originally registered @fastify/websocket here as a fallback
    // because the explorations plugin sat before websocketPlugin. After
    // server/index.ts was reordered (websocketPlugin → sessions → explorations),
    // the websocket plugin is already present and re-registering it throws
    // "decorator 'ws' has already been added". websocket-plugin is now a
    // declared dependency below.

    await registerExplorationRoutes({ fastify, logger });
    await registerExplorationEventsWs({ fastify, logger });

    // Plan 35-03 — register bus → broadcaster subscribers. Safe to call
    // at plugin-body time (subscribers attach to the per-module bus
    // immediately; do NOT depend on any external module surface). Kept
    // here (not deferred to onReady) so unit tests that fire emit.* before
    // app.ready() still see frames replayed via the broadcaster.
    explorationsModule.registerSubscribers();

    // Plan 35-02 — register the exploration.run worker after all plugins
    // have decorated their surfaces (boss in particular). The runner needs
    // db, emit, loadArtifact, serverUrl, sessionToken — derived from fastify.
    fastify.addHook('onReady', async () => {
      const config = (fastify as unknown as {
        config?: { server?: { host?: string; port?: number } };
      }).config;
      const host = config?.server?.host ?? '0.0.0.0';
      const port = config?.server?.port ?? 3000;
      const serverUrl = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;

      // Artifact loader — read screenshot artifact buffer by id. Reads the
      // filePath off the artifacts row. Falls back to a stub when the
      // artifacts module is not decorated (tests + dev builds without
      // artifacts plugin).
      const loadArtifact = async (artifactId: string): Promise<Buffer> => {
        const rows = await fastify.db
          .select({ filePath: (await import('../db/schema.js')).artifacts.filePath })
          .from((await import('../db/schema.js')).artifacts)
          .where(
            (await import('drizzle-orm')).eq(
              (await import('../db/schema.js')).artifacts.id,
              artifactId,
            ),
          )
          .limit(1);
        const row = rows[0];
        if (!row?.filePath) {
          throw new Error(`Artifact ${artifactId} not found or has no filePath`);
        }
        return readFile(row.filePath);
      };

      await explorationsModule.registerWorker({
        db: fastify.db,
        emit: explorationsModule.emit,
        loadArtifact,
        serverUrl,
        sessionToken: '', // session token is sourced per-run; runner uses run.sessionId
        logger,
      });
    });

    fastify.addHook('onClose', async () => {
      await explorationsModule.shutdown();
    });

    fastify.log.info('Explorations plugin registered (POST/GET/DELETE /api/explorations)');
  },
  {
    name: 'explorations',
    dependencies: ['config', 'db', 'event-bus', 'queue', 'auth', 'websocket-plugin'],
  },
);
