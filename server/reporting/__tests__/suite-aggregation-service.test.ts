import { describe, it, expect } from 'vitest';
import { aggregateSuites } from '../suite-aggregation-service.js';

describe('aggregateSuites', () => {
  it('groups by flowName with counts, passRate, trend (newest first)', () => {
    const rows = [
      { flowName: 'login.yaml', status: 'passed' as const, durationMs: 1000, finishedAt: new Date(10) },
      { flowName: 'login.yaml', status: 'passed' as const, durationMs: 1200, finishedAt: new Date(9)  },
      { flowName: 'login.yaml', status: 'failed' as const, durationMs: 1500, finishedAt: new Date(8)  },
      { flowName: 'checkout.yaml', status: 'passed' as const, durationMs: 800, finishedAt: new Date(7) },
    ];
    const out = aggregateSuites(rows);
    const login = out.find((s) => s.flowName === 'login.yaml')!;
    expect(login.totalRuns).toBe(3);
    expect(login.passed).toBe(2);
    expect(login.failed).toBe(1);
    expect(login.passRate).toBeCloseTo(2 / 3);
    expect(login.avgDurationMs).toBe(1233);
    expect(login.trend).toEqual([1, 1, 0]);
    expect(login.lastStatus).toBe('passed');
    expect(login.lastRunAt).toEqual(new Date(10));
  });

  it('returns empty array for no input', () => {
    expect(aggregateSuites([])).toEqual([]);
  });
});
