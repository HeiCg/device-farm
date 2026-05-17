/**
 * Phase 15 / Plan 15-04 / Task 4.3 — Fastify bus plugin.
 *
 * Decorates the Fastify instance with:
 *   - `bus`          — the TypedBus<demoRegistry> primitive.
 *   - `emit`         — the createEventHelpers return; usage:
 *                      `app.emit('demo.happened')(aggregateId, payload)`.
 *   - `onPersisted`  — subscriber registration that receives the full envelope
 *                      (not just the payload) and sets `currentEventId` into
 *                      ALS before invoking the handler, so nested emits auto-
 *                      populate causationId (TRACE-09).
 *
 * === Envelope-forwarding approach (PINNED — side-channel `<type>.envelope`) ===
 *
 * `bus.on` (and the underlying Node EventEmitter) only carries the payload.
 * `onPersisted` subscribers, however, need the full envelope so they can:
 *   (a) set `currentEventId` into ALS before the handler runs (causation),
 *   (b) eventually access headers / metadata beyond the payload (future use).
 *
 * We forward the envelope via a **side-channel emit** on a parallel event name
 * `<type>.envelope`. When an emit helper stamps an envelope, the plugin's
 * `onEmit` hook fires `<type>.envelope` carrying the envelope, and
 * `onPersisted` listens on this side channel.
 *
 * Rationale (plan-pinned):
 *   - Explicit & greppable: `grep '\.envelope'` finds every side-channel use.
 *   - Does not modify `TypedBus.emit` public shape.
 *   - Avoids a payload-to-envelope reference-map alternative (the rejected
 *     approach tied correctness to JS reference equality across event-loop
 *     boundaries — promise ticks, microtasks, handler copies — which is
 *     fragile and invisible when debugging). See 15-04-PLAN.md rationale.
 *
 * === Persistence ===
 *
 * `persistEnvelope` is called by the emit-helpers `onEmit` hook. It:
 *   1. Fires the side-channel `<type>.envelope` event synchronously so
 *      onPersisted subscribers observe the envelope before the sync emit
 *      returns.
 *   2. Looks up the registry entry; if `persisted: true`, INSERTs into the
 *      `events` table.
 *   3. Fire-and-forgets the DB write (logs errors but does not rethrow).
 *      Sync `emit` must never be blocked by a DB hiccup.
 *
 * Satisfies: EVENTS-01/02/03/04/05/08, SPEC-05/08/10, TRACE-04/08/09.
 */
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { asyncLocalStorage } from '@fastify/request-context';

import { TypedBus } from './bus.js';
import { createEventHelpers } from './helpers.js';
import { demoRegistry, type DemoRegistry } from '../events/registry.js';
import { events as eventsTable } from '../db/schema.js';
import type { Envelope } from '../events/envelope.js';

declare module 'fastify' {
  interface FastifyInstance {
    bus: TypedBus<DemoRegistry>;
    emit: ReturnType<typeof createEventHelpers<DemoRegistry>>;
    onPersisted: <T extends keyof DemoRegistry & string>(
      type: T,
      handler: (envelope: Envelope) => void | Promise<void>,
    ) => () => void;
  }
}

// Helper: access the internal EventEmitter on a TypedBus. The field is
// declared private in bus.ts; we poke through it here because the side-
// channel `<type>.envelope` emit is an implementation detail of this plugin.
function eeOf(bus: TypedBus<DemoRegistry>) {
  return (bus as unknown as { ee: import('node:events').EventEmitter }).ee;
}

export default fp(async function busPlugin(fastify: FastifyInstance) {
  const bus = new TypedBus(demoRegistry);
  const ee = eeOf(bus);

  // Persistence + side-channel middleware. Invoked by the emit helper's
  // `onEmit` hook, it receives the stamped envelope.
  const persistEnvelope = (envelope: Envelope) => {
    // 1. Fire the side-channel `<type>.envelope` event synchronously.
    //    onPersisted subscribers are listening on this channel; they will
    //    receive the envelope on the same call stack as the originating emit.
    ee.emit(`${envelope.type}.envelope`, envelope);

    // 2. Persist — gated on registry flag.
    const entry = demoRegistry[envelope.type as keyof typeof demoRegistry];
    if (!entry || !entry.persisted) return;

    // Fire-and-forget the insert. Sync `emit` must not be blocked by a DB hiccup.
    void (async () => {
      try {
        await fastify.db
          .insert(eventsTable)
          .values({
            id: envelope.id,
            eventType: envelope.type,
            eventVersion: envelope.v,
            correlationId: envelope.correlationId,
            causationId: envelope.causationId ?? undefined,
            aggregateType: envelope.aggregateType,
            aggregateId: envelope.aggregateId,
            payload: envelope.payload as unknown,
            occurredAt: new Date(envelope.occurredAt),
            actor: envelope.actor,
          });
      } catch (err) {
        fastify.log.error({ err, envelope }, 'Failed to persist event');
        // Intentionally do NOT rethrow — persistence is best-effort at the bus layer.
      }
    })();
  };

  const emit = createEventHelpers(bus, persistEnvelope);

  // Subscriber wrapper: binds to the side-channel `<type>.envelope` event and
  // sets `currentEventId` into ALS before invoking the handler. Any nested
  // emit inside the handler picks up `currentEventId` via the emit helper
  // and auto-populates envelope.causationId. TRACE-09.
  const onPersisted: FastifyInstance['onPersisted'] = (type, handler) => {
    const sideChannel = `${type}.envelope`;
    const listener = (envelope: Envelope) => {
      const current = asyncLocalStorage.getStore();
      // Build a Map-shaped child store that carries any existing keys + the
      // `currentEventId` we want to inject. Map-shape is OK here even when the
      // parent is an object — both shape readers (alsMixin, emit helpers) handle
      // Map stores. Using a fresh Map avoids mutating the parent object store.
      const nextStore = new Map<string, unknown>();
      if (current instanceof Map) {
        for (const [k, v] of current) nextStore.set(k, v);
      } else if (current && typeof current === 'object') {
        for (const [k, v] of Object.entries(current)) nextStore.set(k, v);
      }
      nextStore.set('currentEventId', envelope.id);
      asyncLocalStorage.run(nextStore, () => {
        void handler(envelope);
      });
    };
    ee.on(sideChannel, listener);
    return () => ee.off(sideChannel, listener);
  };

  fastify.decorate('bus', bus);
  fastify.decorate('emit', emit);
  fastify.decorate('onPersisted', onPersisted);

  fastify.addHook('onClose', async () => {
    ee.removeAllListeners();
  });
}, { name: 'event-bus', dependencies: ['db', 'correlation'] });
