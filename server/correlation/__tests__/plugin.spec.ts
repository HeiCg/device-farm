/**
 * Spec for correlation plugin — Phase 15 Plan 03, Task 3.1.
 *
 * Proves TRACE-01 (read/generate/echo X-Correlation-Id) by round-tripping headers through
 * a live Fastify instance built around the correlation plugin.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { correlationPlugin } from '../index.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('correlation plugin — X-Correlation-Id header handling', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    await app.register(correlationPlugin);
    app.get('/ping', async () => ({ ok: true }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('generates a UUID when no X-Correlation-Id header is present and echoes it back', async () => {
    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.statusCode).toBe(200);
    const echoed = res.headers['x-correlation-id'];
    expect(typeof echoed).toBe('string');
    expect(echoed).toMatch(UUID_RE);
  });

  it('reuses the incoming X-Correlation-Id header value and echoes it back verbatim', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { 'x-correlation-id': 'test-cid-123' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-correlation-id']).toBe('test-cid-123');
  });

  it('replaces an overlong header value (>=128 chars) with a generated UUID', async () => {
    const overlong = 'x'.repeat(200);
    const res = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { 'x-correlation-id': overlong },
    });
    expect(res.statusCode).toBe(200);
    const echoed = res.headers['x-correlation-id'];
    expect(echoed).not.toBe(overlong);
    expect(echoed).toMatch(UUID_RE);
  });

  it('replaces a header containing non-printable ASCII with a generated UUID', async () => {
    const dirty = 'abc\u0000xyz';
    const res = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { 'x-correlation-id': dirty },
    });
    expect(res.statusCode).toBe(200);
    const echoed = res.headers['x-correlation-id'];
    expect(echoed).not.toBe(dirty);
    expect(echoed).toMatch(UUID_RE);
  });
});
