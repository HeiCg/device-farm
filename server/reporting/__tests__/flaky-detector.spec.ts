import { describe, it, expect, vi } from 'vitest';
import { FlakyDetector } from '../flaky-detector.js';

function createMockDb(rows: Array<{ flowName: string; status: string }>) {
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue(rows),
  } as any;
}

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as any;
}

describe('FlakyDetector', () => {
  it('identifies flows with pass rate between 20%-80% as flaky', async () => {
    // 5 passed, 5 failed = 50% pass rate -> flaky
    const rows = [
      ...Array(5).fill(null).map(() => ({ flowName: 'Login', status: 'passed' })),
      ...Array(5).fill(null).map(() => ({ flowName: 'Login', status: 'failed' })),
    ];

    const db = createMockDb(rows);
    const detector = new FlakyDetector(db, createLogger());
    const result = await detector.getFlaky(10);

    expect(result).toHaveLength(1);
    expect(result[0].flowName).toBe('Login');
    expect(result[0].passRate).toBe(0.5);
    expect(result[0].passCount).toBe(5);
    expect(result[0].failCount).toBe(5);
    expect(result[0].totalRuns).toBe(10);
  });

  it('does NOT flag 100% pass rate as flaky', async () => {
    const rows = Array(10).fill(null).map(() => ({ flowName: 'Stable', status: 'passed' }));

    const db = createMockDb(rows);
    const detector = new FlakyDetector(db, createLogger());
    const result = await detector.getFlaky(10);

    expect(result).toHaveLength(0);
  });

  it('does NOT flag 0% pass rate as flaky', async () => {
    const rows = Array(10).fill(null).map(() => ({ flowName: 'Broken', status: 'failed' }));

    const db = createMockDb(rows);
    const detector = new FlakyDetector(db, createLogger());
    const result = await detector.getFlaky(10);

    expect(result).toHaveLength(0);
  });

  it('returns correct structure for each flaky flow', async () => {
    // 3 passed, 7 failed = 30% pass rate -> flaky
    const rows = [
      ...Array(3).fill(null).map(() => ({ flowName: 'Checkout', status: 'passed' })),
      ...Array(7).fill(null).map(() => ({ flowName: 'Checkout', status: 'failed' })),
    ];

    const db = createMockDb(rows);
    const detector = new FlakyDetector(db, createLogger());
    const result = await detector.getFlaky(10);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      flowName: 'Checkout',
      totalRuns: 10,
      passCount: 3,
      failCount: 7,
      passRate: 0.3,
    });
  });

  it('respects windowSize limit per flow', async () => {
    // 15 results for one flow, windowSize=10 -> only last 10 used
    const rows = [
      ...Array(8).fill(null).map(() => ({ flowName: 'Cart', status: 'passed' })),
      ...Array(7).fill(null).map(() => ({ flowName: 'Cart', status: 'failed' })),
    ];

    const db = createMockDb(rows);
    const detector = new FlakyDetector(db, createLogger());
    const result = await detector.getFlaky(10);

    // With windowSize=10, only first 10 rows used: 8 passed + 2 failed = 80% pass -> NOT flaky (at boundary)
    expect(result).toHaveLength(0);
  });

  it('handles multiple flows independently', async () => {
    const rows = [
      // Login: 5/10 pass = 50% -> flaky
      ...Array(5).fill(null).map(() => ({ flowName: 'Login', status: 'passed' })),
      ...Array(5).fill(null).map(() => ({ flowName: 'Login', status: 'failed' })),
      // Checkout: 10/10 pass = 100% -> NOT flaky
      ...Array(10).fill(null).map(() => ({ flowName: 'Checkout', status: 'passed' })),
      // Signup: 2/10 = 20% -> at lower boundary, NOT flaky (< not <=)
      ...Array(2).fill(null).map(() => ({ flowName: 'Signup', status: 'passed' })),
      ...Array(8).fill(null).map(() => ({ flowName: 'Signup', status: 'failed' })),
    ];

    const db = createMockDb(rows);
    const detector = new FlakyDetector(db, createLogger());
    const result = await detector.getFlaky(10);

    const flakyNames = result.map((f: any) => f.flowName);
    expect(flakyNames).toContain('Login');
    expect(flakyNames).not.toContain('Checkout');
  });

  it('defaults windowSize to 10', async () => {
    const rows = [
      ...Array(5).fill(null).map(() => ({ flowName: 'Test', status: 'passed' })),
      ...Array(5).fill(null).map(() => ({ flowName: 'Test', status: 'failed' })),
    ];

    const db = createMockDb(rows);
    const detector = new FlakyDetector(db, createLogger());
    const result = await detector.getFlaky();

    expect(result).toHaveLength(1);
  });
});
