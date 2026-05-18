import { describe, it, expect } from 'vitest';
import { mapStepsForPersistence } from '../internal/step-mapper.js';

describe('mapStepsForPersistence', () => {
  it('attaches wallclock timestamps when parser map has the command', () => {
    const steps = [
      { flowName: 'login.yaml', command: 'tapOn("Email")', status: 'passed' as const, durationMs: 500 },
      { flowName: 'login.yaml', command: 'tapOn("Submit")', status: 'failed' as const, durationMs: 1200 },
    ];
    const ts = new Map<string, { startedAt: Date; endedAt?: Date }>([
      ['tapOn("Email")',  { startedAt: new Date(1_700_000_000_000), endedAt: new Date(1_700_000_000_500) }],
      ['tapOn("Submit")', { startedAt: new Date(1_700_000_000_700), endedAt: new Date(1_700_000_001_900) }],
    ]);

    const rows = mapStepsForPersistence('job-1', steps, ts);
    expect(rows[0]).toMatchObject({
      jobId: 'job-1',
      stepIndex: 0,
      command: 'tapOn("Email")',
      startedAt: new Date(1_700_000_000_000),
      finishedAt: new Date(1_700_000_000_500),
    });
    expect(rows[1].finishedAt).toEqual(new Date(1_700_000_001_900));
  });

  it('falls back when timestamp map has no entry (flow-level steps)', () => {
    const steps = [{ flowName: 'login.yaml', command: null, status: 'passed' as const, durationMs: 3000 }];
    const rows = mapStepsForPersistence('job-1', steps, new Map());
    expect(rows[0].startedAt).toBeUndefined();
    expect(rows[0].finishedAt).toBeUndefined();
  });
});
