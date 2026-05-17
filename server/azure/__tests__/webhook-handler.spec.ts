import { describe, it, expect, vi } from 'vitest';
import { createWebhookHandler } from '../internal/webhook-handler.js';

const fakeLogger: any = { info: () => {}, error: () => {}, warn: () => {}, child: () => fakeLogger };

function makeBody(opts: {
  eventType?: string;
  isDraft?: boolean;
  repoUrl?: string;
  targetRef?: string;
  status?: string;
  description?: string;
} = {}) {
  return {
    eventType: opts.eventType ?? 'git.pullrequest.updated',
    resource: {
      pullRequestId: 42,
      status: opts.status ?? 'active',
      isDraft: opts.isDraft ?? false,
      sourceRefName: 'refs/heads/feat/x',
      targetRefName: opts.targetRef ?? 'refs/heads/main',
      lastMergeSourceCommit: { commitId: 'abc1234567890' },
      description: opts.description ?? '```device-script\nurl: https://x.com/dl\naccount: name_1\nplatform: ios\nsuite: A\n```',
      repository: {
        url: opts.repoUrl ?? 'https://dev.azure.com/o/p/_git/r',
        id: 'repo-uuid',
        project: { id: 'proj-uuid', name: 'p' },
      },
    },
  };
}

function makeDeps(triggerSpy = vi.fn().mockResolvedValue({ runId: 'r1' })) {
  return {
    integrations: [{
      id: 'trampo',
      repo_url: 'https://dev.azure.com/o/p/_git/r',
      target_branch: 'main',
    }],
    triggerRun: triggerSpy,
    postParseError: vi.fn(),
    logger: fakeLogger,
  };
}

describe('webhook handler', () => {
  it('dispatches a run on a well-formed PR event', async () => {
    const deps = makeDeps();
    const h = createWebhookHandler(deps);
    const out = await h.handle(makeBody());
    expect(out.kind).toBe('dispatched');
    expect(deps.triggerRun).toHaveBeenCalledOnce();
  });

  it('skips draft PRs', async () => {
    const deps = makeDeps();
    const h = createWebhookHandler(deps);
    const out = await h.handle(makeBody({ isDraft: true }));
    expect(out.kind).toBe('skipped');
    if (out.kind === 'skipped') expect(out.reason).toMatch(/draft/i);
    expect(deps.triggerRun).not.toHaveBeenCalled();
  });

  it('skips PRs targeting a different branch', async () => {
    const deps = makeDeps();
    const h = createWebhookHandler(deps);
    const out = await h.handle(makeBody({ targetRef: 'refs/heads/develop' }));
    expect(out.kind).toBe('skipped');
  });

  it('skips unknown repos', async () => {
    const deps = makeDeps();
    const h = createWebhookHandler(deps);
    const out = await h.handle(makeBody({ repoUrl: 'https://dev.azure.com/other/p/_git/r' }));
    expect(out.kind).toBe('skipped');
  });

  it('skips events with no device-script block', async () => {
    const deps = makeDeps();
    const h = createWebhookHandler(deps);
    const out = await h.handle(makeBody({ description: 'just a normal PR description' }));
    expect(out.kind).toBe('skipped');
    if (out.kind === 'skipped') expect(out.reason).toMatch(/no.block/i);
  });

  it('posts a parse-error comment when description block is malformed', async () => {
    const deps = makeDeps();
    const h = createWebhookHandler(deps);
    const malformed = '```device-script\nurl: not-a-url\naccount: a\nplatform: ios\nsuite: A\n```';
    const out = await h.handle(makeBody({ description: malformed }));
    expect(out.kind).toBe('parse-error');
    expect(deps.postParseError).toHaveBeenCalled();
  });

  it('ignores irrelevant event types', async () => {
    const deps = makeDeps();
    const h = createWebhookHandler(deps);
    const out = await h.handle(makeBody({ eventType: 'git.pullrequest.merged' }));
    expect(out.kind).toBe('skipped');
  });
});
