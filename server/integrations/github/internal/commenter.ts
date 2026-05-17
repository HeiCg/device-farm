/**
 * Phase 37 Plan 37-03 Track C — GitHub PR commenter (post-or-edit).
 *
 * Mirrors server/azure/internal/pr-commenter.ts shape. Idempotent: if a
 * comment_id already exists for the (installationId, prNumber) pair, PATCH
 * it; otherwise POST a new comment and persist the returned id.
 *
 * Per-installation Octokit instances are fetched per-call (Pitfall 4 —
 * install tokens have a 1h TTL; never store across event boundaries).
 */

import type pino from 'pino';
import type { InstallationOctokit } from './app-auth.js';
import { renderComment, type RunStatus } from './template-builder.js';

export interface CommenterDeps {
  getOctokitForInstallation(installationId: number): Promise<InstallationOctokit>;
  lookupCommentId(input: { installationId: number; prNumber: number }): Promise<{ commentId: number } | null>;
  saveCommentId(input: { installationId: number; prNumber: number; commentId: number }): Promise<void>;
  baseUrl: string;
  logger: pino.Logger;
}

export interface UpsertOpts {
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
  status: RunStatus;
  jobId: string;
  deviceLabel: string;
  duration?: string;
  screenshotsSignedUrls: string[];
}

export interface GithubCommenter {
  upsert(input: UpsertOpts): Promise<void>;
}

export function createGithubCommenter(deps: CommenterDeps): GithubCommenter {
  const log = deps.logger.child({ component: 'github-commenter' });

  return {
    async upsert(input) {
      const octokit = await deps.getOctokitForInstallation(input.installationId);
      const body = renderComment({
        status: input.status,
        jobId: input.jobId,
        deviceLabel: input.deviceLabel,
        duration: input.duration,
        screenshotsSignedUrls: input.screenshotsSignedUrls,
        dashboardUrl: `${deps.baseUrl}/jobs/${input.jobId}`,
      });

      const existing = await deps.lookupCommentId({
        installationId: input.installationId,
        prNumber: input.prNumber,
      });

      if (existing) {
        // PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}
        await octokit.request('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}', {
          owner: input.owner,
          repo: input.repo,
          comment_id: existing.commentId,
          body,
        });
        log.info({
          installationId: input.installationId,
          owner: input.owner,
          repo: input.repo,
          prNumber: input.prNumber,
          commentId: existing.commentId,
          status: input.status,
        }, 'github comment updated');
      } else {
        // POST /repos/{owner}/{repo}/issues/{issue_number}/comments
        const res = await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
          owner: input.owner,
          repo: input.repo,
          issue_number: input.prNumber,
          body,
        });
        const commentId = Number((res as { data: { id: number } }).data.id);
        await deps.saveCommentId({
          installationId: input.installationId,
          prNumber: input.prNumber,
          commentId,
        });
        log.info({
          installationId: input.installationId,
          owner: input.owner,
          repo: input.repo,
          prNumber: input.prNumber,
          commentId,
          status: input.status,
        }, 'github comment created');
      }
    },
  };
}
