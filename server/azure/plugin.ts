import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type pino from 'pino';
import { eq } from 'drizzle-orm';
import { createAzureModule, type AzureModule } from './internal/module.js';
import { registerAzureRoutes } from './routes.js';
import { PIPELINE_EVENT_NAMES } from '../pipelines/events.js';
import * as schema from '../db/schema.js';
import type { RunStatus } from './internal/pr-commenter.js';

declare module 'fastify' {
  interface FastifyInstance {
    azureModule: AzureModule | null;
  }
}

async function azurePlugin(fastify: FastifyInstance): Promise<void> {
  const mod = await createAzureModule({
    fastify,
    logger: fastify.log as unknown as pino.Logger,
  });
  fastify.decorate('azureModule', mod);

  if (mod) {
    registerAzureRoutes(fastify, {
      basicAuth: mod.basicAuth,
      handler: mod.handler,
      logger: fastify.log as unknown as pino.Logger,
    });
    fastify.log.info('Azure PR-bot plugin registered');

    // Wire the PR commenter into the pipelines event bus so that for every
    // run with azurePrIntegrationId != null, the commenter posts/updates the
    // PR comment on run lifecycle transitions (Critical Issue #6 fix).
    //
    // Deferred to onReady so pipelinesModule.bus is already decorated by the
    // time we subscribe (Pitfall 5 — same pattern as the stage-advancement
    // subscriber in pipelines/internal/module.ts).
    fastify.addHook('onReady', async () => {
      const bus = fastify.pipelinesModule.bus;
      const commenter = mod.commenter;
      const log = fastify.log as unknown as pino.Logger;

      /**
       * Helper: load the run row and extract PR-bot context fields stashed in
       * the variables JSONB at run-creation time by triggerRun. Returns null
       * when the run is not a PR-bot run (azurePrIntegrationId is null) or
       * when required fields are missing.
       */
      async function loadPrRunContext(runId: string): Promise<{
        organization: string;
        project: string;
        prId: number;
        repoId: string;
        projectId: string;
        suites: string[];
        commit: string;
        startedAt: Date;
      } | null> {
        const [row] = await fastify.db
          .select({
            azurePrId: schema.pipelineRuns.azurePrId,
            azurePrIntegrationId: schema.pipelineRuns.azurePrIntegrationId,
            sourceCommit: schema.pipelineRuns.sourceCommit,
            startedAt: schema.pipelineRuns.startedAt,
            variables: schema.pipelineRuns.variables,
          })
          .from(schema.pipelineRuns)
          .where(eq(schema.pipelineRuns.id, runId))
          .limit(1);

        if (!row) return null;
        // Skip non-PR-bot runs.
        if (!row.azurePrIntegrationId || !row.azurePrId) return null;

        const vars = (row.variables ?? {}) as Record<string, unknown>;
        const organization = typeof vars.__azureOrganization === 'string' ? vars.__azureOrganization : '';
        const project      = typeof vars.__azureProject      === 'string' ? vars.__azureProject      : '';
        const repoId       = typeof vars.__azureRepoId       === 'string' ? vars.__azureRepoId       : '';
        const projectId    = typeof vars.__azureProjectId    === 'string' ? vars.__azureProjectId    : '';
        const suites       = Array.isArray(vars.__azureSuites)
          ? (vars.__azureSuites as unknown[]).filter((s): s is string => typeof s === 'string')
          : [];

        if (!organization || !project || !repoId) {
          log.warn(
            { runId, organization, project, repoId },
            'azure commenter: organization/project/repoId missing from variables — skipping comment',
          );
          return null;
        }

        return {
          organization,
          project,
          prId:      Number(row.azurePrId),
          repoId,
          projectId,
          suites,
          commit:    row.sourceCommit ?? '',
          startedAt: row.startedAt ?? new Date(),
        };
      }

      /**
       * Post or update the PR comment for a given run + status.
       * Best-effort: errors are logged but not re-thrown.
       */
      async function upsertComment(runId: string, status: RunStatus): Promise<void> {
        try {
          const ctx = await loadPrRunContext(runId);
          if (!ctx) return; // not a PR-bot run — skip silently
          await commenter.upsert({ ...ctx, runId, status });
        } catch (err) {
          log.error({ err, runId, status }, 'azure commenter: upsert failed');
        }
      }

      // pipeline.run.started → status: 'running'
      bus.on(PIPELINE_EVENT_NAMES.RUN_STARTED, (payload) => {
        void upsertComment(payload.runId, 'running');
      });

      // pipeline.run.completed → status derived from payload.status
      bus.on(PIPELINE_EVENT_NAMES.RUN_COMPLETED, (payload) => {
        // Map pipeline terminal statuses to commenter RunStatus.
        const status: RunStatus = payload.status === 'passed' ? 'passed'
          : payload.status === 'cancelled' ? 'cancelled'
          : 'failed';
        void upsertComment(payload.runId, status);
      });

      // pipeline.run.failed → status: 'failed' or 'cancelled' based on reason
      bus.on(PIPELINE_EVENT_NAMES.RUN_FAILED, (payload) => {
        const status: RunStatus = payload.reason === 'cancelled' ? 'cancelled' : 'failed';
        void upsertComment(payload.runId, status);
      });

      log.info('Azure PR-bot commenter wired to pipeline event bus');
    });
  }
}

export default fp(azurePlugin, {
  name: 'azure-plugin',
  dependencies: ['config', 'db', 'pipelines-plugin'],
});
