import type { FastifyInstance } from 'fastify';
import type pino from 'pino';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { createAzureClient, type AzureClient } from './azure-client.js';
import { createPrCommenter, type PrCommenter } from './pr-commenter.js';
import { createWebhookHandler, type IntegrationConfig } from './webhook-handler.js';
import { createPrRunService } from './pr-run-service.js';
import * as schema from '../../db/schema.js';

export interface AzureModuleDeps {
  fastify: FastifyInstance;
  logger: pino.Logger;
}

export interface AzureModule {
  handler: ReturnType<typeof createWebhookHandler>;
  basicAuth: { username: string; password: string };
  integrations: IntegrationConfig[];
  client: AzureClient;
  commenter: PrCommenter;
}

export async function createAzureModule(deps: AzureModuleDeps): Promise<AzureModule | null> {
  const cfg = deps.fastify.config.azure_devops;
  if (!cfg) {
    deps.logger.info('azure_devops config absent — PR-bot disabled');
    return null;
  }

  const client = createAzureClient({ pat: cfg.pat, logger: deps.logger });

  const serverHost = deps.fastify.config.server.host === '0.0.0.0'
    ? 'localhost'
    : deps.fastify.config.server.host;
  const baseUrl = `http://${serverHost}:${deps.fastify.config.server.port}`;

  const commenter = createPrCommenter({
    client,
    lookupCommentRef: async (prId) => {
      const rows = await deps.fastify.db
        .select({ id: schema.pipelineRuns.id, ref: schema.pipelineRuns.azurePrCommentId })
        .from(schema.pipelineRuns)
        .where(and(
          eq(schema.pipelineRuns.azurePrId, prId),
          isNotNull(schema.pipelineRuns.azurePrCommentId),
        ))
        .orderBy(desc(schema.pipelineRuns.startedAt))
        .limit(1);
      const ref = rows[0]?.ref;
      if (!ref) return null;
      const parts = ref.split(':');
      return parts.length === 2 ? { threadId: parts[0], commentId: parts[1] } : null;
    },
    saveCommentRef: async (prId, ref) => {
      await deps.fastify.db
        .update(schema.pipelineRuns)
        .set({ azurePrCommentId: `${ref.threadId}:${ref.commentId}` })
        .where(and(
          eq(schema.pipelineRuns.azurePrId, prId),
          isNull(schema.pipelineRuns.azurePrCommentId),
        ));
    },
    baseUrl,
    logger: deps.logger,
  });

  const prRunService = createPrRunService({
    config: { pat: cfg.pat },
    upsertPipeline: async ({ name, yaml }) => {
      const existing = await deps.fastify.pipelineService.getByName(name).catch(() => null);
      if (existing) {
        await deps.fastify.pipelineService.updatePipeline(existing.id, yaml);
        return { id: existing.id };
      }
      return deps.fastify.pipelineService.createPipeline(yaml);
    },
    cancelRunsByPrId: (prId, reason) =>
      deps.fastify.pipelineService.cancelRunsByPrId(prId, reason),
    createRun: async (input) => {
      // Single triggerRun call carries PR-bot context (account + PAT +
      // integrationId + repoId + projectId + suites). This avoids the race
      // where the worker started the first stage before attachPrMetadata wrote
      // integration id, and threads the PAT into the source clone (Critical
      // Issue #2 fix). repoId/projectId/suites are stashed in variables JSONB
      // so the PR-commenter bus subscriber can post/update the PR comment
      // without re-reading the webhook envelope (Critical Issue #6 fix).
      const runId = await deps.fastify.pipelineService.triggerRun(
        input.pipelineId,
        'azure-pr',
        {
          pr_number: input.prId,
          pr_url: input.prUrl,
          branch: input.sourceBranch,
          commit_sha: input.sourceCommit,
        },
        undefined,
        {
          integrationId: input.integrationId,
          pat: input.pat,
          account: input.account,
          organization: input.organization,
          project: input.project,
          repoId: input.repoId,
          projectId: input.projectId,
          suites: input.suites,
        },
      );
      // Keep attachPrMetadata for back-compat callers that don't pass context
      // through triggerRun (e.g. legacy api/manual triggers); also normalises
      // the source columns when the variables object was sparse.
      await deps.fastify.pipelineService.attachPrMetadata(runId, {
        prId: input.prId,
        prUrl: input.prUrl,
        sourceBranch: input.sourceBranch,
        sourceCommit: input.sourceCommit,
        integrationId: input.integrationId,
      });
      return { runId };
    },
    logger: deps.logger,
  });

  const handler = createWebhookHandler({
    integrations: cfg.pr_integrations,
    triggerRun: (req) => prRunService.triggerRun(req),
    postParseError: async ({ organization, project, repoId, projectId, prId, issues }) => {
      const body = `### Device Farm — ⚠️\n\nCould not parse \`device-script\` block:\n\n\`\`\`json\n${JSON.stringify(issues, null, 2)}\n\`\`\``;
      await client.createThread(organization, project, repoId, prId, body);
    },
    logger: deps.logger,
  });

  return {
    handler,
    basicAuth: cfg.webhook_basic_auth,
    integrations: cfg.pr_integrations,
    client,
    commenter,
  };
}
