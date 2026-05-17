/**
 * Phase 37 Plan 37-03 Track C — routes spec.
 *
 * Covers HMAC verify (forged vs valid), missing-header rejection, raw-body
 * capture invariant (Pitfall 1), deferred concurrency surfacing.
 */

import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { sign } from '@octokit/webhooks-methods';
import { registerGithubRoutes } from '../routes.js';
import type { WebhookOutcome } from '../internal/webhook-handler.js';

const fakeLogger: any = { info: () => {}, warn: () => {}, error: () => {}, child: () => fakeLogger };

const SECRET = 'super-secret-shhh';

function makeApp(handleSpy = vi.fn(async (): Promise<WebhookOutcome> => ({ kind: 'triggered', runId: 'r-1' }))) {
  const app = Fastify({ logger: false });
  registerGithubRoutes(app, {
    webhookSecret: SECRET,
    handler: { handle: handleSpy },
    logger: fakeLogger,
  });
  return { app, handleSpy };
}

async function signedHeaders(payload: string) {
  const sig = await sign(SECRET, payload);
  return {
    'x-hub-signature-256': sig,
    'x-github-event': 'pull_request',
    'x-github-delivery': 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    'content-type': 'application/json',
  };
}

describe('POST /api/github/webhooks', () => {
  it('returns 400 when required headers missing', async () => {
    const { app } = makeApp();
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/github/webhooks',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects forged x-hub-signature-256 with 401', async () => {
    const { app, handleSpy } = makeApp();
    await app.ready();
    const payload = JSON.stringify({ action: 'opened' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/github/webhooks',
      headers: {
        'x-hub-signature-256': 'sha256=deadbeef',
        'x-github-event': 'pull_request',
        'x-github-delivery': 'x',
        'content-type': 'application/json',
      },
      payload,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'invalid signature' });
    expect(handleSpy).not.toHaveBeenCalled();
  });

  it('accepts valid signature and returns 200 with outcome', async () => {
    const { app, handleSpy } = makeApp();
    await app.ready();
    const payload = JSON.stringify({ action: 'opened', stuff: 'here' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/github/webhooks',
      headers: await signedHeaders(payload),
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ kind: 'triggered', runId: 'r-1' });
    expect(handleSpy).toHaveBeenCalledOnce();
    // Handler receives PARSED body (not raw buffer)
    const callArgs = (handleSpy.mock.calls[0] ?? []) as unknown[];
    expect(callArgs[1]).toEqual({ action: 'opened', stuff: 'here' });
  });

  it('preserves raw body across HMAC verify (Pitfall 1)', async () => {
    // Two equivalent JSON bodies with different whitespace produce different
    // signatures. The route must verify against the EXACT bytes received,
    // not a re-serialised parse of them.
    const { app } = makeApp();
    await app.ready();

    const compact = '{"key":"value","n":1}';
    const sparse = '{ "key": "value", "n": 1 }';

    const compactRes = await app.inject({
      method: 'POST',
      url: '/api/github/webhooks',
      headers: await signedHeaders(compact),
      payload: compact,
    });
    expect(compactRes.statusCode).toBe(200);

    const sparseRes = await app.inject({
      method: 'POST',
      url: '/api/github/webhooks',
      headers: await signedHeaders(sparse),
      payload: sparse,
    });
    expect(sparseRes.statusCode).toBe(200);

    // Cross signature must fail: signature of `compact` against the bytes of
    // `sparse` is wrong → 401.
    const compactSig = await sign(SECRET, compact);
    const cross = await app.inject({
      method: 'POST',
      url: '/api/github/webhooks',
      headers: {
        'x-hub-signature-256': compactSig,
        'x-github-event': 'pull_request',
        'x-github-delivery': 'x',
        'content-type': 'application/json',
      },
      payload: sparse,
    });
    expect(cross.statusCode).toBe(401);
  });

  it('returns 503 + Retry-After when handler resolves kind=deferred', async () => {
    const deferredSpy = vi.fn(async (): Promise<WebhookOutcome> => ({
      kind: 'deferred',
      message: 'concurrency cap reached, will retry',
    }));
    const { app } = makeApp(deferredSpy);
    await app.ready();
    const payload = JSON.stringify({ action: 'opened' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/github/webhooks',
      headers: await signedHeaders(payload),
      payload,
    });
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('30');
    expect(res.json()).toMatchObject({ kind: 'deferred' });
  });
});
