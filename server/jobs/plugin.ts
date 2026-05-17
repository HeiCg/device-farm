/**
 * Phase 23 Plan 23-04 — Jobs plugin (thin wirer; replaces Phase 19 plugin).
 *
 * Decorates `fastify.jobsModule` with the createJobsModule factory result.
 * Resolves DEFERRED-21 (long-standing `jobs/plugin.ts → bus/bus.ts`
 * dep-cruiser violation): this file no longer imports from bus/bus.js;
 * the bus is constructed inside the factory in `./internal/module.ts`.
 *
 * Dependencies declaration:
 *   ['config', 'db', 'queue', 'event-bus', 'pool-plugin', 'auth']
 * Removed: 'websocket-plugin' + 'artifact-plugin' + 'reporting' (subscribers
 * use bus instead of plugin deps; pool-plugin retained for fastify.pool).
 * Added: 'queue' (job.execute queue), 'event-bus' (jobsModule.bus mutual),
 * 'auth' (drain endpoint authentication — see Plan 23-05).
 *
 * Plugin name STAYS 'job-plugin' for back-compat with 12 plugin dependency
 * declarations across the codebase.
 *
 * Back-compat: also decorates fastify.jobService with a thin JobService shim
 * (delegates to fastify.jobsModule.enqueueJob). Existing route handlers in
 * server/api/routes.ts and server/pipelines/service.ts continue to call
 * fastify.jobService.createJob/cancelJob/getQueueDepth without changes.
 */
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type pino from 'pino';

import { createJobsModule, type JobsModule } from './internal/module.js';
import { JobService } from './job-service.js';
import { registerSessionBroadcastRoute } from '../api/sessions.js';

declare module 'fastify' {
  interface FastifyInstance {
    jobsModule: JobsModule;
    jobService: JobService; // Back-compat shim — Phase 24+ may delete
  }
}

export default fp(
  async (fastify: FastifyInstance) => {
    const logger = fastify.log as unknown as pino.Logger;

    const jobsModule = createJobsModule({
      fastify,
      db: fastify.db,
      config: fastify.config,
      logger,
    });

    fastify.decorate('jobsModule', jobsModule);

    // Back-compat: existing routes/tests use fastify.jobService — shim delegates
    // to jobsModule + does the DB inserts (jobs row, jobFiles).
    const jobService = new JobService(fastify);
    fastify.decorate('jobService', jobService);

    await jobsModule.registerWorkerAndSubscribers();

    // Phase 37 Plan 37-04 Wave 1 Track D — wire the session-broadcast REST
    // route so the InputBroadcaster (decorated on jobsModule.broadcaster) is
    // reachable at POST /api/sessions/broadcast on the running server. The
    // route is mounted directly on the fastify instance (no /api prefix —
    // the registrar declares the full path) so a vanilla test harness can
    // assert reachability without registering the api plugin scope.
    registerSessionBroadcastRoute(fastify, { broadcaster: jobsModule.broadcaster });

    fastify.addHook('onClose', async () => {
      await jobsModule.shutdown();
    });

    fastify.log.info(
      'Job plugin registered (Phase 23 — full MOD-06 factory shape; DEFERRED-21 cleared)',
    );
  },
  {
    name: 'job-plugin',
    dependencies: ['config', 'db', 'queue', 'event-bus', 'pool-plugin', 'auth'],
  },
);
