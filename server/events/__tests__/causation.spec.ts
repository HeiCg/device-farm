/**
 * Phase 15 / Plan 15-04 / Task 4.3 — causation chain via ALS.
 *
 * Pure in-memory test (no DB): emit A; a subscriber (registered via
 * `onPersisted`, which wraps via the side-channel `<type>.envelope` emit)
 * handles A and emits B inside its handler. Because the wrapper sets
 * `currentEventId` in ALS before invoking the handler, B's envelope
 * auto-carries `causationId === A.id`.
 *
 * Satisfies TRACE-09.
 */
import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { randomUUID } from 'node:crypto';

import { correlationPlugin } from '../../correlation/index.js';
import busPlugin from '../../bus/plugin.js';
import type { Envelope } from '../envelope.js';

// Stub `db` plugin so busPlugin's dependency check passes. The causation
// test does not touch DB — the persist middleware's try/catch handles any
// write failure independently.
const stubDbPlugin = fp(
  async (fastify: FastifyInstance) => {
    fastify.decorate('db', {
      insert: () => ({
        values: async () => {
          /* no-op */
        },
      }),
    } as unknown as FastifyInstance['db']);
  },
  { name: 'db' },
);

describe('causation chain (TRACE-09)', () => {
  let app: FastifyInstance;

  it('nested emit inside a subscriber carries parent envelope id as causationId', async () => {
    app = Fastify({ logger: false });
    await app.register(stubDbPlugin);
    await app.register(correlationPlugin);
    await app.register(busPlugin);
    await app.ready();

    const capturedEnvelopes: Envelope[] = [];

    // Subscriber handles demo.happened and emits demo.thinned inside.
    app.onPersisted('demo.happened', (env) => {
      capturedEnvelopes.push(env);
      // Nested emit — should auto-populate causationId === env.id via ALS.
      const nested = app.emit('demo.thinned')(randomUUID(), { id: randomUUID() });
      capturedEnvelopes.push(nested);
    });

    // Fire the outer event — `emit` is the createEventHelpers return;
    // shape is `emit(type)(aggregateId, payload, opts?)`.
    const outer = app.emit('demo.happened')(randomUUID(), { value: 1 });

    // Allow any microtasks the subscriber scheduled to drain.
    await new Promise((resolve) => setImmediate(resolve));

    // capturedEnvelopes[0] = outer envelope as received by the onPersisted listener
    // capturedEnvelopes[1] = nested envelope emitted inside the subscriber
    expect(capturedEnvelopes).toHaveLength(2);
    expect(capturedEnvelopes[0].id).toBe(outer.id);
    expect(capturedEnvelopes[1].causationId).toBe(outer.id);

    await app.close();
  });
});
