import { describe, it, expect, vi } from 'vitest';
import { createPrCommenter } from '../internal/pr-commenter.js';
import type { AzureClient } from '../internal/azure-client.js';

const fakeLogger: any = { info: () => {}, error: () => {}, warn: () => {}, child: () => fakeLogger };

function makeMockClient(): AzureClient {
  return {
    createThread: vi.fn().mockResolvedValue({ threadId: 'thread-1', commentId: 'c-1' }),
    updateComment: vi.fn().mockResolvedValue(undefined),
    getPullRequest: vi.fn(),
  };
}

describe('PR commenter', () => {
  it('creates a new thread on first call', async () => {
    const client = makeMockClient();
    const store = new Map<string, { threadId: string; commentId: string }>();
    const commenter = createPrCommenter({
      client,
      lookupCommentRef: (prId) => store.get(prId) ?? null,
      saveCommentRef: (prId, ref) => { store.set(prId, ref); },
      baseUrl: 'https://df.local',
      logger: fakeLogger,
    });

    await commenter.upsert({
      organization: 'myorg', project: 'myproject',
      repoId: 'r1', prId: 42, runId: 'run-1',
      status: 'running', suites: ['A'], commit: 'abc123', startedAt: new Date(),
    });

    expect(client.createThread).toHaveBeenCalledOnce();
    expect(client.updateComment).not.toHaveBeenCalled();
    expect(store.get('42')).toEqual({ threadId: 'thread-1', commentId: 'c-1' });
  });

  it('updates existing thread on second call', async () => {
    const client = makeMockClient();
    const store = new Map<string, { threadId: string; commentId: string }>();
    store.set('42', { threadId: 'thread-1', commentId: 'c-1' });
    const commenter = createPrCommenter({
      client,
      lookupCommentRef: (prId) => store.get(prId) ?? null,
      saveCommentRef: (prId, ref) => { store.set(prId, ref); },
      baseUrl: 'https://df.local',
      logger: fakeLogger,
    });

    await commenter.upsert({
      organization: 'myorg', project: 'myproject',
      repoId: 'r1', prId: 42, runId: 'run-1',
      status: 'passed', suites: ['A', 'B'], commit: 'abc123', startedAt: new Date(),
    });

    expect(client.createThread).not.toHaveBeenCalled();
    expect(client.updateComment).toHaveBeenCalledWith(
      'myorg', 'myproject', 'r1', 42, 'thread-1', 'c-1', expect.stringContaining('✅'),
    );
  });

  it('renders correct emoji per status', async () => {
    const client = makeMockClient();
    const store = new Map<string, { threadId: string; commentId: string }>();
    const commenter = createPrCommenter({
      client,
      lookupCommentRef: () => null,
      saveCommentRef: (prId, ref) => { store.set(prId, ref); },
      baseUrl: 'https://df.local',
      logger: fakeLogger,
    });

    const cases: Array<['running' | 'passed' | 'failed' | 'cancelled', string]> = [
      ['running', '⏳'], ['passed', '✅'], ['failed', '❌'], ['cancelled', '⚠️'],
    ];
    for (const [status, emoji] of cases) {
      await commenter.upsert({
        organization: 'myorg', project: 'myproject',
        repoId: 'r', prId: 1, runId: 'run',
        status, suites: ['A'], commit: 'c', startedAt: new Date(),
      });
      const lastCall = (client.createThread as any).mock.calls.at(-1);
      expect(lastCall[4]).toContain(emoji);
    }
  });

  it('includes run link in markdown', async () => {
    const client = makeMockClient();
    const commenter = createPrCommenter({
      client,
      lookupCommentRef: () => null,
      saveCommentRef: () => {},
      baseUrl: 'https://df.example',
      logger: fakeLogger,
    });
    await commenter.upsert({
      organization: 'myorg', project: 'myproject',
      repoId: 'r', prId: 1, runId: 'run-xyz',
      status: 'running', suites: ['A'],
      commit: 'abcdef0', startedAt: new Date(),
    });
    const body = (client.createThread as any).mock.calls[0][4] as string;
    expect(body).toContain('https://df.example/pipeline-runs/run-xyz');
  });
});
