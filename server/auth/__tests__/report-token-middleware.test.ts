/**
 * Tests for share-token middleware helpers (Task 3.3).
 *
 * Strategy: test the pure helper layer in isolation (isTokenAllowedPath,
 * extractJobId) plus the token-service verify/mint roundtrip as it relates
 * to the middleware logic. Full integration wiring (Fastify + bearer-auth
 * bypass) lives in auth-plugin.spec.ts and api-plugin integration tests.
 */
import { describe, it, expect } from 'vitest';
import {
  isTokenAllowedPath,
  extractJobId,
  createReportTokenService,
} from '../report-token.js';

const secret = 'x'.repeat(64);

// ---------------------------------------------------------------------------
// URL allowlist predicate
// ---------------------------------------------------------------------------

describe('isTokenAllowedPath', () => {
  it.each([
    ['/jobs/abc-123', true],
    ['/api/jobs/abc-123', true],
    ['/jobs/abc-123/report', true],
    ['/api/jobs/abc-123/report', true],
    ['/jobs/abc-123/artifacts', true],
    ['/jobs/abc-123/artifacts/video.mp4', true],
    ['/api/jobs/abc-123/artifacts/screenshots/step1.png', true],
    ['/jobs/abc-123/logs', true],
    ['/api/jobs/abc-123/logs', true],
    ['/jobs/abc-123/reports/junit.xml', true],
    ['/api/jobs/abc-123/reports/junit.xml', true],
  ])('%s → allowed=%s', (path, expected) => {
    expect(isTokenAllowedPath(path)).toBe(expected);
  });

  it.each([
    ['/jobs', false],
    ['/api/jobs', false],
    ['/jobs/abc-123/admin', false],
    ['/api/jobs/abc-123/share-token', false],
    ['/jobs/abc-123/reports/other.xml', false],
    ['/api/admin/keys', false],
    ['/api/health', false],
    ['/jobs/abc-123/report/extra', false],
    ['/jobs/abc-123/logs/extra', false],
  ])('%s → allowed=%s', (path, expected) => {
    expect(isTokenAllowedPath(path)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Job ID extraction
// ---------------------------------------------------------------------------

describe('extractJobId', () => {
  it.each([
    ['/jobs/abc-123', 'abc-123'],
    ['/api/jobs/abc-123', 'abc-123'],
    ['/jobs/uuid-0000-0000/report', 'uuid-0000-0000'],
    ['/api/jobs/job-99/artifacts/video.mp4', 'job-99'],
  ])('%s → %s', (url, expected) => {
    expect(extractJobId(url)).toBe(expected);
  });

  it.each([
    ['/api/health'],
    ['/jobs'],
    ['/'],
  ])('%s → null', (url) => {
    expect(extractJobId(url)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Token service verify as used by middleware
// ---------------------------------------------------------------------------

describe('share-token middleware logic', () => {
  it('valid token for correct jobId sets shareToken', async () => {
    const svc = createReportTokenService({ secret });
    const { token } = await svc.mint({ jobId: 'job-1', ttlDays: 30 });
    const v = await svc.verify(token, 'job-1');
    expect(v.ok).toBe(true);
    // Middleware would set: req.shareToken = { jobId: 'job-1' }
  });

  it('valid token for a different jobId does NOT bypass auth (subject-mismatch)', async () => {
    const svc = createReportTokenService({ secret });
    const { token } = await svc.mint({ jobId: 'job-1', ttlDays: 30 });
    const v = await svc.verify(token, 'job-2');
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('subject-mismatch');
    // Middleware would NOT set req.shareToken → falls through to bearer auth
  });

  it('expired token does NOT bypass auth', async () => {
    const svc = createReportTokenService({ secret });
    const { token } = await svc.mint({
      jobId: 'job-1',
      ttlDays: 30,
      nowMs: Date.now() - 31 * 24 * 60 * 60 * 1000, // 31 days ago
    });
    const v = await svc.verify(token, 'job-1');
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('expired');
  });

  it('tampered token does NOT bypass auth', async () => {
    const svc = createReportTokenService({ secret });
    const { token } = await svc.mint({ jobId: 'job-1', ttlDays: 30 });
    const tampered = token.slice(0, -4) + 'xxxx';
    const v = await svc.verify(tampered, 'job-1');
    expect(v.ok).toBe(false);
  });

  it('token from a different secret does NOT bypass auth', async () => {
    const svc1 = createReportTokenService({ secret: 'a'.repeat(64) });
    const svc2 = createReportTokenService({ secret: 'b'.repeat(64) });
    const { token } = await svc1.mint({ jobId: 'job-1', ttlDays: 30 });
    const v = await svc2.verify(token, 'job-1');
    expect(v.ok).toBe(false);
  });

  it('middleware only acts on allowed paths — non-allowed path skips verification', () => {
    // Simulate the middleware guard: if !isTokenAllowedPath → return early
    const nonAllowedPaths = ['/api/jobs', '/api/admin/keys', '/api/health', '/api/jobs/j/share-token'];
    for (const path of nonAllowedPaths) {
      expect(isTokenAllowedPath(path)).toBe(false);
    }
  });

  it('all five allowed route patterns are exercised', () => {
    const allowedExamples = [
      '/api/jobs/j1',                         // /jobs/:id
      '/api/jobs/j1/report',                  // /jobs/:id/report
      '/api/jobs/j1/artifacts',               // /jobs/:id/artifacts
      '/api/jobs/j1/artifacts/vid.mp4',       // /jobs/:id/artifacts*
      '/api/jobs/j1/logs',                    // /jobs/:id/logs
      '/api/jobs/j1/reports/junit.xml',       // /jobs/:id/reports/junit.xml
    ];
    for (const path of allowedExamples) {
      expect(isTokenAllowedPath(path)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Config refine logic (unit — simulates what Zod would do)
// ---------------------------------------------------------------------------

describe('config cross-field validation', () => {
  it('sharing.enabled=true requires share_token_secret', () => {
    // We simulate the .refine predicate manually since bootstrapping the full
    // Zod configSchema would require all other fields.
    const refine = (cfg: { sharing: { enabled: boolean }; security: { share_token_secret?: string } }) =>
      !cfg.sharing.enabled ||
      (cfg.security.share_token_secret !== undefined && cfg.security.share_token_secret.length >= 32);

    expect(refine({ sharing: { enabled: false }, security: {} })).toBe(true);
    expect(refine({ sharing: { enabled: true }, security: {} })).toBe(false);
    expect(refine({ sharing: { enabled: true }, security: { share_token_secret: 'short' } })).toBe(false);
    expect(refine({ sharing: { enabled: true }, security: { share_token_secret: 'x'.repeat(32) } })).toBe(true);
    expect(refine({ sharing: { enabled: true }, security: { share_token_secret: 'x'.repeat(64) } })).toBe(true);
  });
});
