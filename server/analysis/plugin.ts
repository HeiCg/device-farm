/**
 * Phase 37 Plan 37-01 — analysis Fastify plugin.
 *
 * Constructs the analysis module + registers POST/GET /api/builds/:id/skeleton.
 * Deps: config, db, event-bus.
 *
 * Mirror shape: server/explorations/plugin.ts.
 */

import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type pino from 'pino';
import { createAnalysisModule, type AnalysisModule } from './internal/module.js';
import { registerAnalysisRoutes } from './routes.js';

declare module 'fastify' {
  interface FastifyInstance {
    analysisModule: AnalysisModule;
  }
}

async function analysisPlugin(fastify: FastifyInstance): Promise<void> {
  const logger = fastify.log as unknown as pino.Logger;
  const mod = createAnalysisModule({ fastify, logger });
  fastify.decorate('analysisModule', mod);

  registerAnalysisRoutes(fastify, { module: mod, logger });

  fastify.log.info('analysis plugin registered');
}

export default fp(analysisPlugin, {
  name: 'analysis-plugin',
  dependencies: ['config', 'db', 'event-bus'],
});
