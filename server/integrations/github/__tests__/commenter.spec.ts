/**
 * Phase 37 Plan 37-03 Track C — commenter spec.
 *
 * Covers POST (create) vs PATCH (idempotent edit) branch based on
 * lookupCommentId result.
 */

import { describe, it, expect, vi } from 'vitest';
import { createGithubCommenter } from '../internal/commenter.js';

const fakeLogger: any = { info: () => {}, warn: () => {}, error: () => {}, child: () => fakeLogger };

function makeOctokit(createResponseId = 12345) {
  const requestSpy = vi.fn().mockImplementation(async (route: string) => {
    if (route.startsWith('POST')) {
      return { data: { id: createResponseId } };
    }
    return { data: {} };
  });
  return { request: requestSpy } as unknown as Awaited<ReturnType<typeof import('../internal/app-auth.js').getInstallationOctokit>>;
}

describe('github commenter', () => {
  it('creates new comment when github_pr_comment_id is null (POST + persist)', async () => {
    const octokit = makeOctokit(42);
    const requestSpy = (octokit as unknown as { request: ReturnType<typeof vi.fn> }).request;

    const saveSpy = vi.fn().mockResolvedValue(undefined);
    const commenter = createGithubCommenter({
      getOctokitForInstallation: async () => octokit,
      lookupCommentId: async () => null,
      saveCommentId: saveSpy,
      baseUrl: 'https://df.local',
      logger: fakeLogger,
    });

    await commenter.upsert({
      installationId: 100,
      owner: 'octo',
      repo: 'demo',
      prNumber: 7,
      status: 'running',
      jobId: 'job-abc',
      deviceLabel: 'Pixel 7',
      screenshotsSignedUrls: [],
    });

    expect(requestSpy).toHaveBeenCalledOnce();
    const [route, params] = requestSpy.mock.calls[0];
    expect(route).toBe('POST /repos/{owner}/{repo}/issues/{issue_number}/comments');
    expect(params).toMatchObject({ owner: 'octo', repo: 'demo', issue_number: 7 });
    expect(saveSpy).toHaveBeenCalledWith({ installationId: 100, prNumber: 7, commentId: 42 });
  });

  it('edits existing comment when github_pr_comment_id is present (PATCH)', async () => {
    const octokit = makeOctokit();
    const requestSpy = (octokit as unknown as { request: ReturnType<typeof vi.fn> }).request;

    const commenter = createGithubCommenter({
      getOctokitForInstallation: async () => octokit,
      lookupCommentId: async () => ({ commentId: 4242 }),
      saveCommentId: vi.fn().mockResolvedValue(undefined),
      baseUrl: 'https://df.local',
      logger: fakeLogger,
    });

    await commenter.upsert({
      installationId: 100,
      owner: 'octo',
      repo: 'demo',
      prNumber: 7,
      status: 'passed',
      jobId: 'job-abc',
      deviceLabel: 'Pixel 7',
      screenshotsSignedUrls: [],
    });

    expect(requestSpy).toHaveBeenCalledOnce();
    const [route, params] = requestSpy.mock.calls[0];
    expect(route).toBe('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}');
    expect(params).toMatchObject({ owner: 'octo', repo: 'demo', comment_id: 4242 });
    expect(params.body).toContain('✅');
  });

  it('uses installation-specific octokit (fetched per upsert call)', async () => {
    const getOcto = vi.fn().mockImplementation(async () => makeOctokit());
    const commenter = createGithubCommenter({
      getOctokitForInstallation: getOcto,
      lookupCommentId: async () => null,
      saveCommentId: vi.fn().mockResolvedValue(undefined),
      baseUrl: 'https://df.local',
      logger: fakeLogger,
    });

    await commenter.upsert({
      installationId: 555,
      owner: 'a',
      repo: 'b',
      prNumber: 1,
      status: 'running',
      jobId: 'j',
      deviceLabel: 'd',
      screenshotsSignedUrls: [],
    });

    expect(getOcto).toHaveBeenCalledWith(555);
  });
});
