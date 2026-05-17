import type pino from 'pino';
import { buildPipelineYaml } from './template-builder.js';
import type { PrTriggerRequest } from './webhook-handler.js';
import { ConcurrencyDeferredError } from '../../pipelines/index.js';

export interface PrRunServiceConfig {
  /** Azure DevOps PAT — sourced from fastify.config.azure_devops.pat. */
  pat: string;
}

export interface PrRunServiceDeps {
  upsertPipeline(input: { name: string; yaml: string }): Promise<{ id: string }>;
  cancelRunsByPrId(prId: string, reason: string): Promise<number>;
  createRun(input: {
    pipelineId: string;
    triggerType: 'azure-pr';
    prId: string;
    prUrl: string;
    sourceBranch: string;
    sourceCommit: string;
    integrationId: string;
    /** Azure DevOps organization (from parsed repo URL). */
    organization: string;
    /** Azure DevOps project (from parsed repo URL). */
    project: string;
    /** Azure DevOps repository UUID from webhook payload. */
    repoId: string;
    projectId: string;
    /** PR-bot context — account (from device-script block) + PAT (from server config). */
    account: string;
    pat: string;
    /** Suite names from the parsed device-script block. */
    suites: string[];
  }): Promise<{ runId: string }>;
  logger: pino.Logger;
}

export type PrRunResult =
  | { kind: 'dispatched'; runId: string }
  | { kind: 'deferred' };

export interface PrRunService {
  triggerRun(req: PrTriggerRequest): Promise<PrRunResult>;
}

export function createPrRunService(deps: PrRunServiceDeps & { config: PrRunServiceConfig }): PrRunService {
  const inFlight = new Map<string, Promise<{ runId: string }>>();
  const log = deps.logger.child({ component: 'pr-run-service' });

  async function doTrigger(req: PrTriggerRequest): Promise<PrRunResult> {
    const pipelineName = `pr-${req.integration.id}-${req.prId}`;
    const yaml = buildPipelineYaml(req.block, req.integration, {
      prId: req.prId,
      sourceRefName: req.sourceRefName,
      commit: req.commit,
    });
    const pipeline = await deps.upsertPipeline({ name: pipelineName, yaml });

    const cancelled = await deps.cancelRunsByPrId(String(req.prId), 'cancelled: new push to PR');
    if (cancelled > 0) {
      log.info({ prId: req.prId, cancelled }, 'cancelled prior runs');
    }

    const prUrl = `${req.integration.repo_url}/pullrequest/${req.prId}`;
    try {
      const r = await deps.createRun({
        pipelineId: pipeline.id,
        triggerType: 'azure-pr',
        prId: String(req.prId),
        prUrl,
        sourceBranch: req.sourceRefName.replace(/^refs\/heads\//, ''),
        sourceCommit: req.commit,
        integrationId: req.integration.id,
        organization: req.organization,
        project: req.project,
        repoId: req.repoId,
        projectId: req.projectId,
        account: req.block.account,
        pat: deps.config.pat,
        suites: req.block.suite,
      });
      return { kind: 'dispatched', runId: r.runId };
    } catch (err) {
      if (err instanceof ConcurrencyDeferredError) {
        log.warn({ prId: req.prId }, 'pr-bot run deferred: concurrency cap');
        return { kind: 'deferred' };
      }
      throw err;
    }
  }

  return {
    async triggerRun(req) {
      const key = `${req.integration.id}:${req.prId}`;
      const existing = inFlight.get(key);
      if (existing) {
        log.info({ key }, 'duplicate trigger collapsed to in-flight run');
        return existing;
      }
      const p = doTrigger(req).finally(() => inFlight.delete(key));
      inFlight.set(key, p);
      return p;
    },
  };
}
