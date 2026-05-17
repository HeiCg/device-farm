import { describe, it, expect, vi } from 'vitest';
import { recoverOrphans } from '../internal/orphan-recovery.js';

const fakeLogger: any = { info: () => {}, error: () => {}, warn: () => {}, child: () => fakeLogger };

function makeDeps(orphans: Array<{ id: string; azurePrId?: string | null; variables?: Record<string, unknown> }>) {
  const updated: any[] = [];
  const retryRun = vi.fn(async () => 'new-run-id');
  const commentRetry = vi.fn(async () => {});

  return {
    orphans, updated, retryRun, commentRetry,
    deps: {
      db: {
        select: () => ({ from: () => ({ where: () => Promise.resolve(orphans) }) }),
        update: () => ({
          set: (v: any) => ({
            where: (w: any) => { updated.push({ v, w }); return Promise.resolve(); },
          }),
        }),
      } as any,
      retryRun,
      commentRetry,
      logger: fakeLogger,
    },
  };
}

describe('orphan recovery', () => {
  it('marks running rows as cancelled and re-enqueues (PR-bot run, first retry)', async () => {
    const ctx = makeDeps([{ id: 'r1', azurePrId: '42', variables: {} }]);
    await recoverOrphans(ctx.deps);
    expect(ctx.updated).toHaveLength(1);
    expect(ctx.retryRun).toHaveBeenCalledOnce();
    expect(ctx.retryRun).toHaveBeenCalledWith(expect.objectContaining({ prId: '42' }));
  });

  it('does NOT loop (skips retry when metadata.retry_of present)', async () => {
    const ctx = makeDeps([{ id: 'r2', azurePrId: '42', variables: { retry_of: 'r1' } }]);
    await recoverOrphans(ctx.deps);
    expect(ctx.updated).toHaveLength(1);
    expect(ctx.retryRun).not.toHaveBeenCalled();
  });

  it('cancels API/schedule runs without retry (no PR association)', async () => {
    const ctx = makeDeps([{ id: 'r3', azurePrId: null, variables: {} }]);
    await recoverOrphans(ctx.deps);
    expect(ctx.updated).toHaveLength(1);
    expect(ctx.retryRun).not.toHaveBeenCalled();
    expect(ctx.commentRetry).not.toHaveBeenCalled();
  });

  it('is a no-op when there are zero orphans', async () => {
    const ctx = makeDeps([]);
    await recoverOrphans(ctx.deps);
    expect(ctx.updated).toHaveLength(0);
  });
});
