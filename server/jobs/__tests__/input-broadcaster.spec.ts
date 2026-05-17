/**
 * Phase 37 Plan 37-04 Wave 1 — InputBroadcaster spec.
 *
 * Covers per Pattern 4 (37-RESEARCH.md):
 *   - fan-out latency < 100ms for 3 sessions each delaying 30ms (parallel,
 *     not serial — serial would be 90ms+)
 *   - partial failure surfaces per-session error; successful sends preserved
 *   - preservation regression guard (no rollback logic)
 *   - POST /api/sessions/broadcast wired through plugin (proves
 *     registerSessionBroadcastRoute is reachable on the running server)
 */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { createInputBroadcaster, type SessionDispatcher } from '../internal/input-broadcaster.js';
import { registerSessionBroadcastRoute } from '../../api/sessions.js';

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => makeLogger(),
  } as unknown as import('pino').Logger;
}

function makeDispatcher(behavior: Record<string, () => Promise<void>>): SessionDispatcher & { dispatch: ReturnType<typeof vi.fn> } {
  const dispatch = vi.fn(async (id: string, _action: unknown): Promise<void> => {
    const fn = behavior[id];
    if (!fn) throw new Error(`session ${id} not found`);
    await fn();
  });
  return { dispatch } as never;
}

describe('input broadcaster', () => {
  it('fans out tap to 3 sessions within 100ms', async () => {
    const delay = (ms: number): Promise<void> => new Promise<void>((r) => { setTimeout(() => r(), ms); });
    const dispatcher = makeDispatcher({
      s1: () => delay(30),
      s2: () => delay(30),
      s3: () => delay(30),
    });
    const br = createInputBroadcaster({ dispatcher, logger: makeLogger() });

    const start = Date.now();
    const results = await br.broadcast(['s1', 's2', 's3'], {
      type: 'tap',
      touch: { x: 0.5, y: 0.5 },
    });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(100); // parallel — serial would be 90ms+
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(3);
  });

  it('partial failure surfaces per-session error', async () => {
    const dispatcher = makeDispatcher({
      s1: () => Promise.resolve(),
      s2: () => Promise.reject(new Error('session not found')),
      s3: () => Promise.resolve(),
    });
    const br = createInputBroadcaster({ dispatcher, logger: makeLogger() });

    const results = await br.broadcast(['s1', 's2', 's3'], {
      type: 'tap',
      touch: { x: 0.1, y: 0.2 },
    });

    expect(results[0]).toEqual({ sessionId: 's1', ok: true });
    expect(results[1]).toMatchObject({
      sessionId: 's2',
      ok: false,
      error: expect.stringContaining('session not found'),
    });
    expect(results[2]).toEqual({ sessionId: 's3', ok: true });
  });

  it('successful sends preserved on partial failure (no rollback)', async () => {
    // Regression guard: if any future change introduces rollback logic, this
    // test fails. The ok:true entries must remain ok:true even when sibling
    // dispatches fail. Asserts all 3 mock dispatches WERE called (not just
    // first 2 — i.e. failure of s1 does NOT short-circuit s2/s3).
    const dispatcher = makeDispatcher({
      s1: () => Promise.reject(new Error('boom')),
      s2: () => Promise.resolve(),
      s3: () => Promise.resolve(),
    });
    const br = createInputBroadcaster({ dispatcher, logger: makeLogger() });

    const results = await br.broadcast(['s1', 's2', 's3'], {
      type: 'text',
      text: 'hello',
    });

    expect(results[0].ok).toBe(false);
    expect(results[1]).toEqual({ sessionId: 's2', ok: true });
    expect(results[2]).toEqual({ sessionId: 's3', ok: true });
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(3);
  });

  it('POST /api/sessions/broadcast is registered (proves plugin wiring)', async () => {
    // Construct a real broadcaster + register the route on a test Fastify
    // instance. Asserting response.statusCode !== 404 proves the route is
    // mounted; 200 (or 400 for invalid payload) means the handler ran.
    const dispatcher = makeDispatcher({
      '11111111-1111-4111-8111-111111111111': () => Promise.resolve(),
      '22222222-2222-4222-8222-222222222222': () => Promise.resolve(),
    });
    const broadcaster = createInputBroadcaster({ dispatcher, logger: makeLogger() });

    const app = Fastify({ logger: false });
    registerSessionBroadcastRoute(app, { broadcaster });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/broadcast',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        sessionIds: [
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
        ],
        action: { type: 'tap', touch: { x: 0.5, y: 0.5 } },
      }),
    });

    expect(response.statusCode).not.toBe(404); // route exists
    if (response.statusCode !== 200) {
      // Surface body to make debugging trivial.
      console.error('broadcast 200-check failed body:', response.body);
    }
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.results).toHaveLength(2);
    expect(body.results[0]).toEqual({
      sessionId: '11111111-1111-4111-8111-111111111111',
      ok: true,
    });

    await app.close();
  });

  it('POST /api/sessions/broadcast rejects invalid payload with 400', async () => {
    const dispatcher = makeDispatcher({});
    const broadcaster = createInputBroadcaster({ dispatcher, logger: makeLogger() });

    const app = Fastify({ logger: false });
    registerSessionBroadcastRoute(app, { broadcaster });
    await app.ready();

    // Missing `action.type` field → schema rejects with 400.
    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/broadcast',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        sessionIds: ['11111111-1111-4111-8111-111111111111'],
        action: { touch: { x: 0.5, y: 0.5 } }, // missing type
      }),
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
