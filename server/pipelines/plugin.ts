/**
 * Pipelines plugin — thin factory wirer (Phase 25 Plan 25-03).
 *
 * Replaces the pre-rewrite plugin body. New shape:
 *   - Calls createPipelinesModule(deps) — factory in internal/module.ts.
 *   - Decorates fastify.pipelinesModule (NEW canonical surface) +
 *     5 back-compat decorators (pipelineService/pipelineBroadcaster/
 *     secretsService/gitService/pipelineScheduler) — preserves existing
 *     route + test imports.
 *   - Registers routes via fastify.register(pipelineRoutes).
 *   - Defers stage-advancement subscriber wiring to onReady (Pitfall 5).
 *   - Calls module.shutdown on onClose (idempotent).
 *
 * Plugin name 'pipelines-plugin' PRESERVED for back-compat (server/index.ts +
 * plugin-order.spec).
 */
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type pino from 'pino';
import { eq } from 'drizzle-orm';
import { createPipelinesModule, type PipelinesModule } from './internal/module.js';
import type { PipelineService } from './internal/service.js';
import type { PipelineBroadcaster } from './internal/broadcaster.js';
import type { SecretsService } from './internal/secrets.js';
import type { GitService } from './internal/git-service.js';
import type { PipelineScheduler } from './internal/scheduler.js';
import { pipelineRoutes } from './internal/routes.js';
import { recoverOrphans } from './internal/orphan-recovery.js';
import * as schema from '../db/schema.js';

declare module 'fastify' {
  interface FastifyInstance {
    pipelinesModule: PipelinesModule;
    // Back-compat decorators — point to module.* fields. Existing callers
    // (routes, tests, server-side imports) continue to compile.
    pipelineService: PipelineService;
    pipelineBroadcaster: PipelineBroadcaster;
    secretsService: SecretsService;
    gitService: GitService;
    pipelineScheduler: PipelineScheduler;
  }
}

async function pipelinesPlugin(fastify: FastifyInstance): Promise<void> {
  const module = createPipelinesModule({
    fastify,
    db: fastify.db,
    boss: fastify.boss,
    logger: fastify.log as unknown as pino.Logger,
    jobsModule: fastify.jobsModule,
  });

  fastify.decorate('pipelinesModule', module);
  // Back-compat decorators (5 entries — preserves existing imports)
  fastify.decorate('pipelineService', module.service);
  fastify.decorate('pipelineBroadcaster', module.broadcaster);
  fastify.decorate('secretsService', module.secretsService);
  fastify.decorate('gitService', module.gitService);
  fastify.decorate('pipelineScheduler', module.scheduler);

  await fastify.register(pipelineRoutes);

  fastify.get<{ Params: { id: string } }>(
    '/ws/pipeline-runs/:id',
    { websocket: true },
    (socket, request) => {
      const runId = (request.params as { id: string }).id;
      module.broadcaster.subscribe(runId, socket);
      socket.on('close', () => module.broadcaster.unsubscribe(runId, socket));
      socket.on('error', () => module.broadcaster.unsubscribe(runId, socket));
    },
  );

  await module.registerWorkersAndSubscribers();

  fastify.addHook('onReady', async () => {
    await recoverOrphans({
      db: fastify.db,
      retryRun: async (origin) => {
        if (!fastify.azureModule) return origin.runId;

        // Fetch the original run to find which integration it belonged to.
        const [row] = await fastify.db
          .select()
          .from(schema.pipelineRuns)
          .where(eq(schema.pipelineRuns.id, origin.runId))
          .limit(1);
        if (!row?.azurePrIntegrationId) return origin.runId;

        const integration = fastify.azureModule.integrations.find(
          (i) => i.id === row.azurePrIntegrationId,
        );
        if (!integration) return origin.runId;

        // MVP best-effort: repoId UUID is not stored on the run — cannot re-dispatch
        // through the Azure REST API without it. Skip retry; cancellation stands.
        // Tracked as a follow-up: add repo_id to pipeline_runs or pr_integrations config.
        fastify.log.warn(
          { runId: origin.runId, prId: origin.prId },
          'orphan retry skipped: repoId not stored (Task 17 MVP limitation)',
        );
        return origin.runId;
      },
      commentRetry: async (prId, runId) => {
        if (!fastify.azureModule) return;
        try {
          await fastify.azureModule.commenter.upsert({
            repoId: '',  // commenter uses lookupCommentRef to find existing thread by prId
            prId: Number(prId),
            runId,
            status: 'cancelled',
            suites: [],
            commit: '',
            startedAt: new Date(),
          });
        } catch (err) {
          fastify.log.error({ err, prId, runId }, 'orphan-recovery comment failed');
        }
      },
      logger: fastify.log as unknown as import('pino').Logger,
    });
  });

  fastify.addHook('onClose', async () => {
    await module.shutdown();
  });

  fastify.log.info('Pipelines plugin registered (Phase 25)');
}

export default fp(pipelinesPlugin, {
  name: 'pipelines-plugin',
  dependencies: ['config', 'db', 'queue', 'event-bus', 'websocket-plugin', 'job-plugin'],
});
