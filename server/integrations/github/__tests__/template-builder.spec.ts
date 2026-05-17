/**
 * Phase 37 Plan 37-03 Track C — template-builder spec.
 *
 * Covers Pitfall 5 (5-screenshot cap) + status-emoji mapping + dashboard link.
 */

import { describe, it, expect } from 'vitest';
import { renderComment, type RunStatus } from '../internal/template-builder.js';

const base = {
  jobId: 'job-xyz',
  deviceLabel: 'Pixel 7 (api-35)',
  duration: '2m 17s',
  screenshotsSignedUrls: [] as string[],
  dashboardUrl: 'https://df.local/jobs/job-xyz',
};

describe('github template-builder', () => {
  it('caps inline screenshots at 5 and folds overflow behind <details>', () => {
    const eight = Array.from({ length: 8 }, (_, i) => `https://signed.example/shot-${i}.png`);
    const md = renderComment({ ...base, status: 'passed', screenshotsSignedUrls: eight });

    // Inline image syntax — 5 shots
    const inlineMatches = md.match(/!\[shot\d+\]\(/g) ?? [];
    expect(inlineMatches.length).toBe(5);

    // <details> wrapper acknowledges the full count
    expect(md).toContain('<details>');
    expect(md).toContain('Screenshots (8 total — 5 shown)');
    expect(md).toContain('https://df.local/jobs/job-xyz');
  });

  it('renders no <details> when ≤ 5 screenshots', () => {
    const three = ['a', 'b', 'c'].map((s) => `https://signed.example/${s}.png`);
    const md = renderComment({ ...base, status: 'running', screenshotsSignedUrls: three });
    expect(md).not.toContain('<details>');
    const inlineMatches = md.match(/!\[shot\d+\]\(/g) ?? [];
    expect(inlineMatches.length).toBe(3);
  });

  it('renders status emoji map (running/passed/failed/cancelled)', () => {
    const cases: Array<[RunStatus, string]> = [
      ['running', '⏳'],
      ['passed', '✅'],
      ['failed', '❌'],
      ['cancelled', '⚠️'],
    ];
    for (const [status, emoji] of cases) {
      const md = renderComment({ ...base, status });
      expect(md).toContain(emoji);
      expect(md).toContain(status);
    }
  });

  it('includes the dashboard / logs / video links', () => {
    const md = renderComment({
      ...base,
      status: 'passed',
      screenshotsSignedUrls: [],
      logsUrl: 'https://df.local/jobs/job-xyz/logs',
      videoUrl: 'https://df.local/jobs/job-xyz/video',
    });
    expect(md).toContain('Open job ↗');
    expect(md).toContain('https://df.local/jobs/job-xyz');
    expect(md).toContain('https://df.local/jobs/job-xyz/logs');
    expect(md).toContain('https://df.local/jobs/job-xyz/video');
  });
});
