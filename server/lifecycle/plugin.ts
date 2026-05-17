/**
 * Phase 18 / Plan 18-03 — Lifecycle plugin (thin Fastify wrapper).
 *
 * Responsibilities:
 *   1. Call createLifecycleModule({fastify, db, config, logger}) to build the module.
 *   2. Decorate:
 *        - fastify.lifecycleStats — stats ref (back-compat for server/api/routes.ts:439 /health).
 *        - fastify.lifecycleModule — the full LifecycleModule (new barrel surface).
 *   3. Call module.registerSchedulesAndWorkers() to register the 3 pg-boss schedules + workers.
 *   4. Wire onClose → module.shutdown() (idempotent; boss.offWork per worker id).
 *
 * Dependencies (pinned per RESEARCH §Factory Design):
 *   - config (for fastify.config + AppConfig)
 *   - db (for drizzle INSERTs from persistEnvelope middleware)
 *   - queue (fastify.boss + fastify.queue)
 *   - event-bus (side-channel <type>.envelope events feed into onPersisted subscribers)
 *
 * Plugin NAME stays 'lifecycle-plugin' (unchanged from v2.0) so downstream plugins'
 * `dependencies: ['lifecycle-plugin']` declarations keep resolving — Phase 17 Plan 17-07
 * added that exact string to api/plugin.ts for the /health endpoint dep-graph.
 */
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type pino from 'pino';

import { createLifecycleModule, type LifecycleModule } from './internal/module.js';
import type { LifecycleStats } from './stats.js';

declare module 'fastify' {
  interface FastifyInstance {
    lifecycleStats: LifecycleStats;
    lifecycleModule: LifecycleModule;
  }
}

async function lifecyclePlugin(fastify: FastifyInstance): Promise<void> {
  const module = createLifecycleModule({
    fastify,
    db: fastify.db,
    config: fastify.config,
    logger: fastify.log as unknown as pino.Logger,
  });

  fastify.decorate('lifecycleStats', module.stats);
  fastify.decorate('lifecycleModule', module);

  await module.registerSchedulesAndWorkers();

  fastify.addHook('onClose', async () => {
    await module.shutdown();
  });

  fastify.log.info('Lifecycle plugin registered: 3 pg-boss schedules (compress/retention daily, disk hourly)');
}

export default fp(lifecyclePlugin, {
  name: 'lifecycle-plugin',
  dependencies: ['config', 'db', 'queue', 'event-bus'],
});
