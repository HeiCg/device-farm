import { describe, it, expect } from 'vitest';
import { buildReportBundle } from '../report-bundle-service.js';

const job = {
  id: 'job-1', status: 'failed', platform: 'android',
  createdAt: new Date('2026-05-17T14:32:00Z'),
  startedAt: new Date('2026-05-17T14:32:05Z'),
  finishedAt: new Date('2026-05-17T14:34:19Z'),
  deviceId: 'dev-1', metadata: {},
};

const steps = [
  { id: 's1', jobId: 'job-1', stepIndex: 0, flowName: 'login.yaml', command: 'launchApp',
    status: 'passed' as const, durationMs: 1200,
    startedAt: new Date('2026-05-17T14:32:10Z'),
    finishedAt: new Date('2026-05-17T14:32:11.2Z'),
    error: null, screenshotPath: null },
  { id: 's2', jobId: 'job-1', stepIndex: 1, flowName: 'login.yaml', command: 'tapOn("Submit")',
    status: 'failed' as const, durationMs: 500,
    startedAt: new Date('2026-05-17T14:32:47Z'),
    finishedAt: new Date('2026-05-17T14:32:47.5Z'),
    error: 'Element not found: Submit',
    screenshotPath: '/artifacts/job-1/step-1.png' },
];

const artifacts = [
  { id: 'a1', type: 'video' as const, fileName: 'rec.mp4', mimeType: 'video/mp4', fileSizeBytes: 12345,
    videoStartedAt: new Date('2026-05-17T14:32:05Z') },
];

describe('buildReportBundle', () => {
  it('derives video offsets from step.startedAt - video.videoStartedAt', () => {
    const b = buildReportBundle({ job, steps, artifacts, logTailLines: [], history: null });
    expect(b.steps[0].videoOffsetMs).toBe(5000);
    expect(b.steps[1].videoOffsetMs).toBe(42_000);
  });

  it('returns null videoOffsetMs when no video artifact', () => {
    const b = buildReportBundle({ job, steps, artifacts: [], logTailLines: [], history: null });
    expect(b.steps[0].videoOffsetMs).toBeNull();
  });

  it('picks first failed step as failureFocus', () => {
    const b = buildReportBundle({ job, steps, artifacts, logTailLines: ['x','y'], history: null });
    expect(b.failureFocus?.stepId).toBe('s2');
    expect(b.failureFocus?.error).toBe('Element not found: Submit');
    expect(b.failureFocus?.logTailLines).toEqual(['x','y']);
    expect(b.failureFocus?.videoOffsetMs).toBe(42_000);
  });

  it('failureFocus is null when no step failed', () => {
    const passed = steps.map(s => ({ ...s, status: 'passed' as const, error: null }));
    const b = buildReportBundle({ job: { ...job, status: 'passed' }, steps: passed, artifacts, logTailLines: [], history: null });
    expect(b.failureFocus).toBeNull();
  });

  it('summary counts each status', () => {
    const b = buildReportBundle({ job, steps, artifacts, logTailLines: [], history: null });
    expect(b.job.summary).toEqual({ total: 2, passed: 1, failed: 1, skipped: 0 });
  });
});
