/**
 * Phase 37 Plan 37-03 Track C — GitHub webhook route.
 *
 * POST /api/github/webhooks
 *
 *   - Raw body MUST be captured pre-JSON-parse for HMAC verification
 *     (Pitfall 1 in 37-RESEARCH.md: Fastify's default JSON parser destroys
 *     the bytes GitHub signed). We register a custom parser scoped to a
 *     Fastify child context so we do not collide with the global JSON parser
 *     used by every other route.
 *   - Signature verification uses @octokit/webhooks-methods.verify — its
 *     constant-time HMAC comparison closes the timing-attack hole of
 *     manual `===` compare.
 *   - 400 on missing required headers (signature, event, delivery)
 *   - 401 on signature mismatch
 *   - 200 + outcome envelope on success
 *   - 503 + Retry-After on concurrency-deferred outcome
 */

import type { FastifyInstance } from 'fastify';
import type pino from 'pino';
import { verify } from '@octokit/webhooks-methods';
import type { GithubWebhookHandler } from './internal/webhook-handler.js';

export interface GithubRoutesDeps {
  webhookSecret: string;
  handler: GithubWebhookHandler;
  logger: pino.Logger;
}

interface RawJsonBody {
  __raw: Buffer;
  __parsed: unknown;
}

export function registerGithubRoutes(
  app: FastifyInstance,
  deps: GithubRoutesDeps,
): void {
  app.register(async (scope) => {
    // CRITICAL Pitfall 1 — capture raw bytes BEFORE JSON.parse so the
    // signature GitHub computed over the wire matches what we verify.
    // Scoped via `register(async scope => ...)` so this content-type parser
    // does not shadow the global parser used by /api/jobs etc.
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
      const buf = body as Buffer;
      try {
        const parsed = JSON.parse(buf.toString('utf8'));
        done(null, { __raw: buf, __parsed: parsed } satisfies RawJsonBody);
      } catch (err) {
        done(err as Error, undefined);
      }
    });

    scope.post('/api/github/webhooks', async (req, reply) => {
      const sig = req.headers['x-hub-signature-256'] as string | undefined;
      const event = req.headers['x-github-event'] as string | undefined;
      const delivery = req.headers['x-github-delivery'] as string | undefined;

      if (!sig || !event || !delivery) {
        reply.code(400);
        return { error: 'missing required headers' };
      }

      const body = req.body as RawJsonBody | undefined;
      if (!body || !body.__raw) {
        reply.code(400);
        return { error: 'missing body' };
      }

      const ok = await verify(deps.webhookSecret, body.__raw.toString('utf8'), sig);
      if (!ok) {
        deps.logger.warn({ event, delivery }, 'github webhook: invalid signature');
        reply.code(401);
        return { error: 'invalid signature' };
      }

      const outcome = await deps.handler.handle(event, body.__parsed);
      if (outcome.kind === 'deferred') {
        reply.code(503);
        reply.header('Retry-After', '30');
        return outcome;
      }
      reply.code(200);
      return outcome;
    });
  });
}
