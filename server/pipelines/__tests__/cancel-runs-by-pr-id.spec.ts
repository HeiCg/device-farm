import { describe, it, expect, vi } from 'vitest';
import { PipelineService } from '../internal/service.js';

const fakeLogger: any = { info: () => {}, error: () => {}, warn: () => {}, child: () => fakeLogger };

describe('PipelineService.cancelRunsByPrId', () => {
  it('cancels every active run for the PR', async () => {
    const activeRows = [
      { id: 'r1', status: 'running' },
      { id: 'r2', status: 'pending' },
    ];
    const updated: any[] = [];
    const db = {
      select: () => ({ from: () => ({ where: () => Promise.resolve(activeRows) }) }),
      update: () => ({
        set: (v: any) => ({
          where: (w: any) => { updated.push({ v, w }); return Promise.resolve(); },
        }),
      }),
    } as any;

    const broadcaster = { publish: vi.fn() } as any;
    const svc = new PipelineService(db, fakeLogger, broadcaster);

    const ctrl = new AbortController();
    const aborted = vi.spyOn(ctrl, 'abort');
    (svc as any).runningRuns.set('r1', ctrl);

    const cancelled = await svc.cancelRunsByPrId('42', 'new-push');

    expect(cancelled).toBe(2);
    expect(updated).toHaveLength(2);
    expect(aborted).toHaveBeenCalledOnce();
  });
});
