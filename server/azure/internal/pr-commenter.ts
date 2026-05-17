import type pino from 'pino';
import type { AzureClient } from './azure-client.js';

export type RunStatus = 'running' | 'passed' | 'failed' | 'cancelled';

export interface CommentRef {
  threadId: string;
  commentId: string;
}

export interface UpsertOpts {
  organization: string;
  project: string;
  repoId: string;
  prId: number;
  runId: string;
  status: RunStatus;
  suites: string[];
  commit: string;
  startedAt: Date;
}

export interface PrCommenter {
  upsert(opts: UpsertOpts): Promise<void>;
}

export interface CreatePrCommenterOpts {
  client: AzureClient;
  lookupCommentRef(prId: string): CommentRef | null | Promise<CommentRef | null>;
  saveCommentRef(prId: string, ref: CommentRef): void | Promise<void>;
  baseUrl: string;
  logger: pino.Logger;
}

const EMOJI: Record<RunStatus, string> = {
  running: '⏳',
  passed: '✅',
  failed: '❌',
  cancelled: '⚠️',
};

function render(opts: UpsertOpts, baseUrl: string): string {
  return [
    `### Device Farm — ${EMOJI[opts.status]}`,
    '',
    `**Status:** ${opts.status}`,
    `**Run:** [#${opts.runId}](${baseUrl}/pipeline-runs/${opts.runId})`,
    `**Commit:** \`${opts.commit.slice(0, 7)}\``,
    `**Suites:** ${opts.suites.join(', ')}`,
  ].join('\n');
}

export function createPrCommenter(deps: CreatePrCommenterOpts): PrCommenter {
  const log = deps.logger.child({ component: 'pr-commenter' });
  return {
    async upsert(opts) {
      const body = render(opts, deps.baseUrl);
      const key = String(opts.prId);
      const existing = await deps.lookupCommentRef(key);

      if (existing) {
        await deps.client.updateComment(
          opts.organization, opts.project, opts.repoId, opts.prId, existing.threadId, existing.commentId, body,
        );
        log.info({ prId: opts.prId, threadId: existing.threadId, status: opts.status }, 'pr comment updated');
      } else {
        const ref = await deps.client.createThread(opts.organization, opts.project, opts.repoId, opts.prId, body);
        await deps.saveCommentRef(key, ref);
        log.info({ prId: opts.prId, threadId: ref.threadId, status: opts.status }, 'pr comment created');
      }
    },
  };
}
