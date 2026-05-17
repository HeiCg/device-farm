import type { FastifyInstance } from 'fastify';
import type pino from 'pino';
import type { WebhookOutcome } from './internal/webhook-handler.js';

export interface AzureRoutesDeps {
  basicAuth: { username: string; password: string };
  handler: { handle(body: unknown): Promise<WebhookOutcome> };
  logger: pino.Logger;
}

function checkBasic(
  header: string | undefined,
  expected: { username: string; password: string },
): boolean {
  if (!header || !header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  if (i < 0) return false;
  return decoded.slice(0, i) === expected.username && decoded.slice(i + 1) === expected.password;
}

export function registerAzureRoutes(app: FastifyInstance, deps: AzureRoutesDeps): void {
  app.post('/api/azure/pr-events', async (req, reply) => {
    const auth = req.headers.authorization;
    if (!checkBasic(auth, deps.basicAuth)) {
      reply.code(401);
      return { error: 'unauthorized' };
    }
    const outcome = await deps.handler.handle(req.body);
    if (outcome.kind === 'deferred') {
      reply.code(503);
      reply.header('Retry-After', '30');
      return outcome;
    }
    reply.code(200);
    return outcome;
  });
}
