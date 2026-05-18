import { describe, it, expect } from 'vitest';
import { groupStepsByFlow, formatDuration } from '../flow-step-tree-logic.js';
import type { ReportStepLite } from '$lib/api/types.js';

const make = (over: Partial<ReportStepLite>): ReportStepLite => ({
  id: over.id ?? 's', flowName: over.flowName ?? null, command: over.command ?? null,
  status: over.status ?? 'passed', durationMs: over.durationMs ?? null,
  startedAt: null, finishedAt: null, error: null, screenshotPath: null, videoOffsetMs: null,
});

describe('groupStepsByFlow', () => {
  it('groups steps by flowName preserving order within group', () => {
    const steps = [
      make({ id: 's1', flowName: 'login.yaml', command: 'launchApp' }),
      make({ id: 's2', flowName: 'login.yaml', command: 'tapOn(Sub)' }),
      make({ id: 's3', flowName: 'checkout.yaml', command: 'tapOn(Pay)' }),
    ];
    const out = groupStepsByFlow(steps);
    expect(out.length).toBe(2);
    expect(out[0][0]).toBe('login.yaml');
    expect(out[0][1].map((s) => s.id)).toEqual(['s1', 's2']);
    expect(out[1][0]).toBe('checkout.yaml');
    expect(out[1][1].map((s) => s.id)).toEqual(['s3']);
  });

  it('uses "(no flow)" key for steps without flowName', () => {
    const steps = [make({ id: 's1', flowName: null, command: 'x' })];
    const out = groupStepsByFlow(steps);
    expect(out[0][0]).toBe('(no flow)');
  });
});

describe('formatDuration', () => {
  it('returns "" when null', () => {
    expect(formatDuration(null)).toBe('');
  });
  it('formats <1s as ms', () => {
    expect(formatDuration(500)).toBe('500ms');
  });
  it('formats >=1s as Xs with 1 decimal', () => {
    expect(formatDuration(1234)).toBe('1.2s');
    expect(formatDuration(12000)).toBe('12.0s');
  });
});
