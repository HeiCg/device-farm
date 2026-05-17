/**
 * Phase 37 Plan 37-04 Wave 1 Track D — POST /api/sessions/broadcast route.
 *
 * Single thin route registrar that exposes the InputBroadcaster behind a
 * REST endpoint. The web `/sessions/[id]` page uses this to fan out tap
 * events when the user has selected mirror targets via MirrorTargetSelector.
 *
 * The route validates the body via a Zod discriminated union over the
 * three supported action shapes (tap/key/text). Per Pitfall 8 the route
 * does NOT pre-check session existence — the broadcaster's dispatcher
 * surfaces NOT_FOUND in the per-session result so a racy disposes don't
 * become 4xx errors.
 *
 * The route returns 200 + `{results:[{sessionId, ok, error?}]}` for every
 * request that parses (per-session failures are reflected inside the results
 * array, not as HTTP error codes — matches kittyfarm's "continue on error"
 * semantics).
 */
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { InputBroadcaster } from '../jobs/internal/input-broadcaster.js';

// ---------- Zod schemas ----------

const tapTouchSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

const keyEventSchema = z.object({
  key: z.string().min(1).max(50),
  modifiers: z.array(z.string()).optional(),
});

const broadcastActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tap'), touch: tapTouchSchema }),
  z.object({ type: z.literal('key'), event: keyEventSchema }),
  z.object({ type: z.literal('text'), text: z.string().max(1000) }),
]);

export const broadcastBodySchema = z.object({
  sessionIds: z.array(z.string().uuid()).min(1).max(20),
  action: broadcastActionSchema,
});

export type BroadcastBody = z.infer<typeof broadcastBodySchema>;

// ---------- Route registrar ----------

export interface RegisterSessionBroadcastRouteDeps {
  broadcaster: InputBroadcaster;
}

export function registerSessionBroadcastRoute(
  app: FastifyInstance,
  deps: RegisterSessionBroadcastRouteDeps,
): void {
  app.post('/api/sessions/broadcast', async (req, reply) => {
    // Manual Zod parse (no withTypeProvider here — kept lean so the unit
    // spec can mount this on a vanilla Fastify instance without the OpenAPI
    // pipeline). RFC 7807 error response on validation failure.
    const parsed = broadcastBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        type: 'about:blank#invalid-payload',
        title: 'Invalid broadcast payload',
        status: 400,
        detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
    }

    const { sessionIds, action } = parsed.data;
    const results = await deps.broadcaster.broadcast(sessionIds, action);
    return reply.code(200).send({ results });
  });
}
