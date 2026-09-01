import { describe, it, expect } from 'vitest';
import { analyzeProfile } from '../src/analyze';
import type { RawProfile } from '../src/types';

const RAW: RawProfile = {
  kind: 'react',
  durationMs: 1000,
  samples: [
    { function: 'renderList', file: 'List.tsx', line: 12, selfMs: 400, totalMs: 600 },
    { function: 'formatPrice', file: 'fmt.ts', line: 3, selfMs: 300, totalMs: 300 },
    { function: 'renderRow', file: 'Row.tsx', line: 8, selfMs: 100, totalMs: 150 },
    { function: 'noise', selfMs: 0, totalMs: 0 },
  ],
  hangs: [
    { startMs: 100, durationMs: 250, stack: ['renderList', 'renderRow'] },
    { startMs: 700, durationMs: 80, stack: ['formatPrice'] },
  ],
};

describe('analyzeProfile', () => {
  it('ranks functions by self time and computes percentage of total self time', () => {
    const report = analyzeProfile(RAW);
    expect(report.topFunctions[0].function).toBe('renderList');
    // total self = 800; renderList 400 -> 50%
    expect(report.topFunctions[0].selfPct).toBe(50);
    expect(report.topFunctions[1].function).toBe('formatPrice');
  });

  it('honors topN', () => {
    expect(analyzeProfile(RAW, { topN: 2 }).topFunctions).toHaveLength(2);
  });

  it('ranks hangs by duration descending and keeps the top frame', () => {
    const report = analyzeProfile(RAW);
    expect(report.hangs[0].durationMs).toBe(250);
    expect(report.hangs[0].topFrame).toBe('renderList');
  });

  it('produces a human-readable summary mentioning the worst offender', () => {
    const report = analyzeProfile(RAW);
    expect(report.summary).toContain('renderList');
    expect(report.kind).toBe('react');
    expect(report.durationMs).toBe(1000);
  });

  it('handles an empty profile without dividing by zero', () => {
    const report = analyzeProfile({ kind: 'native', durationMs: 0, samples: [] });
    expect(report.topFunctions).toEqual([]);
    expect(report.hangs).toEqual([]);
  });
});
