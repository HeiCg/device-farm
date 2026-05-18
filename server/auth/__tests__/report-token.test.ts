import { describe, it, expect } from 'vitest';
import { createReportTokenService } from '../report-token.js';

const secret = 'a'.repeat(64);

describe('report-token', () => {
  it('mint + verify roundtrips and returns expiresAt', async () => {
    const svc = createReportTokenService({ secret });
    const { token, expiresAt } = await svc.mint({ jobId: 'job-1', ttlDays: 30 });
    expect(typeof token).toBe('string');
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const verified = await svc.verify(token, 'job-1');
    expect(verified.ok).toBe(true);
  });

  it('rejects token for a different jobId', async () => {
    const svc = createReportTokenService({ secret });
    const { token } = await svc.mint({ jobId: 'job-1', ttlDays: 30 });
    const v = await svc.verify(token, 'job-2');
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('subject-mismatch');
  });

  it('rejects tampered token', async () => {
    const svc = createReportTokenService({ secret });
    const { token } = await svc.mint({ jobId: 'job-1', ttlDays: 30 });
    const tampered = token.slice(0, -3) + 'xxx';
    const v = await svc.verify(tampered, 'job-1');
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('invalid-signature');
  });

  it('rejects expired token', async () => {
    const svc = createReportTokenService({ secret });
    const { token } = await svc.mint({ jobId: 'job-1', ttlDays: 30, nowMs: Date.now() - 31 * 24 * 60 * 60 * 1000 });
    const v = await svc.verify(token, 'job-1');
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('expired');
  });

  it('rejects token signed with a different secret (secret rotation)', async () => {
    const svc1 = createReportTokenService({ secret: 'a'.repeat(64) });
    const svc2 = createReportTokenService({ secret: 'b'.repeat(64) });
    const { token } = await svc1.mint({ jobId: 'job-1', ttlDays: 30 });
    const v = await svc2.verify(token, 'job-1');
    expect(v.ok).toBe(false);
  });
});
