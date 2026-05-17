import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerAzureRoutes } from '../routes.js';

const fakeLogger: any = { info: () => {}, error: () => {}, warn: () => {}, child: () => fakeLogger };

function makeApp(handleSpy = vi.fn().mockResolvedValue({ kind: 'dispatched', runId: 'r-1' })) {
  const app = Fastify({ logger: false });
  registerAzureRoutes(app, {
    basicAuth: { username: 'u', password: 'p' },
    handler: { handle: handleSpy },
    logger: fakeLogger,
  });
  return { app, handleSpy };
}

describe('POST /api/azure/pr-events', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const { app } = makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/azure/pr-events', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when Basic credentials are wrong', async () => {
    const { app } = makeApp();
    const auth = 'Basic ' + Buffer.from('u:wrong').toString('base64');
    const res = await app.inject({
      method: 'POST',
      url: '/api/azure/pr-events',
      headers: { authorization: auth },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 with outcome when auth is OK', async () => {
    const { app, handleSpy } = makeApp();
    const auth = 'Basic ' + Buffer.from('u:p').toString('base64');
    const res = await app.inject({
      method: 'POST',
      url: '/api/azure/pr-events',
      headers: { authorization: auth },
      payload: { eventType: 'x' },
    });
    expect(res.statusCode).toBe(200);
    expect(handleSpy).toHaveBeenCalledOnce();
    expect(res.json()).toEqual({ kind: 'dispatched', runId: 'r-1' });
  });

  it('returns 503 + Retry-After when handler resolves kind=deferred', async () => {
    const deferredSpy = vi.fn().mockResolvedValue({ kind: 'deferred', message: 'concurrency cap reached, will retry' });
    const { app } = makeApp(deferredSpy);
    const auth = 'Basic ' + Buffer.from('u:p').toString('base64');
    const res = await app.inject({
      method: 'POST',
      url: '/api/azure/pr-events',
      headers: { authorization: auth },
      payload: { eventType: 'git.pullrequest.updated' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('30');
    expect(res.json()).toMatchObject({ kind: 'deferred' });
  });
});
