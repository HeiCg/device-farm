/**
 * Telemetry plugin — Phase 15 Plan 03, Task 3.2.
 *
 * Ships the pino `mixin` function (`alsMixin`) that reads correlationId / causationId / actor
 * from the active ALS store, plus a Fastify plugin seam for future metrics decorations.
 *
 * The mixin supports BOTH store shapes used across the codebase:
 *   - Plain object (the shape `@fastify/request-context` writes for HTTP requests)
 *   - `Map<string, unknown>` (the shape the queue wrapper in plan 15-05 will use to restore
 *     ALS on pg-boss worker fibers)
 *
 * IMPORTANT: Wiring the mixin onto the Fastify logger literal (`Fastify({ logger: { mixin } })`)
 * happens in server/index.ts — that edit is deferred to Plan 15-06 (plugin reorder), per the
 * 15-03-PLAN directive. This file only produces `alsMixin` as a consumable function.
 *
 * Satisfies: TRACE-03, MOD-07.
 */
import fp from 'fastify-plugin';
import { asyncLocalStorage } from '@fastify/request-context';

/**
 * Pull a value out of either a `Map` store (queue wrapper path) or an object store
 * (request-context path) without throwing for unknown shapes.
 */
function readStoreValue(store: unknown, key: string): unknown {
  if (!store) return undefined;
  if (store instanceof Map) return store.get(key);
  if (typeof store === 'object') return (store as Record<string, unknown>)[key];
  return undefined;
}

/**
 * Pino mixin: called for EVERY log invocation. Returns fields to merge into the log record.
 * Returns `{}` when no ALS store is active (background intervals, boot-time logs, etc.) —
 * pino then emits the line with no correlation fields.
 */
export const alsMixin = (): Record<string, unknown> => {
  const store = asyncLocalStorage.getStore();
  if (!store) return {};

  const out: Record<string, unknown> = {};
  const cid = readStoreValue(store, 'correlationId');
  const cause = readStoreValue(store, 'currentEventId');
  const actor = readStoreValue(store, 'actor');
  if (cid) out.correlationId = cid;
  if (cause) out.causationId = cause;
  if (actor) out.actor = actor;
  return out;
};

declare module 'fastify' {
  interface FastifyInstance {
    telemetry: { noop: () => void };
  }
}

export default fp(async function telemetryPlugin(fastify) {
  // Seam for future metrics decorations (Phase 19+). Intentionally a no-op today.
  fastify.decorate('telemetry', {
    noop: () => { /* placeholder */ },
  });
}, { name: 'telemetry', dependencies: ['correlation'] });
