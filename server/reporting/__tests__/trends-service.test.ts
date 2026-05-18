import { describe, it, expect } from 'vitest';
import { computeTrends } from '../trends-service.js';

describe('computeTrends', () => {
  it('groups runs by date and by flow', () => {
    const rows = [
      { flowName: 'a', status: 'passed', finishedAt: new Date('2026-05-17T10:00:00Z') },
      { flowName: 'a', status: 'failed', finishedAt: new Date('2026-05-17T11:00:00Z') },
      { flowName: 'b', status: 'passed', finishedAt: new Date('2026-05-18T10:00:00Z') },
    ];
    const t = computeTrends(rows, 7);
    expect(t.byDay).toEqual([
      { date: '2026-05-17', passed: 1, failed: 1, total: 2 },
      { date: '2026-05-18', passed: 1, failed: 0, total: 1 },
    ]);
    expect(t.byFlow).toEqual([
      { flowName: 'a', passed: 1, failed: 1 },
      { flowName: 'b', passed: 1, failed: 0 },
    ]);
    expect(t.windowDays).toBe(7);
  });
});
