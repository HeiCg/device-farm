/**
 * Phase 37 Plan 37-03 Track C — GitHub Fastify plugin (Wave 1).
 *
 * Mirrors server/azure/plugin.ts shape:
 *   1. Construct module via factory (returns null when config absent).
 *   2. Decorate fastify.githubModule.
 *   3. If module exists: register /api/github/webhooks route + onReady-deferred
 *      bus subscriber that posts/updates PR comments on pipeline lifecycle.
 *
 * onReady deferral mirrors the Azure pattern (server/azure/plugin.ts:39-141)
 * so fastify.pipelinesModule.bus is decorated by the time we subscribe.
 *
 * Comment posting is best-effort: errors are logged but never re-thrown so
 * a flaky GitHub does not break unrelated pipeline subscribers.
 */

import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type pino from 'pino';
import { eq } from 'drizzle-orm';
import { createGithubModule, type GithubModule } from './internal/module.js';
import { registerGithubRoutes } from './routes.js';
import { PIPELINE_EVENT_NAMES } from '../../pipelines/events.js';
import * as schema from '../../db/schema.js';
import type { RunStatus } from './internal/template-builder.js';

declare module 'fastify' {
  interface FastifyInstance {
    githubModule: GithubModule | null;
  }
}

async function githubPlugin(fastify: FastifyInstance): Promise<void> {
  const mod = await createGithubModule({
    fastify,
    logger: fastify.log as unknown as pino.Logger,
  });
  fastify.decorate('githubModule', mod);

  if (!mod) {
    fastify.log.info('github plugin: module is null (config.github absent)');
    return;
  }

  registerGithubRoutes(fastify, {
    webhookSecret: mod.webhookSecret,
    handler: mod.handler,
    logger: fastify.log as unknown as pino.Logger,
  });
  fastify.log.info('GitHub PR-bot plugin registered');

  // onReady-deferred bus subscription — mirrors server/azure/plugin.ts:39-141.
  // fastify.pipelinesModule.bus is decorated by the time the hook fires.
  fastify.addHook('onReady', async () => {
    const bus = fastify.pipelinesModule.bus;
    const commenter = mod.commenter;
    const log = fastify.log as unknown as pino.Logger;

    async function loadGithubRunContext(runId: string): Promise<{
      installationId: number;
      owner: string;
      repo: string;
      prNumber: number;
    } | null> {
      const [row] = await fastify.db
        .select({
          installationId: schema.pipelineRuns.githubInstallationId,
          prId:           schema.pipelineRuns.githubPrId,
          owner:          schema.pipelineRuns.githubRepoOwner,
          repo:           schema.pipelineRuns.githubRepoName,
        })
        .from(schema.pipelineRuns)
        .where(eq(schema.pipelineRuns.id, runId))
        .limit(1);

      if (!row || !row.installationId || !row.prId || !row.owner || !row.repo) return null;
      return {
        installationId: row.installationId,
        owner: row.owner,
        repo: row.repo,
        prNumber: Number(row.prId),
      };
    }

    async function upsertComment(runId: string, status: RunStatus): Promise<void> {
      try {
        const ctx = await loadGithubRunContext(runId);
        if (!ctx) return; // non-github run — skip silently
        await commenter.upsert({
          installationId: ctx.installationId,
          owner: ctx.owner,
          repo: ctx.repo,
          prNumber: ctx.prNumber,
          status,
          jobId: runId,
          deviceLabel: 'Device Farm',
          screenshotsSignedUrls: [],
        });
      } catch (err) {
        log.error({ err, runId, status }, 'github commenter: upsert failed');
      }
    }

    bus.on(PIPELINE_EVENT_NAMES.RUN_STARTED, (payload) => {
      void upsertComment(payload.runId, 'running');
    });
    bus.on(PIPELINE_EVENT_NAMES.RUN_COMPLETED, (payload) => {
      const status: RunStatus =
        payload.status === 'passed' ? 'passed'
        : payload.status === 'cancelled' ? 'cancelled'
        : 'failed';
      void upsertComment(payload.runId, status);
    });
    bus.on(PIPELINE_EVENT_NAMES.RUN_FAILED, (payload) => {
      const status: RunStatus = payload.reason === 'cancelled' ? 'cancelled' : 'failed';
      void upsertComment(payload.runId, status);
    });

    log.info('GitHub PR-bot commenter wired to pipeline event bus');
  });
}

export default fp(githubPlugin, {
  name: 'github-plugin',
  dependencies: ['config', 'db', 'pipelines-plugin'],
});
