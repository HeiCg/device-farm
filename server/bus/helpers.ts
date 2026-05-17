/**
 * Phase 15 / Plan 15-04 / Task 4.2 — createEventHelpers factory.
 *
 * Every module's `events.ts` uses this factory to expose a strongly-typed
 * emit function per event type. The helper:
 *
 *   1. Looks up the registry entry for the given type (errors on unknown).
 *   2. Stamps a full envelope:
 *        - id       → fresh randomUUID()
 *        - v        → 1 (SPEC-10)
 *        - correlationId → from ALS `requestContext.get('correlationId')`;
 *          falls back to a fresh UUID when outside any fiber.
 *        - causationId  → from ALS `requestContext.get('currentEventId')`;
 *          null if there is no parent event (this is the chain root).
 *          The subscriber wrapper in the bus plugin (Task 4.3) sets this
 *          into the ALS store before invoking each handler, so nested
 *          emits auto-populate causationId without threading.
 *        - actor    → explicit opts.actor > ALS 'actor' > 'system'.
 *          Phase 26 / Plan 26-02 / TRACE-10: fallback default migrated
 *          to the system actor so events emitted outside any HTTP/queue
 *          fiber inherit the boot-time/system actor. The runtime ALS default
 *          on HTTP requests still ships the legacy default (see
 *          server/correlation/plugin.ts defaultStoreValues) until Plan 26-03
 *          wires the bearer-auth callback.
 *        - aggregateType → registry entry (if set) > first dotted segment.
 *   3. Validates the envelope via `envelopeSchema.parse(...)`.
 *   4. Emits via `bus.emit(type, payload)` (which runtime-validates the
 *      payload against the registry schema).
 *   5. Invokes the optional `onEmit` hook with the stamped envelope. The
 *      bus plugin wires this hook to persistence + side-channel envelope
 *      emits for onPersisted subscribers.
 *   6. Returns the envelope so tests (and rare producers that need the
 *      generated id) can inspect it.
 *
 * Contract: callers NEVER thread correlationId / causationId / actor.
 * That is the whole point of the factory — see TRACE-04 and TRACE-09.
 */
import { randomUUID } from 'node:crypto';
import { asyncLocalStorage } from '@fastify/request-context';

import { envelopeSchema, type Envelope } from '../events/envelope.js';
import type { TypedBus } from './bus.js';
import type { EventRegistry, PayloadOf } from './types.js';

export interface EmitOpts {
  actor?: string;
}

/**
 * Safely read a string from ALS across BOTH store shapes used in the codebase.
 *
 * Behaviour-equivalent to `requestContext.get('correlationId')` — reads the
 * correlationId (or causationId, actor) from the ambient ALS fiber — but
 * works with BOTH store shapes:
 *
 *   - Plain object — what `@fastify/request-context` v6 writes for HTTP
 *     requests (see node_modules/@fastify/request-context/index.js:
 *     `asyncLocalStorage.run({ ...defaultStoreValues }, ...)`). `requestContext.get`
 *     handles this shape directly.
 *   - `Map<string, unknown>` — what the queue wrapper (plan 15-05) uses to
 *     restore ALS on pg-boss worker fibers (research §3:
 *     `asyncLocalStorage.run(new Map([['correlationId', cid]]), ...)`).
 *     `requestContext.get` returns `undefined` for this shape because it uses
 *     `store[key]`, which a Map does not honour.
 *
 * This mirrors `alsMixin` in server/telemetry/plugin.ts which has the same
 * dual-shape requirement. We go through `asyncLocalStorage` (the raw primitive)
 * rather than `requestContext.get` to keep both code paths working through one
 * helper.
 */
export function readAls(key: 'correlationId' | 'currentEventId' | 'actor'): string | null {
  const store = asyncLocalStorage.getStore();
  if (!store) return null;
  let raw: unknown;
  if (store instanceof Map) {
    raw = store.get(key);
  } else if (typeof store === 'object') {
    raw = (store as Record<string, unknown>)[key];
  } else {
    return null;
  }
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

export function createEventHelpers<R extends EventRegistry>(
  bus: TypedBus<R>,
  onEmit?: (envelope: Envelope) => void,
) {
  return <T extends keyof R & string>(type: T) =>
    (
      aggregateId: string,
      payload: PayloadOf<R, T>,
      opts: EmitOpts = {},
    ): Envelope => {
      const entry = bus.registry[type];
      if (!entry) throw new Error(`Unknown event type: ${String(type)}`);

      const correlationId = readAls('correlationId') ?? randomUUID();
      const causationId = readAls('currentEventId');
      const actor = opts.actor ?? readAls('actor') ?? 'system';
      const aggregateType = entry.aggregateType ?? type.split('.')[0];

      const envelope = envelopeSchema.parse({
        id: randomUUID(),
        type,
        v: 1,
        correlationId,
        causationId,
        occurredAt: new Date().toISOString(),
        aggregateType,
        aggregateId,
        actor,
        payload,
      });

      bus.emit(type, payload);
      onEmit?.(envelope);
      return envelope;
    };
}
