import type { FastifyInstance } from 'fastify';
import type { FastifyZodOpenApiTypeProvider, FastifyZodOpenApiSchema } from 'fastify-zod-openapi';
import { eq } from 'drizzle-orm';
import { generateJUnitXML } from './junit-generator.js';
import { createHttpError } from '../api/error-handler.js';
import { webhookCreateRequestSchema, webhookSchema } from './schemas.js';
import * as schema from '../db/schema.js';

export async function reportRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * Phase 17 Plan 17-01 — representative POST /api/webhooks route.
   *
   * Fires a ping delivery via fastify.webhookService.deliverOnce (fire-and-forget
   * with .catch to swallow errors — preserves Phase 17 semantics until plan
   * 19-03 migrates this endpoint onto the pg-boss `webhook.deliver` queue).
   * Response promoted into components.schemas.Webhook; request schema into
   * components.schemas.WebhookCreateRequest.
   */
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().route({
    method: 'POST',
    url: '/webhooks',
    schema: {
      body: webhookCreateRequestSchema,
      response: {
        201: webhookSchema,
      },
    } satisfies FastifyZodOpenApiSchema,
    handler: async (request, reply) => {
      const { url, event, payload } = request.body;
      // Fire-and-forget — deliverOnce throws on 5xx/network; swallow here until
      // plan 19-03 enqueues via boss.send('webhook.deliver', ...) with DLQ.
      void fastify.webhookService.deliverOnce(url, {
        event,
        ...(payload ?? {}),
      }).catch(() => { /* swallow — Phase 19-03 migrates to queue-backed delivery */ });
      return reply.code(201).send({
        url,
        event,
        status: 'queued' as const,
        queuedAt: new Date().toISOString(),
      });
    },
  });

  /**
   * GET /jobs/:id/report.xml - JUnit XML report for a completed job
   */
  fastify.get<{ Params: { id: string } }>('/jobs/:id/report.xml', async (request, reply) => {
    const { id } = request.params;

    // Fetch job
    const [job] = await fastify.db
      .select({ id: schema.jobs.id, status: schema.jobs.status })
      .from(schema.jobs)
      .where(eq(schema.jobs.id, id));

    if (!job) {
      throw createHttpError(404, `Job ${id} not found`, 'NOT_FOUND');
    }

    // Check if job is complete
    if (job.status === 'queued' || job.status === 'running') {
      throw createHttpError(409, 'Job not yet complete', 'JOB_NOT_COMPLETE');
    }

    // Fetch steps
    const steps = await fastify.db
      .select({
        flowName: schema.jobSteps.flowName,
        status: schema.jobSteps.status,
        durationMs: schema.jobSteps.durationMs,
        error: schema.jobSteps.error,
      })
      .from(schema.jobSteps)
      .where(eq(schema.jobSteps.jobId, id));

    const xml = generateJUnitXML(job, steps);

    return reply
      .header('Content-Type', 'application/xml')
      .send(xml);
  });

  /**
   * GET /flows/flaky - List flows with unstable pass/fail history
   */
  fastify.get<{ Querystring: { window?: string } }>('/flows/flaky', async (request) => {
    const windowSize = request.query.window ? parseInt(request.query.window, 10) : 10;
    const flaky = await fastify.flakyDetector.getFlaky(windowSize);
    return flaky;
  });
}
