/**
 * Phase 21 / Plan 21-05 — Artifacts module ownership structural guard (SC1).
 *
 * Mirrors Phase 20 server/pool/__tests__/lifecycle-ownership.spec.ts pattern —
 * reads server/jobs/job-service.ts on disk and asserts that Plan 21-04's
 * edits persist: no imperative artifact/recording/memory service calls remain,
 * and the 3 new emit calls are in place.
 *
 * NON-DB — runs always. Prevents regression: if a future contributor reintroduces
 * an imperative call, this spec fails immediately.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const JOB_SERVICE_PATH = resolve(__dirname, '../../jobs/job-service.ts');
const src = readFileSync(JOB_SERVICE_PATH, 'utf-8');

function count(needle: string): number {
  let n = 0;
  let idx = 0;
  while ((idx = src.indexOf(needle, idx)) !== -1) {
    n++;
    idx += needle.length;
  }
  return n;
}

describe('[Phase 21-05 SC1] zero direct calls into artifact services from job-service.ts', () => {
  it('no this.artifactService.createArtifact(', () => {
    expect(count('this.artifactService.createArtifact(')).toBe(0);
  });

  it('no this.recordingService.startRecording', () => {
    expect(count('this.recordingService.startRecording')).toBe(0);
  });

  it('no this.recordingService.stopRecording', () => {
    expect(count('this.recordingService.stopRecording')).toBe(0);
  });

  it('no this.memoryService.startSampling', () => {
    expect(count('this.memoryService.startSampling')).toBe(0);
  });

  it('no this.memoryService.stopSampling', () => {
    expect(count('this.memoryService.stopSampling')).toBe(0);
  });

  it('no this.memoryService.writeSamples', () => {
    expect(count('this.memoryService.writeSamples')).toBe(0);
  });

  // Screenshot on-flow-failure capture KEPT (mid-execution, before job.completed).
  // Subscriber handles post-completion directory scan.
  it('this.screenshotService.capture count <= 1 (mid-flow on-failure KEPT; documented in MODULE.md Non-Goals)', () => {
    expect(count('this.screenshotService.capture')).toBeLessThanOrEqual(1);
  });
});

describe('[Phase 21-05 SC1] new emit calls in job-service.ts', () => {
  it('this.jobsEmit?.started is called at least once', () => {
    expect(count('this.jobsEmit?.started')).toBeGreaterThanOrEqual(1);
  });

  it('this.jobsEmit?.maestroLogWritten is called at least once', () => {
    expect(count('this.jobsEmit?.maestroLogWritten')).toBeGreaterThanOrEqual(1);
  });

  it('this.jobsEmit?.completed is called at least once (Phase 19 emit preserved)', () => {
    const q = count('this.jobsEmit?.completed');
    const nonQ = count('this.jobsEmit.completed');
    expect(q + nonQ).toBeGreaterThanOrEqual(1);
  });
});
