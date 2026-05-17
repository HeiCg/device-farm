/**
 * Correlation plugin — Phase 15 Plan 03, Task 3.1.
 *
 * Registers `@fastify/request-context` (ALS fiber per HTTP request) and installs an `onRequest`
 * hook that reads or generates the `X-Correlation-Id` header, stores it in ALS, and echoes it
 * back on the response.
 *
 * Satisfies: TRACE-01 (read/generate/echo), TRACE-02 (ALS propagation).
 *
 * NOTE: This plugin does NOT wire the pino mixin — that responsibility lives in
 * `server/telemetry/plugin.ts` (Task 3.2) and in `server/index.ts` (deferred to Plan 15-06).
 */
import fp from 'fastify-plugin';
import fastifyRequestContext from '@fastify/request-context';
import { randomUUID } from 'node:crypto';

/**
 * Declare the shape of the request-context store. Extends the module augmentation exported by
 * `@fastify/request-context` so `req.requestContext.get('correlationId')` is typed as
 * `string | null | undefined` across the codebase.
 */
declare module '@fastify/request-context' {
  interface RequestContextData {
    correlationId: string | null;
    currentEventId: string | null;
    actor: string;
  }
}

/** Max accepted length of an inbound X-Correlation-Id header (prevents log pollution). */
const MAX_HEADER_LEN = 128;

/** Printable ASCII range (space through tilde). Rejects NULs, control chars, non-ASCII. */
const PRINTABLE_ASCII = /^[\x20-\x7E]+$/;

export default fp(async function correlationPlugin(fastify) {
  await fastify.register(fastifyRequestContext, {
    hook: 'onRequest',
    defaultStoreValues: {
      correlationId: null,
      currentEventId: null,
      // Phase 26 / Plan 26-05 TRACE-10 migration: default request-context
      // actor is 'system' (NOT 'anonymous' — anonymous fails actorSchema
      // regex and downstream Zod parse would reject. Bearer-auth callback
      // overrides this to `apikey:{id}` on successful auth; unauthenticated
      // requests inherit the 'system' fallback). Matches the
      // server/bus/helpers.ts:100 fallback shape.
      actor: 'system',
    },
  });

  fastify.addHook('onRequest', async (req, reply) => {
    const raw = req.headers['x-correlation-id'];
    const ok =
      typeof raw === 'string' &&
      raw.length > 0 &&
      raw.length < MAX_HEADER_LEN &&
      PRINTABLE_ASCII.test(raw);
    const correlationId = ok ? raw : randomUUID();
    req.requestContext.set('correlationId', correlationId);
    reply.header('x-correlation-id', correlationId);
  });
}, { name: 'correlation', dependencies: [] });
