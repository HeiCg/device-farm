/**
 * Sessions REST routes — Phase 34 Plan 34-01.
 *
 * Registers POST /api/sessions, DELETE /api/sessions/:id, GET /api/sessions.
 * All routes chain a local `requireAuth` preHandler (copied verbatim shape
 * from server/jobs/internal/routes.ts:87-104). Per Phase 26 RESEARCH the
 * global bearer-auth hook interferes with WS upgrade — manual chain stays.
 *
 * Request/response Zod schemas live in server/sessions/schemas.ts (shipped
 * Plan 34-00 at substrate). They use `.meta({id: '...'})` so
 * fastify-zod-openapi promotes them into `openapi.json components.schemas`.
 *
 * The route handlers extract the requester actor (`apikey:<keyId>`) from
 * the matched API key row decorated by requireAuth and forward to the
 * sessions module. The Bearer token string is also captured + threaded
 * to `leaseDevice` so the wsUrl response can embed it (Plan 34-02 WS
 * upgrade reads the same `?token=` query param).
 */
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type {
  FastifyZodOpenApiSchema,
  FastifyZodOpenApiTypeProvider,
} from 'fastify-zod-openapi';
import type pino from 'pino';

import type { SessionsModule } from './module.js';
import {
  leaseRequestSchema,
  leaseResponseSchema,
  releaseParamsSchema,
  releaseResponseSchema,
  listResponseSchema,
  type LeaseRequest,
  type ReleaseParams,
} from '../schemas.js';
import type { Actor } from '../../auth/index.js';

// Local querystring schema (not in schemas.ts because it's route-only).
const listQuerySchema = z
  .object({
    status: z.enum(['active', 'released', 'expired']).optional(),
  })
  .meta({ id: 'SessionListQuery' });

interface MatchedApiKeyRowShape {
  id: string;
  name: string;
  claims: Record<string, unknown>;
}

interface AuthDecoratedRequest {
  apiKey?: MatchedApiKeyRowShape;
  bearerToken?: string;
}

export interface RegisterSessionRoutesDeps {
  fastify: FastifyInstance;
  sessionsModule: SessionsModule;
  logger: pino.Logger;
}

export async function registerSessionRoutes(deps: RegisterSessionRoutesDeps): Promise<void> {
  const { fastify, sessionsModule, logger } = deps;
  const log = logger.child({ module: 'sessions.routes' });

  /**
   * Auth gate — extracts Bearer token (or X-API-Key) header, validates via
   * authService.validateKeyAndReturnRow, decorates request.apiKey + stashes
   * the raw token on request.bearerToken so the lease handler can embed
   * it in the response wsUrl.
   */
  const requireAuth = async (
    req: { headers: Record<string, string | undefined> } & AuthDecoratedRequest,
    reply: {
      code: (n: number) => { type: (t: string) => { send: (b: unknown) => void } };
    },
  ): Promise<void> => {
    const authHeader = req.headers.authorization ?? req.headers['x-api-key'];
    const key = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    if (!key) {
      reply.code(401).type('application/problem+json').send({
        type: 'about:blank',
        title: 'Unauthorized',
        status: 401,
        detail: 'missing bearer token',
      });
      return;
    }
    const matched = await fastify.authService?.validateKeyAndReturnRow(key);
    if (!matched) {
      reply.code(401).type('application/problem+json').send({
        type: 'about:blank',
        title: 'Unauthorized',
        status: 401,
        detail: 'invalid bearer token',
      });
      return;
    }
    req.apiKey = matched;
    req.bearerToken = key;
  };

  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().route({
    method: 'POST',
    url: '/api/sessions',
    preHandler: [requireAuth as never],
    schema: {
      body: leaseRequestSchema,
      response: { 200: leaseResponseSchema },
    } satisfies FastifyZodOpenApiSchema,
    handler: async (req) => {
      const ar = req as unknown as AuthDecoratedRequest;
      const apiKey = ar.apiKey;
      if (!apiKey) throw new Error('requireAuth invariant violated: apiKey missing');
      const requesterActor = `apikey:${apiKey.id}` as Actor;
      const bearerToken = ar.bearerToken ?? '';
      return sessionsModule.leaseDevice(req.body as LeaseRequest, requesterActor, bearerToken);
    },
  });

  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().route({
    method: 'DELETE',
    url: '/api/sessions/:id',
    preHandler: [requireAuth as never],
    schema: {
      params: releaseParamsSchema,
      response: { 200: releaseResponseSchema },
    } satisfies FastifyZodOpenApiSchema,
    handler: async (req) => {
      const ar = req as unknown as AuthDecoratedRequest;
      const apiKey = ar.apiKey;
      if (!apiKey) throw new Error('requireAuth invariant violated: apiKey missing');
      const requesterActor = `apikey:${apiKey.id}` as Actor;
      const isAdmin = apiKey.claims?.admin === true;
      const { id } = req.params as ReleaseParams;
      return sessionsModule.releaseDevice(id, requesterActor, isAdmin);
    },
  });

  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().route({
    method: 'GET',
    url: '/api/sessions',
    preHandler: [requireAuth as never],
    schema: {
      querystring: listQuerySchema,
      response: { 200: listResponseSchema },
    } satisfies FastifyZodOpenApiSchema,
    handler: async (req) => {
      const filter = req.query as z.infer<typeof listQuerySchema>;
      return sessionsModule.listSessions(filter);
    },
  });

  log.info('Sessions REST routes registered (POST/DELETE/GET /api/sessions)');
}
