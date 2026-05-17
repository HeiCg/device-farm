/**
 * Phase 19 / Plan 19-03 — Reporting plugin (thin Fastify wrapper).
 *
 * Replaces the old imperative `server/reporting/reporting-plugin.ts` (deleted
 * by this plan). Responsibilities:
 *   1. Call createReportingModule({fastify, db, config, logger}) to build the module.
 *   2. Decorate:
 *        - fastify.webhookService  — back-compat for any pre-existing consumer
 *        - fastify.flakyDetector   — back-compat (untouched by Phase 19)
 *        - fastify.reportingModule — new barrel-friendly surface
 *   3. Call module.registerWorkersAndSubscribers() — registers main+DLQ workers
 *      and the onPersisted('job.completed') bus subscriber.
 *   4. Wire onClose → module.shutdown() (idempotent; unsubscribes bus + offWork per worker).
 *
 * Dependencies (pinned per RESEARCH §Pitfall 10):
 *   - config       (for fastify.config.webhooks)
 *   - db           (for drizzle INSERTs from persistEnvelope middleware)
 *   - queue        (fastify.boss + fastify.queue — createQueue, send, work)
 *   - event-bus    (fastify.onPersisted decorator)
 *
 * Plugin NAME stays 'reporting' (unchanged from v2.0) so downstream plugins'
 * `dependencies: ['reporting']` declarations keep resolving — server/index.ts
 * line 128 registers job-plugin after reporting, and job-plugin used to read
 * `fastify.webhookService` during JobService construction (Phase 19 Plan 19-01
 * replaced that read with jobsModule wiring; plugin name preservation is
 * defence-in-depth for any future consumers that may reach into reporting's
 * decorations).
 */
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type pino from 'pino';

import { createReportingModule, type ReportingModule } from './internal/module.js';
import { registerReportingRoutes } from './routes.js';
import type { WebhookService } from './webhook-service.js';
import type { FlakyDetector } from './flaky-detector.js';

declare module 'fastify' {
  interface FastifyInstance {
    webhookService: WebhookService;
    flakyDetector: FlakyDetector;
    reportingModule: ReportingModule;
  }
}

async function reportingPlugin(fastify: FastifyInstance): Promise<void> {
  const module = createReportingModule({
    fastify,
    db: fastify.db,
    config: fastify.config,
    logger: fastify.log as unknown as pino.Logger,
  });

  fastify.decorate('webhookService', module.webhookService);
  fastify.decorate('flakyDetector', module.flakyDetector);
  fastify.decorate('reportingModule', module);

  await module.registerWorkersAndSubscribers();

  // Phase 19 / Plan 19-05 — register GET /api/queue/dlq (QUEUE-05 endpoint).
  // Route registration happens AFTER workers+subscribers so the DLQ queue
  // exists before the route handler (findJobs on an unknown queue is fine
  // in pg-boss, but ordering keeps the boot-phase mental model tidy).
  await registerReportingRoutes(fastify);

  fastify.addHook('onClose', async () => {
    await module.shutdown();
  });

  fastify.log.info(
    'Reporting plugin registered: webhook.deliver + webhook.deliver.dlq queues + job.completed subscriber + /api/queue/dlq route',
  );
}

export default fp(reportingPlugin, {
  name: 'reporting',
  dependencies: ['config', 'db', 'queue', 'event-bus'],
});
