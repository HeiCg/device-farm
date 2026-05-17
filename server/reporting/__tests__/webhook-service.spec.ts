/**
 * Phase 19 / Plan 19-02 — WebhookService.deliverOnce spec (SC1 unit-layer).
 *
 * The old `deliver(url, payload)` in-process retry loop is deleted; pg-boss
 * now owns retry policy (webhook.deliver queue with retryLimit:5 +
 * retryBackoff:true — plan 19-03). This spec proves deliverOnce:
 *   - Single-attempt (NO retry-loop inside this method).
 *   - 2xx resolves.
 *   - 4xx resolves without throwing (non-retryable — logged as warn).
 *   - 5xx throws (so pg-boss counts the attempt + retries OR routes to DLQ).
 *   - Network error throws.
 *   - HMAC signing still works.
 *   - Timeout still fires via AbortSignal.
 *
 * No DB, no pg-boss — all tests use the shared failing-HTTP-server fixture
 * `startFailingServer` (plan 19-00 Task 0.6) which binds an ephemeral
 * http.Server on port 0 and exposes .setResponse / .requestCount / etc.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pino from 'pino';

import { WebhookService } from '../webhook-service.js';
import { startFailingServer, type FailingServerHandle } from './fixtures/failing-server.js';

/**
 * Silent pino logger for test output cleanliness.
 * Log-assertion tests can swap this for a pino instance with a write stream
 * collector if log assertions become load-bearing.
 */
function makeLogger(): pino.Logger {
  return pino({ level: 'silent' });
}

describe('WebhookService.deliverOnce (Phase 19-02)', () => {
  let ts: FailingServerHandle;

  beforeAll(async () => {
    // Default 200/ok; per-test setResponse overrides between tests.
    ts = await startFailingServer({ defaultResponse: { status: 200, body: 'ok' } });
  });

  afterAll(async () => {
    await ts.close();
  });

  afterEach(() => {
    // Reset default response between tests so ordering doesn't matter.
    ts.setResponse({ status: 200, body: 'ok' });
  });

  // ========== 2xx resolves ==========

  it('resolves on 200 OK after exactly ONE fetch call', async () => {
    const svc = new WebhookService(makeLogger());
    ts.setResponse({ status: 200, body: 'ok' });
    const countBefore = ts.requestCount();

    await expect(svc.deliverOnce(ts.url, { event: 'job.completed' })).resolves.toBeUndefined();

    expect(ts.requestCount() - countBefore).toBe(1); // single-attempt invariant
  });

  it('resolves on 201 Created', async () => {
    const svc = new WebhookService(makeLogger());
    ts.setResponse({ status: 201 });
    await expect(svc.deliverOnce(ts.url, {})).resolves.toBeUndefined();
  });

  it('resolves on 204 No Content', async () => {
    const svc = new WebhookService(makeLogger());
    ts.setResponse({ status: 204 });
    await expect(svc.deliverOnce(ts.url, {})).resolves.toBeUndefined();
  });

  // ========== 4xx resolves (non-retryable) ==========

  it('resolves WITHOUT throwing on 400 Bad Request', async () => {
    const svc = new WebhookService(makeLogger());
    ts.setResponse({ status: 400, body: 'bad' });
    const countBefore = ts.requestCount();

    await expect(svc.deliverOnce(ts.url, {})).resolves.toBeUndefined();

    expect(ts.requestCount() - countBefore).toBe(1); // still single-attempt
  });

  it('resolves WITHOUT throwing on 404 Not Found', async () => {
    const svc = new WebhookService(makeLogger());
    ts.setResponse({ status: 404 });
    await expect(svc.deliverOnce(ts.url, {})).resolves.toBeUndefined();
  });

  it('resolves WITHOUT throwing on 422 Unprocessable Entity', async () => {
    const svc = new WebhookService(makeLogger());
    ts.setResponse({ status: 422 });
    await expect(svc.deliverOnce(ts.url, {})).resolves.toBeUndefined();
  });

  // ========== 5xx throws (so pg-boss retries) ==========

  it('throws on 500 Internal Server Error; error message contains HTTP status', async () => {
    const svc = new WebhookService(makeLogger());
    ts.setResponse({ status: 500, body: 'nope' });
    const countBefore = ts.requestCount();

    await expect(svc.deliverOnce(ts.url, {})).rejects.toThrow(/HTTP 500/);

    expect(ts.requestCount() - countBefore).toBe(1);
  });

  it('throws on 502 Bad Gateway', async () => {
    const svc = new WebhookService(makeLogger());
    ts.setResponse({ status: 502 });
    await expect(svc.deliverOnce(ts.url, {})).rejects.toThrow(/HTTP 502/);
  });

  it('throws on 503 Service Unavailable', async () => {
    const svc = new WebhookService(makeLogger());
    ts.setResponse({ status: 503 });
    await expect(svc.deliverOnce(ts.url, {})).rejects.toThrow(/HTTP 503/);
  });

  // ========== Network error throws ==========

  it('throws on network error (unreachable port)', async () => {
    const svc = new WebhookService(makeLogger());
    // Port 1 is reserved / refused on loopback.
    const unreachable = 'http://127.0.0.1:1/hook';
    await expect(svc.deliverOnce(unreachable, {})).rejects.toThrow();
  });

  // ========== HMAC signing ==========

  it('sends X-Signature-256 header when secret is configured', async () => {
    // Runtime-generated secret — no hardcoded credential in source. Generated
    // fresh per-test so semgrep's hardcoded-hmac-key scanner recognises the
    // randomness source.
    // nosemgrep: javascript.lang.security.audit.hmac-hardcoded-secret
    const secret: string = randomBytes(16).toString('hex');
    const svc = new WebhookService(makeLogger(), { secret });
    ts.setResponse({ status: 200 });

    const payload = { event: 'job.completed', jobId: 'abc' };
    const body = JSON.stringify(payload);
    // nosemgrep: javascript.lang.security.audit.hmac-hardcoded-secret
    const expectedSig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

    await svc.deliverOnce(ts.url, payload);

    expect(ts.lastHeaders()['x-signature-256']).toBe(expectedSig);
    expect(ts.lastBody()).toBe(body);
  });

  it('does NOT send X-Signature-256 header when secret is NOT configured', async () => {
    const svc = new WebhookService(makeLogger(), {});
    ts.setResponse({ status: 200 });

    await svc.deliverOnce(ts.url, { event: 'job.completed' });

    expect(ts.lastHeaders()['x-signature-256']).toBeUndefined();
  });

  // ========== Content-Type ==========

  it('always sends Content-Type: application/json', async () => {
    const svc = new WebhookService(makeLogger());
    ts.setResponse({ status: 200 });

    await svc.deliverOnce(ts.url, { foo: 'bar' });

    expect(ts.lastHeaders()['content-type']).toBe('application/json');
  });

  // ========== Timeout ==========

  it(
    'throws when target hangs longer than timeout_ms',
    async () => {
      const svc = new WebhookService(makeLogger(), { timeout_ms: 100 });
      ts.setResponse({ status: 200, hangMs: 2_000 });
      await expect(svc.deliverOnce(ts.url, {})).rejects.toThrow();
    },
    10_000 /* per-test timeout — AbortSignal should trip long before */,
  );
});
