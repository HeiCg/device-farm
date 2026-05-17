/**
 * Spec for correlation plugin — Phase 15 Plan 03, Task 3.1 (ALS propagation).
 *
 * Proves TRACE-02 (`requestContext.get('correlationId')` works inside a deep service call
 * without threading the id through function parameters).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { requestContext } from '@fastify/request-context';
import { correlationPlugin } from '../index.js';

/** A module-scope helper that mirrors how a "deep service" would look up the id. */
function deep(): string | null {
  const cid = requestContext.get('correlationId');
  return cid ?? null;
}

describe('correlation plugin — ALS propagation', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    await app.register(correlationPlugin);
    app.get('/via-req', async (req) => {
      return { cid: req.requestContext.get('correlationId') ?? null };
    });
    app.get('/via-deep', async () => {
      return { cid: deep() };
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('exposes the correlationId via req.requestContext.get()', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/via-req',
      headers: { 'x-correlation-id': 'cid-route' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ cid: 'cid-route' });
  });

  it('propagates correlationId to a deep service via the top-level requestContext import', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/via-deep',
      headers: { 'x-correlation-id': 'cid-deep' },
    });
    expect(res.statusCode).toBe(200);
    // The deep helper received NO argument yet still sees the id — proves ALS.
    expect(res.json()).toEqual({ cid: 'cid-deep' });
  });
});
