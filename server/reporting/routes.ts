/**
 * Phase 19 / Plan 19-05 — Reporting HTTP routes (QUEUE-05 endpoint).
 *
 * Exports `registerReportingRoutes(fastify)` which is CALLED from the
 * reporting plugin (not registered as a Fastify plugin wrapper itself).
 * Current surface: ONE route — `GET /api/queue/dlq`.
 *
 * The DLQ endpoint is the QUEUE-05 observable surface. It queries pg-boss's
 * supported `findJobs` API (NOT raw SQL against `pgboss.job` — RESEARCH §Path A)
 * and projects `JobWithMetadata<T>` into the flat `DlqJob` shape defined in
 * `server/reporting/schemas.ts`. Field names match CONTEXT.md §Specifics
 * verbatim (snake_case for correlation_id, lowercase retrycount/createdon).
 *
 * Zod response schema via `fastify-zod-openapi` (Phase 17 SPEC-06 pipeline)
 * emits the route into `server/openapi.json` so CLI + web codegen consume
 * matching types.
 *
 * Auth: no preHandler (matches existing /api/webhooks ping endpoint behaviour).
 * Phase 26 (Auth Module) adds auth gating when it lands.
 */
import type { FastifyInstance } from 'fastify';
import type { FastifyZodOpenApiTypeProvider, FastifyZodOpenApiSchema } from 'fastify-zod-openapi';

import { dlqListResponseSchema, type DlqJob } from './schemas.js';
import { WEBHOOK_DELIVER_DLQ_QUEUE_NAME } from './queue.js';

export async function registerReportingRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().route({
    method: 'GET',
    url: '/api/queue/dlq',
    schema: {
      response: {
        200: dlqListResponseSchema,
      },
    } satisfies FastifyZodOpenApiSchema,
    handler: async () => {
      // Path A (RESEARCH §Endpoint Design): use pg-boss's public `findJobs` API.
      // Returns all jobs in the DLQ queue regardless of state (created/retry/
      // active/completed/cancelled/failed). Phase 19 MVP returns the full
      // list; a future ?state= filter is out of scope (see CONTEXT deferred).
      const jobs = await fastify.boss.findJobs(WEBHOOK_DELIVER_DLQ_QUEUE_NAME);

      // Project JobWithMetadata<T> → flat DlqJob shape (field names match
      // CONTEXT.md §Specifics verbatim; correlation_id hoisted from
      // envelope.data.correlationId per plan 19-00 schema shape).
      const items: DlqJob[] = jobs.map((j) => {
        const data = (j.data as { correlationId?: string | null; payload?: unknown } | undefined) ?? {};
        const correlationId =
          typeof data.correlationId === 'string' && data.correlationId.length > 0
            ? data.correlationId
            : null;
        return {
          id: j.id,
          queue: j.name,
          state: j.state,
          retrycount: j.retryCount ?? 0,
          data: (data as Record<string, unknown>) ?? {},
          output: (j.output as Record<string, unknown> | null) ?? null,
          createdon: j.createdOn instanceof Date ? j.createdOn.toISOString() : null,
          correlation_id: correlationId,
        };
      });

      return { items, count: items.length };
    },
  });
}
