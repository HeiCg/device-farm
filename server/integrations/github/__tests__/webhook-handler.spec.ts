/**
 * Phase 37 Plan 37-03 Track C — webhook handler spec.
 *
 * Covers pull_request action dispatch + ignore reasons.
 */

import { describe, it, expect, vi } from 'vitest';
import { createGithubWebhookHandler } from '../internal/webhook-handler.js';

const fakeLogger: any = { info: () => {}, warn: () => {}, error: () => {}, child: () => fakeLogger };

function makePrBody(opts: { action?: string; prNumber?: number; installId?: number } = {}) {
  return {
    action: opts.action ?? 'opened',
    installation: { id: opts.installId ?? 100 },
    pull_request: {
      number: opts.prNumber ?? 42,
      html_url: 'https://github.com/octo/demo/pull/42',
      head: { sha: 'deadbeef', ref: 'feat/x' },
      base: { ref: 'main' },
    },
    repository: {
      name: 'demo',
      owner: { login: 'octo' },
    },
  };
}

function makeDeps(triggerSpy = vi.fn().mockResolvedValue({ runId: 'r-1' })) {
  return { triggerRun: triggerSpy, logger: fakeLogger };
}

describe('github webhook handler', () => {
  it('dispatches pull_request.opened', async () => {
    const deps = makeDeps();
    const h = createGithubWebhookHandler(deps);
    const out = await h.handle('pull_request', makePrBody({ action: 'opened' }));
    expect(out).toEqual({ kind: 'triggered', runId: 'r-1' });
    expect(deps.triggerRun).toHaveBeenCalledOnce();
    const call = (deps.triggerRun as any).mock.calls[0][0];
    expect(call.installationId).toBe(100);
    expect(call.owner).toBe('octo');
    expect(call.repo).toBe('demo');
    expect(call.prNumber).toBe(42);
    expect(call.headSha).toBe('deadbeef');
  });

  it('dispatches pull_request.synchronize as PR-bot re-run', async () => {
    const deps = makeDeps();
    const h = createGithubWebhookHandler(deps);
    const out = await h.handle('pull_request', makePrBody({ action: 'synchronize' }));
    expect(out.kind).toBe('triggered');
  });

  it('dispatches pull_request.reopened', async () => {
    const deps = makeDeps();
    const h = createGithubWebhookHandler(deps);
    const out = await h.handle('pull_request', makePrBody({ action: 'reopened' }));
    expect(out.kind).toBe('triggered');
  });

  it('ignores non-PR events (push, issues, star)', async () => {
    const deps = makeDeps();
    const h = createGithubWebhookHandler(deps);
    for (const event of ['push', 'issues', 'star', 'fork']) {
      const out = await h.handle(event, makePrBody());
      expect(out).toEqual({ kind: 'ignored', reason: 'event-not-handled' });
    }
    expect(deps.triggerRun).not.toHaveBeenCalled();
  });

  it('ignores PR actions outside opened/synchronize/reopened', async () => {
    const deps = makeDeps();
    const h = createGithubWebhookHandler(deps);
    for (const action of ['closed', 'edited', 'assigned', 'labeled']) {
      const out = await h.handle('pull_request', makePrBody({ action }));
      expect(out.kind).toBe('ignored');
      if (out.kind === 'ignored') {
        expect(out.reason).toContain(`action-${action}`);
      }
    }
    expect(deps.triggerRun).not.toHaveBeenCalled();
  });

  it('returns ignored:parse-failed on malformed body', async () => {
    const deps = makeDeps();
    const h = createGithubWebhookHandler(deps);
    const out = await h.handle('pull_request', { action: 'opened' /* missing rest */ });
    expect(out).toEqual({ kind: 'ignored', reason: 'parse-failed' });
  });

  it('routes events to correct installation by installation_id', async () => {
    const deps = makeDeps();
    const h = createGithubWebhookHandler(deps);
    await h.handle('pull_request', makePrBody({ installId: 999 }));
    const call = (deps.triggerRun as any).mock.calls[0][0];
    expect(call.installationId).toBe(999);
  });
});
