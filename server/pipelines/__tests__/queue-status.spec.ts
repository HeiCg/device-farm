import { describe, it, expect } from 'vitest';
import { getQueueStatus } from '../internal/queue-status.js';

describe('queue-status', () => {
  it('partitions rows into running and pending and includes capacity', async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => Promise.resolve([
              { id: 'a', status: 'running', triggerType: 'azure-pr', azurePrId: '1', startedAt: new Date(), createdAt: null },
              { id: 'b', status: 'pending', triggerType: 'api', azurePrId: null, startedAt: null, createdAt: new Date() },
              { id: 'c', status: 'pending', triggerType: 'schedule', azurePrId: null, startedAt: null, createdAt: new Date() },
            ]),
          }),
        }),
      }),
    } as any;
    const pool = { snapshot: () => ({ availableAndroid: 1, availableIos: 0 }) } as any;

    const out = await getQueueStatus({ db, pool, maxConcurrent: 2 });
    expect(out.running).toHaveLength(1);
    expect(out.pending).toHaveLength(2);
    expect(out.pending[0].position).toBe(1);
    expect(out.pending[1].position).toBe(2);
    expect(out.capacity).toEqual({
      max_concurrent: 2,
      active: 1,
      available_devices_android: 1,
      available_devices_ios: 0,
    });
  });
});
