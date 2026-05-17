/**
 * Phase 15 / Plan 15-04 / Task 4.3 — bus plugin middleware tests.
 *
 * Verifies:
 *   1. `onPersisted(type, handler)` subscribes via the side-channel
 *      `<type>.envelope` emit so the handler receives the envelope (not just
 *      the payload) and any nested `emit` inside the handler sees
 *      `currentEventId` in ALS.
 *   2. Persistence failures are logged but do NOT throw out of the outer
 *      emit call — sync emit must never be blocked by a DB hiccup.
 */
import { describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { randomUUID } from 'node:crypto';

import { correlationPlugin } from '../../correlation/index.js';
import busPlugin from '../plugin.js';
import type { Envelope } from '../../events/envelope.js';

function stubDbPluginOk() {
  return fp(
    async (fastify: FastifyInstance) => {
      fastify.decorate('db', {
        insert: () => ({
          values: async () => {
            /* ok */
          },
        }),
      } as unknown as FastifyInstance['db']);
    },
    { name: 'db' },
  );
}

function stubDbPluginThrows() {
  return fp(
    async (fastify: FastifyInstance) => {
      fastify.decorate('db', {
        insert: () => ({
          values: async () => {
            throw new Error('simulated DB outage');
          },
        }),
      } as unknown as FastifyInstance['db']);
    },
    { name: 'db' },
  );
}

describe('bus plugin — onPersisted subscriber + causation via side-channel', () => {
  it('delivers the envelope to onPersisted subscribers (not just the payload)', async () => {
    const app = Fastify({ logger: false });
    await app.register(stubDbPluginOk());
    await app.register(correlationPlugin);
    await app.register(busPlugin);
    await app.ready();

    const captured: Envelope[] = [];
    app.onPersisted('demo.happened', (env) => {
      captured.push(env);
    });

    const emitted = app.emit('demo.happened')(randomUUID(), { value: 1 });

    await new Promise((resolve) => setImmediate(resolve));

    expect(captured).toHaveLength(1);
    expect(captured[0].id).toBe(emitted.id);
    expect(captured[0].v).toBe(1);
    // The envelope shape (not the bare payload) reaches the subscriber.
    expect(captured[0].payload).toEqual({ value: 1 });

    await app.close();
  });

  it('causation chain: nested emit inside onPersisted subscriber carries parent id', async () => {
    const app = Fastify({ logger: false });
    await app.register(stubDbPluginOk());
    await app.register(correlationPlugin);
    await app.register(busPlugin);
    await app.ready();

    const captured: Envelope[] = [];
    app.onPersisted('demo.happened', (env) => {
      captured.push(env);
      const nested = app.emit('demo.thinned')(randomUUID(), { id: randomUUID() });
      captured.push(nested);
    });

    const outer = app.emit('demo.happened')(randomUUID(), { value: 2 });
    await new Promise((resolve) => setImmediate(resolve));

    expect(captured).toHaveLength(2);
    expect(captured[1].causationId).toBe(outer.id);

    await app.close();
  });
});

describe('bus plugin — persistence failures are logged, not thrown', () => {
  it('sync emit is NOT blocked by a DB hiccup', async () => {
    // Use silent logger that still lets us spy on error calls via a decorator.
    const app = Fastify({ logger: false });
    await app.register(stubDbPluginThrows());
    await app.register(correlationPlugin);
    await app.register(busPlugin);
    await app.ready();

    const errSpy = vi.spyOn(app.log, 'error').mockImplementation(() => app.log);

    // emit should NOT throw even though the persist write rejects.
    expect(() => app.emit('demo.happened')(randomUUID(), { value: 1 })).not.toThrow();

    // The persist write is async; allow the rejection to surface.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(errSpy).toHaveBeenCalled();
    const callArgs = errSpy.mock.calls[0]?.[0] as { err?: Error } | undefined;
    expect(callArgs?.err?.message).toMatch(/simulated DB outage/);

    await app.close();
  });
});
