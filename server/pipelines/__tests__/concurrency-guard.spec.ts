import { describe, it, expect } from 'vitest';
import { createConcurrencyGuard } from '../internal/concurrency-guard.js';

function fakeDb(runningCount: number) {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ count: runningCount }]),
      }),
    }),
  } as any;
}

describe('concurrency guard', () => {
  it('admits when count < cap', async () => {
    const guard = createConcurrencyGuard({ db: fakeDb(1), cap: 3 });
    expect(await guard.canAdmit()).toBe(true);
  });

  it('denies when count == cap', async () => {
    const guard = createConcurrencyGuard({ db: fakeDb(3), cap: 3 });
    expect(await guard.canAdmit()).toBe(false);
  });

  it('denies when count > cap (race recovery)', async () => {
    const guard = createConcurrencyGuard({ db: fakeDb(5), cap: 3 });
    expect(await guard.canAdmit()).toBe(false);
  });
});
