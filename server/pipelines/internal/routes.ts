import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { FastifyZodOpenApiTypeProvider, FastifyZodOpenApiSchema } from 'fastify-zod-openapi';
import { z } from 'zod';
import { pipelineCreateRequestSchema, pipelineSummarySchema } from '../schemas.js';

const triggerRunSchema = z.object({
  variables: z.record(z.string(), z.string()).optional().default({}),
});

export async function pipelineRoutes(fastify: FastifyInstance): Promise<void> {
  const service = fastify.pipelineService;

  fastify.get('/api/pipelines', async () => service.listPipelines());

  fastify.get<{ Params: { id: string } }>(
    '/api/pipelines/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const pipeline = await service.getPipeline(request.params.id)
        ?? await service.getPipelineByName(request.params.id);
      if (!pipeline) {
        return reply.code(404).send({
          type: 'https://device-farm/errors/not-found',
          title: 'Pipeline not found',
          status: 404,
        });
      }
      return pipeline;
    },
  );

  /**
   * Phase 17 Plan 17-01 — POST /api/pipelines upgraded to withTypeProvider.
   * Request body: raw YAML string (or JSON-stringified). Response promoted
   * into components.schemas.Pipeline; request into components.schemas.PipelineCreateRequest.
   */
  const pipelineValidationErrorSchema = z.object({
    type: z.string(),
    title: z.string(),
    status: z.literal(400),
    detail: z.string(),
  }).meta({ id: 'PipelineValidationError', description: 'RFC 7807 validation error for POST /api/pipelines' });

  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().route({
    method: 'POST',
    url: '/api/pipelines',
    schema: {
      body: pipelineCreateRequestSchema,
      response: {
        201: pipelineSummarySchema,
        400: pipelineValidationErrorSchema,
      },
    } satisfies FastifyZodOpenApiSchema,
    handler: async (request, reply) => {
      const yamlContent = typeof request.body === 'string'
        ? request.body
        : JSON.stringify(request.body);
      try {
        const result = await service.createPipeline(yamlContent);
        return reply.code(201).send(result);
      } catch (err: any) {
        return reply.code(400).send({
          type: 'https://device-farm/errors/validation',
          title: 'Invalid pipeline',
          status: 400 as const,
          detail: err.message,
        });
      }
    },
  });

  fastify.put<{ Params: { id: string } }>(
    '/api/pipelines/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const yamlContent = typeof request.body === 'string'
        ? request.body
        : JSON.stringify(request.body);
      try {
        await service.updatePipeline(request.params.id, yamlContent);
        return { status: 'updated' };
      } catch (err: any) {
        return reply.code(400).send({
          type: 'https://device-farm/errors/validation',
          title: 'Invalid pipeline',
          status: 400,
          detail: err.message,
        });
      }
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    '/api/pipelines/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      await service.deletePipeline(request.params.id);
      return { status: 'deleted' };
    },
  );

  // Pipeline Runs
  fastify.post<{ Params: { id: string } }>(
    '/api/pipelines/:id/run',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const parsed = triggerRunSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          type: 'https://device-farm/errors/validation',
          title: 'Validation Error',
          status: 400,
          detail: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
        });
      }

      const pipeline = await service.getPipeline(request.params.id)
        ?? await service.getPipelineByName(request.params.id);
      if (!pipeline) {
        return reply.code(404).send({
          type: 'https://device-farm/errors/not-found',
          title: 'Pipeline not found',
          status: 404,
        });
      }

      try {
        const runId = await service.triggerRun(pipeline.id, 'api', parsed.data.variables);
        return reply.code(201).send({
          run_id: runId,
          status: 'pending',
          url: `/pipeline-runs/${runId}`,
        });
      } catch (err: any) {
        return reply.code(500).send({
          type: 'https://device-farm/errors/internal',
          title: 'Failed to trigger run',
          status: 500,
          detail: err.message,
        });
      }
    },
  );

  fastify.get('/api/pipeline-runs', async (request: FastifyRequest) => {
    const { pipeline_id } = request.query as Record<string, string>;
    return service.listRuns(pipeline_id);
  });

  fastify.get<{ Params: { id: string } }>(
    '/api/pipeline-runs/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const run = await service.getRun(request.params.id);
      if (!run) {
        return reply.code(404).send({
          type: 'https://device-farm/errors/not-found',
          title: 'Pipeline run not found',
          status: 404,
        });
      }
      return run;
    },
  );

  fastify.get<{ Params: { id: string } }>(
    '/api/pipeline-runs/:id/status',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const run = await service.getRun(request.params.id);
      if (!run) {
        return reply.code(404).send({
          type: 'https://device-farm/errors/not-found',
          title: 'Pipeline run not found',
          status: 404,
        });
      }
      return { run_id: run.id, status: run.status };
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    '/api/pipeline-runs/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      await service.cancelRun(request.params.id);
      return { status: 'cancelled' };
    },
  );

  // ── Secrets ────────────────────────────────────────────────

  fastify.get('/api/secrets', async () => {
    return fastify.secretsService.list();
  });

  fastify.post(
    '/api/secrets',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { name?: string; value?: string };
      if (!body?.name || !body?.value) {
        return reply.code(400).send({
          type: 'https://device-farm/errors/validation',
          title: 'Validation Error',
          status: 400,
          detail: 'name and value are required',
        });
      }
      try {
        const result = await fastify.secretsService.create(body.name, body.value);
        return reply.code(201).send(result);
      } catch (err: any) {
        if (err.message?.includes('unique') || err.code === '23505') {
          return reply.code(409).send({
            type: 'https://device-farm/errors/conflict',
            title: 'Secret already exists',
            status: 409,
            detail: `Secret "${body.name}" already exists`,
          });
        }
        throw err;
      }
    },
  );

  fastify.delete<{ Params: { name: string } }>(
    '/api/secrets/:name',
    async (request: FastifyRequest<{ Params: { name: string } }>) => {
      await fastify.secretsService.delete(request.params.name);
      return { status: 'deleted' };
    },
  );

  // ── Schedules ──────────────────────────────────────────────

  fastify.get<{ Params: { id: string } }>(
    '/api/pipelines/:id/schedules',
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      return service.listSchedules(request.params.id);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    '/api/pipelines/:id/schedules',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const body = request.body as { cron_expression?: string; variables?: Record<string, string>; enabled?: boolean };
      if (!body?.cron_expression) {
        return reply.code(400).send({
          type: 'https://device-farm/errors/validation',
          title: 'Validation Error',
          status: 400,
          detail: 'cron_expression is required',
        });
      }

      const result = await service.createSchedule(
        request.params.id,
        body.cron_expression,
        body.variables ?? {},
        body.enabled ?? true,
      );

      // Notify scheduler to pick up new schedule
      if (fastify.pipelineScheduler) {
        await fastify.pipelineScheduler.addSchedule(result.id);
      }

      return reply.code(201).send(result);
    },
  );

  fastify.put<{ Params: { id: string } }>(
    '/api/pipeline-schedules/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      const body = request.body as { cron_expression?: string; enabled?: boolean; variables?: Record<string, string> };
      const updates: any = {};
      if (body.cron_expression !== undefined) updates.cronExpression = body.cron_expression;
      if (body.enabled !== undefined) updates.enabled = body.enabled;
      if (body.variables !== undefined) updates.variables = body.variables;

      await service.updateSchedule(request.params.id, updates);

      // Notify scheduler to update
      if (fastify.pipelineScheduler) {
        await fastify.pipelineScheduler.addSchedule(request.params.id);
      }

      return { status: 'updated' };
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    '/api/pipeline-schedules/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      // Remove from scheduler first
      if (fastify.pipelineScheduler) {
        fastify.pipelineScheduler.removeSchedule(request.params.id);
      }
      await service.deleteSchedule(request.params.id);
      return { status: 'deleted' };
    },
  );
}
