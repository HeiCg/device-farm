import { describe, it, expect } from 'vitest';
import { buildReportUrl } from '../internal/build-comment-url.js';

describe('buildReportUrl', () => {
  it('embeds share token when jobId + token present', () => {
    expect(buildReportUrl({
      baseUrl: 'https://df.local',
      jobId: 'j1',
      pipelineRunId: null,
      shareToken: 'abc.def.ghi',
    })).toBe('https://df.local/jobs/j1?t=abc.def.ghi');
  });

  it('plain URL when jobId without token', () => {
    expect(buildReportUrl({
      baseUrl: 'https://df.local',
      jobId: 'j1',
      pipelineRunId: null,
      shareToken: null,
    })).toBe('https://df.local/jobs/j1');
  });

  it('falls back to pipeline-run URL when no jobId', () => {
    // Share token is ignored for pipeline-run URLs (per-job scope mismatch).
    expect(buildReportUrl({
      baseUrl: 'https://df.local',
      jobId: null,
      pipelineRunId: 'pr1',
      shareToken: 'unused',
    })).toBe('https://df.local/pipeline-runs/pr1');
  });

  it('trims trailing slash from baseUrl', () => {
    expect(buildReportUrl({
      baseUrl: 'https://df.local/',
      jobId: 'j1',
      pipelineRunId: null,
      shareToken: null,
    })).toBe('https://df.local/jobs/j1');
  });

  it('returns base URL when both jobId and pipelineRunId are null', () => {
    expect(buildReportUrl({
      baseUrl: 'https://df.local',
      jobId: null,
      pipelineRunId: null,
      shareToken: null,
    })).toBe('https://df.local');
  });

  it('jobId takes priority over pipelineRunId', () => {
    expect(buildReportUrl({
      baseUrl: 'https://df.local',
      jobId: 'j1',
      pipelineRunId: 'pr1',
      shareToken: null,
    })).toBe('https://df.local/jobs/j1');
  });

  it('trims trailing slash from baseUrl for pipeline-run URL', () => {
    expect(buildReportUrl({
      baseUrl: 'https://df.local/',
      jobId: null,
      pipelineRunId: 'pr1',
      shareToken: null,
    })).toBe('https://df.local/pipeline-runs/pr1');
  });
});
