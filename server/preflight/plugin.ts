/**
 * Phase 37 Plan 37-02 Wave 1 — preflight Fastify plugin.
 *
 * Decorates `fastify.preflightModule` with the real scanner factory and
 * registers `POST /api/preflight` + `GET /api/preflight/:id`.
 *
 * Depends on: config, db, event-bus (`bus` plugin), multipart (registered
 * in the api plugin). The plugin registration order places this AFTER
 * the bus + db plugins and BEFORE the api plugin (which registers multipart).
 *
 * NOTE on multipart: this plugin registers routes that consume multipart.
 * `@fastify/multipart` is registered inside `api/plugin.ts`. To allow the
 * preflight POST handler to call `req.file()` we need multipart to be active
 * at the time the request arrives — which holds because api/plugin.ts is
 * registered before the server begins accepting requests.
 *
 * For tests we register multipart inline (see __tests__/routes.spec.ts).
 */

import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type pino from 'pino';
import { createPreflightModule, type PreflightModule } from './internal/module.js';
import { registerPreflightRoutes } from './routes.js';

declare module 'fastify' {
  interface FastifyInstance {
    preflightModule: PreflightModule;
  }
}

async function preflightPlugin(fastify: FastifyInstance): Promise<void> {
  const mod = await createPreflightModule({
    fastify,
    logger: fastify.log as unknown as pino.Logger,
  });
  fastify.decorate('preflightModule', mod);
  registerPreflightRoutes(fastify, { module: mod });
  fastify.log.info('preflight plugin registered (/api/preflight)');
}

export default fp(preflightPlugin, {
  name: 'preflight-plugin',
  dependencies: ['config', 'db'],
});
