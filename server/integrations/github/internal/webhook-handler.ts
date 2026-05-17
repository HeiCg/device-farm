/**
 * Phase 37 Plan 37-03 Track C — GitHub webhook event dispatcher.
 *
 * Receives parsed (post-HMAC) webhook bodies and dispatches `pull_request`
 * events to the pipeline runner. Other events (push, issues, star…) are
 * ignored returning `{kind: 'ignored', reason}` so the route can still 200.
 *
 * Per the plan: only opened / synchronize / reopened trigger runs.
 */

import type pino from 'pino';
import { z } from 'zod';

export type WebhookOutcome =
  | { kind: 'triggered'; runId: string }
  | { kind: 'deferred'; message: string }
  | { kind: 'ignored'; reason: string };

export interface PrTriggerRequest {
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
  prUrl: string;
  headSha: string;
  headRef: string;
  baseRef: string;
  action: string;
}

export interface WebhookHandlerDeps {
  triggerRun(input: PrTriggerRequest): Promise<{ runId: string }>;
  logger: pino.Logger;
}

/**
 * Zod schema covering the subset of `pull_request` event fields we consume.
 * `.passthrough()` allows GitHub to add new fields without breaking parse —
 * the API is famously additive.
 */
const pullRequestEventSchema = z.object({
  action: z.string(),
  installation: z.object({
    id: z.number().int(),
  }).passthrough(),
  pull_request: z.object({
    number: z.number().int(),
    html_url: z.string().url(),
    head: z.object({
      sha: z.string(),
      ref: z.string(),
    }).passthrough(),
    base: z.object({
      ref: z.string(),
    }).passthrough(),
  }).passthrough(),
  repository: z.object({
    name: z.string(),
    owner: z.object({
      login: z.string(),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

const ACCEPTED_ACTIONS = new Set(['opened', 'synchronize', 'reopened']);

export interface GithubWebhookHandler {
  handle(event: string, body: unknown): Promise<WebhookOutcome>;
}

export function createGithubWebhookHandler(deps: WebhookHandlerDeps): GithubWebhookHandler {
  const log = deps.logger.child({ component: 'github-webhook-handler' });

  return {
    async handle(event, body) {
      if (event !== 'pull_request') {
        return { kind: 'ignored', reason: 'event-not-handled' };
      }

      const parsed = pullRequestEventSchema.safeParse(body);
      if (!parsed.success) {
        log.warn({ issues: parsed.error.issues }, 'github webhook: parse failed');
        return { kind: 'ignored', reason: 'parse-failed' };
      }
      const evt = parsed.data;

      if (!ACCEPTED_ACTIONS.has(evt.action)) {
        return { kind: 'ignored', reason: `action-${evt.action}-not-handled` };
      }

      try {
        const r = await deps.triggerRun({
          installationId: evt.installation.id,
          owner: evt.repository.owner.login,
          repo: evt.repository.name,
          prNumber: evt.pull_request.number,
          prUrl: evt.pull_request.html_url,
          headSha: evt.pull_request.head.sha,
          headRef: evt.pull_request.head.ref,
          baseRef: evt.pull_request.base.ref,
          action: evt.action,
        });
        log.info({
          installationId: evt.installation.id,
          prNumber: evt.pull_request.number,
          runId: r.runId,
        }, 'github pr run dispatched');
        return { kind: 'triggered', runId: r.runId };
      } catch (err) {
        // Surface concurrency cap as deferred (mirrors azure handler).
        const name = (err as { name?: string }).name ?? '';
        if (name === 'ConcurrencyDeferredError') {
          return { kind: 'deferred', message: 'concurrency cap reached, will retry' };
        }
        throw err;
      }
    },
  };
}
