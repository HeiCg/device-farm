/**
 * Auth module — requireAdmin preHandler middleware (Phase 26 Plan 26-03).
 *
 * Resolves DEFERRED-23-A. Asserts the matched apiKey carries
 * `claims.admin === true`. Use as a Fastify preHandler:
 *
 *   fastify.route({ ..., preHandler: [requireAuth, requireAdmin], ... });
 *
 * Depends on `request.apiKey` being decorated by the auth gate
 * (server/auth/plugin.ts bearer-auth callback). Defensive against missing
 * apiKey / missing claims / claims.admin !== true (Pitfall 5 — existing
 * api_keys rows are backfilled to claims:'{}' via migration 0026).
 *
 * Emits RFC 7807 problem+json 403 on failure (NOT next() — preHandler that
 * calls reply.send terminates the request lifecycle).
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

export async function requireAdmin(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const apiKey = (req as { apiKey?: { claims?: Record<string, unknown> } }).apiKey;
  if (apiKey?.claims?.admin !== true) {
    await reply
      .code(403)
      .type('application/problem+json')
      .send({
        type: 'about:blank',
        title: 'Forbidden',
        status: 403,
        detail: 'admin claim required',
      });
    // No return value needed — reply.send terminates the request. Fastify
    // treats preHandler resolution-after-send as "handled here".
  }
}
