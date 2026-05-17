/**
 * Phase 23 / Plan 23-02 — queue.spec mock-based unit tests (no DB).
 *
 * Asserts QUEUE-03 + Pitfall 2 contract at the source level:
 *   - boss.createQueue called with policy:'stately' (NOT default 'standard')
 *   - retryLimit:0 (device-touching handler)
 *   - Worker registration delegates to boss.work
 *
 * DB-gated dedup proof lives in idempotency.spec.ts (Task 2.3).
 */
import { describe, it, expect, vi } from 'vitest';
import type { PgBoss } from 'pg-boss';
import {
  JOB_EXECUTE_QUEUE_NAME,
  registerJobsExecuteQueue,
  registerJobsExecuteWorker,
  type JobExecutePayload,
} from '../queue.js';

function makeMockBoss(): PgBoss {
  return {
    createQueue: vi.fn().mockResolvedValue(undefined),
    work: vi.fn().mockResolvedValue('worker-id-fake-1'),
  } as unknown as PgBoss;
}

describe('jobs/queue.ts — Phase 23 Plan 23-02 contract [QUEUE-03]', () => {
  it('JOB_EXECUTE_QUEUE_NAME equals literal "job.execute"', () => {
    expect(JOB_EXECUTE_QUEUE_NAME).toBe('job.execute');
  });

  it('registerJobsExecuteQueue calls boss.createQueue with policy:stately + retryLimit:0', async () => {
    const boss = makeMockBoss();
    await registerJobsExecuteQueue(boss);
    expect(boss.createQueue).toHaveBeenCalledTimes(1);
    const call = (boss.createQueue as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('job.execute');
    expect(call[1]).toMatchObject({ policy: 'stately', retryLimit: 0 });
  });

  it('registerJobsExecuteQueue is idempotent — calling twice does not throw', async () => {
    const boss = makeMockBoss();
    await registerJobsExecuteQueue(boss);
    await registerJobsExecuteQueue(boss);
    expect(boss.createQueue).toHaveBeenCalledTimes(2);  // Both calls forwarded; pg-boss tolerates re-create
  });

  it('registerJobsExecuteWorker calls boss.work and returns workerId', async () => {
    const boss = makeMockBoss();
    const handler = vi.fn(async (_payload: JobExecutePayload, _id: string) => undefined);
    const id = await registerJobsExecuteWorker(boss, handler);
    expect(id).toBe('worker-id-fake-1');
    expect(boss.work).toHaveBeenCalledTimes(1);
    const call = (boss.work as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('job.execute');
    expect(typeof call[1]).toBe('function');
  });

  it('worker handler unpacks pg-boss batch and forwards each job to handler', async () => {
    const boss = makeMockBoss();
    const handler = vi.fn(async (_payload: JobExecutePayload, _id: string) => undefined);
    await registerJobsExecuteWorker(boss, handler);
    // Capture the batch handler boss.work received
    const batchHandler = (boss.work as ReturnType<typeof vi.fn>).mock.calls[0][1] as (
      jobs: Array<{ id: string; data: JobExecutePayload }>,
    ) => Promise<void>;
    await batchHandler([
      { id: 'boss-1', data: { jobId: 'j1', platform: 'android' } },
      { id: 'boss-2', data: { jobId: 'j2', platform: 'ios' } },
    ]);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenNthCalledWith(1, { jobId: 'j1', platform: 'android' }, 'boss-1');
    expect(handler).toHaveBeenNthCalledWith(2, { jobId: 'j2', platform: 'ios' }, 'boss-2');
  });
});
