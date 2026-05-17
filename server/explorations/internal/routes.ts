/**
 * Explorations REST routes — Phase 35 Plan 35-01.
 *
 * Registers:
 *   - POST   /api/explorations         create + lease + enqueue
 *   - GET    /api/explorations/:id     full graph (exploration + screens + transitions)
 *   - DELETE /api/explorations/:id     soft-cancel (status='cancelled' iff running)
 *
 * All routes chain a local `requireAuth` preHandler (verbatim shape from
 * server/sessions/internal/routes.ts:73-102 and server/jobs/internal/routes.ts).
 * Phase 26 auth disabled → requireAuth still gates because the local impl
 * checks `fastify.authService?.validateKeyAndReturnRow`, which short-circuits
 * to null when authService is undefined (returning 401). Tests inject a stub
 * authService to bypass.
 *
 * Sessions integration is OPTIONAL: when `fastify.sessionsModule.leaseDevice`
 * is available (Phase 34 shipped), the POST handler leases a session for
 * `body.budgetSeconds + 60` TTL. Otherwise it falls back to direct pool
 * allocation and uses a sentinel sessionId (Phase 34 backfill will repair).
 *
 * The agent runner is NOT invoked here — Plan 35-02 owns the worker. POST
 * returns the runId immediately after row INSERT + enqueueRun.
 */
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type {
  FastifyZodOpenApiSchema,
  FastifyZodOpenApiTypeProvider,
} from 'fastify-zod-openapi';
import type pino from 'pino';

import {
  startRequestSchema,
  startResponseSchema,
  getResponseSchema,
  listResponseSchema,
  type ExplorationStartRequest,
} from '../schemas.js';
import * as repo from './repo.js';
import { buildReport } from './report.js';

const idParamsSchema = z
  .object({ id: z.string().uuid() })
  .meta({ id: 'ExplorationIdParams' });

const problemJsonSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string().optional(),
  })
  .meta({ id: 'ExplorationsProblemJson' });

interface MatchedApiKeyRowShape {
  id: string;
  name: string;
  claims?: Record<string, unknown>;
}

interface AuthDecoratedRequest {
  apiKey?: MatchedApiKeyRowShape;
  bearerToken?: string;
}

export interface RegisterExplorationRoutesDeps {
  fastify: FastifyInstance;
  logger?: pino.Logger;
}

