/**
 * Phase 37 Plan 37-01 — analysis HTTP routes.
 *
 *   POST /api/builds/:id/skeleton  (multipart, single `skeleton` part)
 *   GET  /api/builds/:id/skeleton  → latest analysis for jobId, or 404
 *
 * Mirror shape: server/azure/routes.ts (multipart) + Fastify Zod OpenAPI
 * patterns from server/explorations/internal/routes.ts.
 */

import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type {
  FastifyZodOpenApiSchema,
  FastifyZodOpenApiTypeProvider,
} from 'fastify-zod-openapi';
import type pino from 'pino';

import type { AnalysisModule } from './internal/module.js';
import {
  skeletonPayloadSchema,
  analysisIngestResponseSchema,
  analysisResponseSchema,
  analysisProblemJsonSchema,
} from './schemas.js';
import { ANALYSIS_EVENT_NAMES } from './events.js';

export interface AnalysisRoutesDeps {
  module: AnalysisModule;
  logger: pino.Logger;
}

const idParamsSchema = z
  .object({ id: z.string().uuid() })
  .meta({ id: 'AnalysisIdParams' });

export function registerAnalysisRoutes(
  app: FastifyInstance,
  deps: AnalysisRoutesDeps,
): void {
  const log = deps.logger.child({ component: 'analysis.routes' });
  const typed = app.withTypeProvider<FastifyZodOpenApiTypeProvider>();

  // ── POST /api/builds/:id/skeleton ─────────────────────────────────
  typed.post(
    '/api/builds/:id/skeleton',
    {
      schema: {
        params: idParamsSchema,
        response: {
          201: analysisIngestResponseSchema,
          400: analysisProblemJsonSchema,
          404: analysisProblemJsonSchema,
        },
      } satisfies FastifyZodOpenApiSchema,
    },
    async (req, reply) => {
      const { id } = req.params;
      // Multipart parse — single file part named `skeleton`.
      let fileBuffer: Buffer | null = null;
      try {
        const file = await (req as unknown as {
          file: () => Promise<{ toBuffer: () => Promise<Buffer> } | null>;
        }).file();
        if (!file) {
          reply
            .code(400)
            .type('application/problem+json')
            .send({
              type: 'about:blank',
              title: 'Bad Request',
              status: 400,
              detail: 'missing multipart skeleton file',
            });
          return;
        }
        fileBuffer = await file.toBuffer();
      } catch (err) {
        log.error({ err }, 'multipart parse failed');
        reply
          .code(400)
          .type('application/problem+json')
          .send({
            type: 'about:blank',
            title: 'Bad Request',
            status: 400,
            detail: 'invalid multipart body',
          });
        return;
      }

      // Parse + validate the JSON payload against the Zod schema.
      let payload: ReturnType<typeof skeletonPayloadSchema.parse>;
      try {
        const parsed = JSON.parse(fileBuffer.toString('utf8'));
        payload = skeletonPayloadSchema.parse(parsed);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        reply
          .code(400)
          .type('application/problem+json')
          .send({
            type: 'about:blank',
            title: 'Bad Request',
            status: 400,
            detail: `invalid skeleton payload: ${msg}`,
          });
        return;
      }

      // Persist.
      const platform = payload.platform === 'ios' ? 'ios' : 'android';
      const created = await deps.module.repo.create({
        jobId: id,
        buildArtifactId: null,
        platform,
        payload,
      });
      // Emit ingest event (subscribers can react without polling).
      deps.module.emit.ingested(id, {
        analysisId: created.id,
        jobId: id,
        platform,
      });
      reply.code(201).send({ analysisId: created.id });
    },
  );

  // ── GET /api/builds/:id/skeleton ──────────────────────────────────
  typed.get(
    '/api/builds/:id/skeleton',
    {
      schema: {
        params: idParamsSchema,
        response: {
          200: analysisResponseSchema,
          404: analysisProblemJsonSchema,
        },
      } satisfies FastifyZodOpenApiSchema,
    },
    async (req, reply) => {
      const { id } = req.params;
      const row = await deps.module.repo.getByJobId(id);
      if (!row) {
        reply
          .code(404)
          .type('application/problem+json')
          .send({
            type: 'about:blank',
            title: 'Not Found',
            status: 404,
            detail: `no analysis stored for build ${id}`,
          });
        return;
      }
      reply.code(200).send({
        id: row.id,
        jobId: row.jobId,
        buildArtifactId: row.buildArtifactId,
        platform: row.platform,
        payload: row.payload,
        createdAt: row.createdAt.toISOString(),
      });
    },
  );

  log.info({ event: ANALYSIS_EVENT_NAMES.INGESTED }, 'analysis routes registered');
}
