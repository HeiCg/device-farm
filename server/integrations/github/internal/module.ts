/**
 * Phase 37 Plan 37-03 Track C — GitHub PR-bot module factory.
 *
 * Mirrors server/azure/internal/module.ts:23-141 shape — returns `null` when
 * `config.github` is absent (Wave 0 default), constructs the full module when
 * present. The returned shape is consumed by:
 *   - server/integrations/github/plugin.ts (registers routes + bus subscribers)
 *   - server/integrations/github/routes.ts (uses webhookSecret + handler)
 */

import type { FastifyInstance } from 'fastify';
import type pino from 'pino';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { App } from '@octokit/app';
import { createGithubApp, getInstallationOctokit } from './app-auth.js';
import { createGithubCommenter, type GithubCommenter } from './commenter.js';
import { createGithubWebhookHandler, type GithubWebhookHandler } from './webhook-handler.js';
import { createGithubPrRunService, type GithubPrIntegration } from './pr-run-service.js';
import * as schema from '../../../db/schema.js';

export interface GithubModuleDeps {
  fastify: FastifyInstance;
  logger: pino.Logger;
}

export interface GithubModule {
  webhookSecret: string;
  handler: GithubWebhookHandler;
  commenter: GithubCommenter;
  app: App;
  integrations: GithubPrIntegration[];
}

export async function createGithubModule(
  deps: GithubModuleDeps,
): Promise<GithubModule | null> {
  const cfg = deps.fastify.config.github;
  if (!cfg) {
    deps.logger.info('github config absent — PR-bot disabled');
    return null;
  }

  const app = createGithubApp({
    appId: cfg.app_id,
    privateKey: cfg.private_key,
    webhookSecret: cfg.webhook_secret,
  });

  const serverHost = deps.fastify.config.server.host === '0.0.0.0'
    ? 'localhost'
    : deps.fastify.config.server.host;
  const baseUrl = `http://${serverHost}:${deps.fastify.config.server.port}`;

  const commenter = createGithubCommenter({
    getOctokitForInstallation: (installationId) => getInstallationOctokit(app, installationId),
    lookupCommentId: async ({ installationId, prNumber }) => {
      const [row] = await deps.fastify.db
        .select({ ref: schema.pipelineRuns.githubPrCommentId })
        .from(schema.pipelineRuns)
        .where(and(
          eq(schema.pipelineRuns.githubInstallationId, installationId),
          eq(schema.pipelineRuns.githubPrId, String(prNumber)),
          isNotNull(schema.pipelineRuns.githubPrCommentId),
        ))
        .orderBy(desc(schema.pipelineRuns.startedAt))
        .limit(1);
      const ref = row?.ref;
      if (!ref) return null;
      const parsed = Number(ref);
      if (!Number.isFinite(parsed)) return null;
      return { commentId: parsed };
    },
    saveCommentId: async ({ installationId, prNumber, commentId }) => {
      await deps.fastify.db
        .update(schema.pipelineRuns)
        .set({ githubPrCommentId: String(commentId) })
        .where(and(
          eq(schema.pipelineRuns.githubInstallationId, installationId),
          eq(schema.pipelineRuns.githubPrId, String(prNumber)),
          isNull(schema.pipelineRuns.githubPrCommentId),
        ));
    },
    baseUrl,
    logger: deps.logger,
  });

  const prRunService = createGithubPrRunService({
    fastify: deps.fastify,
    integrations: cfg.pr_integrations,
    logger: deps.logger,
  });

  const handler = createGithubWebhookHandler({
    triggerRun: (req) => prRunService.triggerRun(req),
    logger: deps.logger,
  });

  return {
    webhookSecret: cfg.webhook_secret,
    handler,
    commenter,
    app,
    integrations: cfg.pr_integrations,
  };
}