export async function registerExplorationRoutes(
  deps: RegisterExplorationRoutesDeps,
): Promise<void> {
  const { fastify } = deps;
  const log = (deps.logger ?? (fastify.log as unknown as pino.Logger)).child({
    module: 'explorations.routes',
  });

  /**
   * Auth gate (verbatim shape from sessions/internal/routes.ts).
   *
   * NOT requireAdmin — explorations are user-facing. Any-valid-key gate.
   * Returns 401 RFC 7807 on missing/invalid bearer.
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
    const authService = (fastify as FastifyInstance & {
      authService?: {
        validateKeyAndReturnRow: (k: string) => Promise<MatchedApiKeyRowShape | null>;
      };
    }).authService;
    const matched = await authService?.validateKeyAndReturnRow(key);
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

  // ---------- POST /api/explorations ----------
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().route({
    method: 'POST',
    url: '/api/explorations',
    preHandler: [requireAuth as never],
    schema: {
      body: startRequestSchema,
      response: { 201: startResponseSchema, 401: problemJsonSchema, 503: problemJsonSchema },
    } satisfies FastifyZodOpenApiSchema,
    handler: async (req, reply) => {
      const body = req.body as ExplorationStartRequest;
      const ar = req as unknown as AuthDecoratedRequest;
      const apiKey = ar.apiKey;

      // Lease a session via Phase 34 sessions module when present; else
      // fall back to direct pool allocation + sentinel sessionId.
      type SessionsModuleShape = {
        leaseDevice?: (
          input: { platform: 'android' | 'ios'; ttlSeconds: number },
          requesterActor: string,
          bearerToken: string,
        ) => Promise<{ sessionId: string; deviceId: string }>;
      };
      const sessionsModule = (fastify as FastifyInstance & {
        sessionsModule?: SessionsModuleShape;
      }).sessionsModule;

      let sessionId: string;
      let deviceId: string;

      const requesterActor = apiKey ? `apikey:${apiKey.id}` : 'system';
      const bearerToken = ar.bearerToken ?? '';

      if (sessionsModule?.leaseDevice) {
        try {
          const lease = await sessionsModule.leaseDevice(
            { platform: body.platform, ttlSeconds: body.budgetSeconds + 60 },
            requesterActor,
            bearerToken,
          );
          sessionId = lease.sessionId;
          deviceId = lease.deviceId;
        } catch (err) {
          const e = err as { statusCode?: number; code?: string; message?: string };
          if (e.statusCode === 503) {
            return reply
              .code(503)
              .type('application/problem+json')
              .send({
                type: 'about:blank',
                title: 'Service Unavailable',
                status: 503,
                detail:
                  e.message ?? `no idle ${body.platform} device available for exploration`,
              });
          }
          throw err;
        }
      } else {
        // Fallback: direct pool allocation. Generate a synthetic sessionId
        // (zero-uuid sentinel) so the FK to sessions.id can be backfilled
        // by Phase 34 once it ships. Pool guards against double-allocate.
        const pool = (fastify as FastifyInstance & {
          pool?: {
            allocate: (
              platform: 'android' | 'ios',
              jobId?: string,
            ) => Promise<{ id: string; name: string } | null>;
          };
        }).pool;
        if (!pool) {
          return reply.code(503).type('application/problem+json').send({
            type: 'about:blank',
            title: 'Service Unavailable',
            status: 503,
            detail: 'neither sessions module nor pool decorator available',
          });
        }
        const device = await pool.allocate(body.platform);
        if (!device) {
          return reply
            .code(503)
            .type('application/problem+json')
            .send({
              type: 'about:blank',
              title: 'Service Unavailable',
              status: 503,
              detail: `no idle ${body.platform} device available for exploration`,
            });
        }
        deviceId = device.id;
        sessionId = '00000000-0000-0000-0000-000000000000'; // sentinel — Phase 34 backfill
        log.warn(
          { deviceId, runIdPending: true },
          'sessions module unavailable; using sentinel sessionId',
        );
      }

      // INSERT exploration row.
      const run = await repo.insertExplorationRow(
        { db: fastify.db, logger: log },
        {
          deviceId,
          sessionId,
          appArtifactId: body.appArtifactId,
          bundleId: body.bundleId,
          platform: body.platform,
          budgetTaps: body.budgetTaps,
          budgetScreens: body.budgetScreens,
          budgetSeconds: body.budgetSeconds,
          config: {
            model: body.model,
            seedSkeletonId: body.seedSkeletonId ?? null,
            ...(body.metadata ?? {}),
          },
          ownerApiKeyId: apiKey?.id ?? null,
          ownerActor: requesterActor,
        },
      );

      // Enqueue the agent run (worker registered in Plan 35-02). enqueueRun
      // returns null when pg-boss queue not yet created — the row exists in
      // DB so the run is queued at the DB level even if pg-boss hasn't been
      // told about the queue yet.
      const explorationsModule = (fastify as FastifyInstance & {
        explorationsModule?: { enqueueRun: (id: string) => Promise<string | null> };
      }).explorationsModule;
      if (explorationsModule?.enqueueRun) {
        await explorationsModule.enqueueRun(run.id);
      }

      // Build server-authoritative WS URL.
      const scheme = req.protocol === 'http' ? 'ws' : 'wss';
      const wsUrl = `${scheme}://${req.hostname}/api/explorations/${run.id}/events`;
      // Rough heuristic: ~30 seconds per screen budget cap.
      const estimatedDurationMin = Math.ceil((body.budgetScreens * 30) / 60);

      return reply.code(201).send({
        runId: run.id,
        sessionId: run.sessionId,
        deviceId: run.deviceId,
        agentLogStreamUrl: wsUrl,
        estimatedDurationMin,
      });
    },
  });

  // ---------- GET /api/explorations (list) — Phase 35 Plan 35-05 ----------
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().route({
    method: 'GET',
    url: '/api/explorations',
    preHandler: [requireAuth as never],
    schema: {
      response: { 200: listResponseSchema, 401: problemJsonSchema },
    } satisfies FastifyZodOpenApiSchema,
    handler: async (_req, reply) => {
      const explorations = await repo.listExplorations({ db: fastify.db });
      return reply.code(200).send({ explorations });
    },
  });

  // ---------- GET /api/explorations/:id ----------
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().route({
    method: 'GET',
    url: '/api/explorations/:id',
    preHandler: [requireAuth as never],
    schema: {
      params: idParamsSchema,
      response: { 200: getResponseSchema, 404: problemJsonSchema },
    } satisfies FastifyZodOpenApiSchema,
    handler: async (req, reply) => {
      const { id } = req.params as z.infer<typeof idParamsSchema>;
      const exploration = await repo.getExploration({ db: fastify.db }, id);
      if (!exploration) {
        return reply.code(404).type('application/problem+json').send({
          type: 'about:blank',
          title: 'Not Found',
          status: 404,
          detail: `exploration ${id} not found`,
        });
      }
      const [screens, transitions] = await Promise.all([
        repo.getScreens({ db: fastify.db }, id),
        repo.getTransitions({ db: fastify.db }, id),
      ]);
      return reply.code(200).send({ exploration, screens, transitions });
    },
  });

  // ---------- GET /api/explorations/:id/report.md — Phase 35 Plan 35-06 ----------
  //
  // Returns a Markdown document (text/markdown; charset=utf-8) generated from
  // the exploration row + all its screens + transitions. Embeds a Mermaid
  // `graph TD` block + DFS-enumerated user journeys. Port of the reference
  // app-explorer report.py generator.
  //
  // Response is NOT typed via Zod — the body is a Markdown string, not a JSON
  // object. fastify-zod-openapi v5 cannot serialize a plain-string response
  // (it expects an object schema); skipping the response: {} schema entirely
  // is the documented escape hatch.
  fastify.route({
    method: 'GET',
    url: '/api/explorations/:id/report.md',
    preHandler: [requireAuth as never],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const exploration = await repo.getExploration({ db: fastify.db }, id);
      if (!exploration) {
        return reply.code(404).type('application/problem+json').send({
          type: 'about:blank',
          title: 'Not Found',
          status: 404,
          detail: `exploration ${id} not found`,
        });
      }
      const [screens, transitions] = await Promise.all([
        repo.getScreens({ db: fastify.db }, id),
        repo.getTransitions({ db: fastify.db }, id),
      ]);
      const markdown = buildReport(exploration, screens, transitions);
      reply.type('text/markdown; charset=utf-8');
      return markdown;
    },
  });

  // ---------- DELETE /api/explorations/:id ----------
  // NOTE: 204 response intentionally NOT typed via Zod — fastify-zod-openapi
  // v5 raises "Zod void cannot be represented in OpenAPI" when serializing
  // an empty body schema (DEFERRED-15-A). 404 is typed below.
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().route({
    method: 'DELETE',
    url: '/api/explorations/:id',
    preHandler: [requireAuth as never],
    schema: {
      params: idParamsSchema,
      response: { 404: problemJsonSchema },
    } satisfies FastifyZodOpenApiSchema,
    handler: async (req, reply) => {
      const { id } = req.params as z.infer<typeof idParamsSchema>;
      const cancelled = await repo.cancelExploration({ db: fastify.db }, id);
      if (!cancelled) {
        return reply.code(404).type('application/problem+json').send({
          type: 'about:blank',
          title: 'Not Found',
          status: 404,
          detail: `exploration ${id} not found or not in running state`,
        });
      }
      // 204 No Content — body intentionally omitted. Cast through `any` because
      // fastify-zod-openapi narrows reply.code() to the typed response keys,
      // and 204 is intentionally NOT in the schema (DEFERRED-15-A — z.void()
      // cannot be represented in OpenAPI).
      (reply as { code: (n: number) => { send: (b?: unknown) => unknown } })
        .code(204)
        .send();
      return reply;
    },
  });

  log.info('Explorations REST routes registered (POST/GET/DELETE /api/explorations)');
}
