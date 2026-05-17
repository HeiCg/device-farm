import { describe, it, expect, vi } from 'vitest';
import { createPrRunService } from '../internal/pr-run-service.js';
import type { PrTriggerRequest } from '../internal/webhook-handler.js';
import { ConcurrencyDeferredError } from '../../pipelines/index.js';

const fakeLogger: any = { info: () => {}, error: () => {}, warn: () => {}, child: () => fakeLogger };

function makeReq(overrides: Partial<PrTriggerRequest> = {}): PrTriggerRequest {
  return {
    integration: { id: 'trampo', repo_url: 'https://dev.azure.com/o/p/_git/r', target_branch: 'main' },
    prId: 42,
    sourceRefName: 'refs/heads/feat/x',
    commit: 'abc1234567890',
    block: { url: 'https://x.com/dl', account: 'name_1', platform: 'ios', suite: ['A'] },
    repoId: 'repo-uuid',
    projectId: 'proj-uuid',
    projectName: 'p',
    ...overrides,
  };
}

function makeDeps() {
  return {
    config: { pat: 'fake-pat' },
    upsertPipeline: vi.fn().mockResolvedValue({ id: 'pipeline-id' }),
    cancelRunsByPrId: vi.fn().mockResolvedValue(0),
    createRun: vi.fn().mockResolvedValue({ runId: 'run-1' }),
    logger: fakeLogger,
  };
}

describe('PrRunService', () => {
  it('builds YAML, upserts pipeline, cancels prior, creates run', async () => {
    const deps = makeDeps();
    const svc = createPrRunService(deps);
    const r = await svc.triggerRun(makeReq());
    expect(deps.upsertPipeline).toHaveBeenCalledOnce();
    expect(deps.cancelRunsByPrId).toHaveBeenCalledWith('42', expect.stringMatching(/new push/i));
    expect(deps.createRun).toHaveBeenCalledOnce();
    expect(r.kind).toBe('dispatched');
    if (r.kind === 'dispatched') expect(r.runId).toBe('run-1');
  });

  it('collapses concurrent duplicate triggers into a single run', async () => {
    const deps = makeDeps();
    const svc = createPrRunService(deps);
    const p1 = svc.triggerRun(makeReq());
    const p2 = svc.triggerRun(makeReq());
    await Promise.all([p1, p2]);
    expect(deps.createRun).toHaveBeenCalledOnce();
  });

  it('returns deferred when createRun throws ConcurrencyDeferredError', async () => {
    const deps = makeDeps();
    deps.createRun = vi.fn().mockRejectedValue(new ConcurrencyDeferredError());
    const svc = createPrRunService(deps);
    const r = await svc.triggerRun(makeReq());
    expect(r.kind).toBe('deferred');
  });

  it('re-throws non-concurrency errors from createRun', async () => {
    const deps = makeDeps();
    deps.createRun = vi.fn().mockRejectedValue(new Error('db connection lost'));
    const svc = createPrRunService(deps);
    await expect(svc.triggerRun(makeReq())).rejects.toThrow('db connection lost');
  });
});
