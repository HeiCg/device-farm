/**
 * Phase 37 Plan 37-03 Track C — GitHub PR run service.
 *
 * Mirrors server/azure/internal/pr-run-service.ts shape but uses the GitHub
 * config + installation_id semantics. Looks up the pipeline by name from the
 * installations config, triggers a run, then writes the github_pr_* columns
 * directly via Drizzle (no schema-extension on pipelineService needed —
 * keeps Track C minimal-blast-radius on the shared service code).
 */

import type { FastifyInstance } from 'fastify';
import type pino from 'pino';
import { eq } from 'drizzle-orm';
import { ConcurrencyDeferredError } from '../../../pipelines/index.js';
import * as schema from '../../../db/schema.js';
import type { PrTriggerRequest } from './webhook-handler.js';

export interface GithubPrIntegration {
  repo_owner: string;
  repo_name: string;
  installation_id: number;
  pipeline_name: string;
}

export interface PrRunServiceDeps {
  fastify: FastifyInstance;
  integrations: GithubPrIntegration[];
  logger: pino.Logger;
}

export interface PrRunService {
  triggerRun(req: PrTriggerRequest): Promise<{ runId: string }>;
}

export function createGithubPrRunService(deps: PrRunServiceDeps): PrRunService {
  const log = deps.logger.child({ component: 'github-pr-run-service' });
  const inFlight = new Map<string, Promise<{ runId: string }>>();

  function findIntegration(req: PrTriggerRequest): GithubPrIntegration | undefined {
    return deps.integrations.find(
      (i) =>
        i.repo_owner === req.owner &&
        i.repo_name === req.repo &&
        i.installation_id === req.installationId,
    );
  }

  async function doTrigger(req: PrTriggerRequest): Promise<{ runId: string }> {
    const integration = findIntegration(req);
    if (!integration) {
      log.warn({
        owner: req.owner,
        repo: req.repo,
        installationId: req.installationId,
      }, 'github pr: no matching integration in config, skipping');
      throw new Error(`no github integration configured for ${req.owner}/${req.repo} installation ${req.installationId}`);
    }

    const pipeline = await deps.fastify.pipelineService
      .getByName(integration.pipeline_name)
      .catch(() => null);
    if (!pipeline) {
      throw new Error(`github pr: pipeline '${integration.pipeline_name}' not found`);
    }

    try {
      // triggerType 'manual' avoids touching the pipeline_trigger_type enum
      // (which would require a DB migration). github-specific context is
      // captured via the github_pr_* columns we write directly below.
      const runId = await deps.fastify.pipelineService.triggerRun(
        pipeline.id,
        'manual',
        {
          branch: req.headRef,
          commit_sha: req.headSha,
          github_pr_number: String(req.prNumber),
          github_pr_url: req.prUrl,
          github_action: req.action,
        },
      );

      await deps.fastify.db
        .update(schema.pipelineRuns)
        .set({
          githubPrId: String(req.prNumber),
          githubPrUrl: req.prUrl,
          githubInstallationId: req.installationId,
          githubRepoOwner: req.owner,
          githubRepoName: req.repo,
          sourceBranch: req.headRef,
          sourceCommit: req.headSha,
        })
        .where(eq(schema.pipelineRuns.id, runId));

      log.info({ runId, prNumber: req.prNumber }, 'github pr run dispatched');
      return { runId };
    } catch (err) {
      if (err instanceof ConcurrencyDeferredError) {
        log.warn({ prNumber: req.prNumber }, 'github pr run deferred: concurrency cap');
      }
      throw err;
    }
  }

  return {
    async triggerRun(req) {
      const key = `${req.installationId}:${req.owner}/${req.repo}:${req.prNumber}`;
      const existing = inFlight.get(key);
      if (existing) {
        log.info({ key }, 'duplicate github trigger collapsed to in-flight run');
        return existing;
      }
      const p = doTrigger(req).finally(() => inFlight.delete(key));
      inFlight.set(key, p);
      return p;
    },
  };
}
