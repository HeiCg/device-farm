import type pino from 'pino';
import { parsePrDescription, type PrBlock } from './pr-parser.js';
import { parseAzureRepoUrl } from './azure-client.js';

export interface IntegrationConfig {
  id: string;
  repo_url: string;
  target_branch: string;
}

export interface PrTriggerRequest {
  integration: IntegrationConfig;
  prId: number;
  sourceRefName: string;
  commit: string;
  block: PrBlock;
  organization: string;
  project: string;
  repoId: string;
  projectId: string;
  projectName: string;
}

export interface WebhookDeps {
  integrations: IntegrationConfig[];
  triggerRun(req: PrTriggerRequest): Promise<{ kind: 'dispatched'; runId: string } | { kind: 'deferred' }>;
  postParseError(input: {
    organization: string; project: string; repoId: string; projectId: string; prId: number; issues: unknown;
  }): Promise<void>;
  logger: pino.Logger;
}

export type WebhookOutcome =
  | { kind: 'dispatched'; runId: string }
  | { kind: 'deferred'; message: string }
  | { kind: 'skipped'; reason: string }
  | { kind: 'parse-error' };

const ACCEPTED_EVENTS = new Set(['git.pullrequest.created', 'git.pullrequest.updated']);

export function createWebhookHandler(deps: WebhookDeps) {
  const log = deps.logger.child({ component: 'webhook-handler' });

  return {
    async handle(body: any): Promise<WebhookOutcome> {
      const eventType: string = body?.eventType;
      if (!ACCEPTED_EVENTS.has(eventType)) return { kind: 'skipped', reason: `event ${eventType}` };

      const res = body?.resource;
      if (!res) return { kind: 'skipped', reason: 'no resource' };
      if (res.isDraft === true) return { kind: 'skipped', reason: 'draft PR' };
      if (res.status && res.status !== 'active') return { kind: 'skipped', reason: `status=${res.status}` };

      const repoUrl: string = res?.repository?.url ?? '';
      const integration = deps.integrations.find((i) => i.repo_url === repoUrl);
      if (!integration) return { kind: 'skipped', reason: `no integration for ${repoUrl}` };

      const targetRef: string = res?.targetRefName ?? '';
      if (targetRef !== `refs/heads/${integration.target_branch}`) {
        return { kind: 'skipped', reason: `target branch ${targetRef}` };
      }

      const desc: string = res?.description ?? '';
      const parsed = parsePrDescription(desc);

      if (parsed.kind === 'no-block') return { kind: 'skipped', reason: 'no-block' };

      if (
        parsed.kind === 'multiple-blocks' ||
        parsed.kind === 'parse-error' ||
        parsed.kind === 'validation-error'
      ) {
        const { organization, project } = parseAzureRepoUrl(repoUrl);
        await deps.postParseError({
          organization,
          project,
          repoId: res.repository.id,
          projectId: res.repository.project.id,
          prId: res.pullRequestId,
          issues: parsed,
        });
        return { kind: 'parse-error' };
      }

      const { organization, project } = parseAzureRepoUrl(repoUrl);

      const r = await deps.triggerRun({
        integration,
        prId: res.pullRequestId,
        sourceRefName: res.sourceRefName,
        commit: res.lastMergeSourceCommit?.commitId ?? '',
        block: parsed.block,
        organization,
        project,
        repoId: res.repository.id,
        projectId: res.repository.project.id,
        projectName: res.repository.project.name,
      });
      if (r.kind === 'deferred') {
        log.warn({ prId: res.pullRequestId }, 'pr run deferred: concurrency cap');
        return { kind: 'deferred', message: 'concurrency cap reached, will retry' };
      }
      log.info({ runId: r.runId, prId: res.pullRequestId }, 'pr run dispatched');
      return { kind: 'dispatched', runId: r.runId };
    },
  };
}
