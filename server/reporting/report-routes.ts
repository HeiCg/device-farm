import type { FastifyInstance } from 'fastify';
import type { FastifyZodOpenApiTypeProvider, FastifyZodOpenApiSchema } from 'fastify-zod-openapi';
import { eq, desc, and, gte, isNotNull } from 'drizzle-orm';
import { generateJUnitXML } from './junit-generator.js';
import { createHttpError } from '../api/error-handler.js';
import { webhookCreateRequestSchema, webhookSchema } from './schemas.js';
import * as schema from '../db/schema.js';
import { buildReportBundle, type ReportStep } from './report-bundle-service.js';
import { aggregateSuites, type SuiteInput } from './suite-aggregation-service.js';

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

  /**
   * GET /jobs/:id/report - Full report viewer bundle for a job.
   *
   * Queries job + steps + artifacts from DB, builds the log tail from
   * jobs.maestroOutput, loads flow history for the first flow seen in steps,
   * then delegates to buildReportBundle (pure transformer, Task 2.1).
   *
   * Returns the ReportBundle shape directly — no Zod schema wrapping needed
   * here (plain JSON output, matching the existing report-routes style).
   */
  fastify.get<{ Params: { id: string } }>('/jobs/:id/report', async (request, reply) => {
    const { id } = request.params;

    const [jobRow] = await fastify.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, id));

    if (!jobRow) {
      throw createHttpError(404, `Job ${id} not found`, 'NOT_FOUND');
    }

    const stepRows = await fastify.db
      .select()
      .from(schema.jobSteps)
      .where(eq(schema.jobSteps.jobId, id))
      .orderBy(schema.jobSteps.stepIndex);

    const artifactRows = await fastify.db
      .select()
      .from(schema.artifacts)
      .where(eq(schema.artifacts.jobId, id));

    const logTailLines = buildLogTail(jobRow.maestroOutput ?? '', 30);

    const firstFlow = stepRows.find((s) => s.flowName)?.flowName ?? null;
    const history = firstFlow ? await loadFlowHistory(fastify, firstFlow, 10) : null;

    return buildReportBundle({
      job: {
        id: jobRow.id,
        status: jobRow.status,
        platform: jobRow.platform,
        createdAt: jobRow.createdAt,
        startedAt: jobRow.startedAt ?? null,
        finishedAt: jobRow.finishedAt ?? null,
        deviceId: jobRow.deviceId ?? null,
        metadata: jobRow.metadata,
      },
      steps: stepRows.map<ReportStep>((s) => ({
        id: s.id,
        jobId: s.jobId,
        stepIndex: s.stepIndex,
        flowName: s.flowName ?? null,
        command: s.command ?? null,
        status: s.status,
        durationMs: s.durationMs ?? null,
        startedAt: s.startedAt ?? null,
        finishedAt: s.finishedAt ?? null,
        error: s.error ?? null,
        screenshotPath: s.screenshotPath ?? null,
      })),
      artifacts: artifactRows.map((a) => ({
        id: a.id,
        type: a.type,
        fileName: a.fileName,
        mimeType: a.mimeType,
        fileSizeBytes: a.fileSizeBytes ?? null,
        videoStartedAt: a.videoStartedAt ?? null,
      })),
      logTailLines,
      history,
    });

    void reply; // reply is unused — Fastify serialises the return value
  });

  /**
   * GET /jobs/suites - Suite aggregation: per-flow counts, pass rate, trend, last run info.
   *
   * Query param: windowDays (default 7) — how many days of job_steps to include.
   * Returns SuiteAggregate[] sorted by flowName insertion order (Map preserves insertion).
   */
  fastify.get<{ Querystring: { windowDays?: string } }>('/jobs/suites', async (req) => {
    const { windowDays = '7' } = req.query;
    const cutoff = new Date(Date.now() - parseInt(windowDays, 10) * 24 * 60 * 60 * 1000);

    const rows = await fastify.db
      .select({
        flowName: schema.jobSteps.flowName,
        status: schema.jobSteps.status,
        durationMs: schema.jobSteps.durationMs,
        finishedAt: schema.jobSteps.finishedAt,
      })
      .from(schema.jobSteps)
      .where(and(
        isNotNull(schema.jobSteps.flowName),
        gte(schema.jobSteps.startedAt, cutoff),
      ));

    return aggregateSuites(rows.filter((r): r is SuiteInput => r.flowName !== null));
  });
}

// ── module-scope helpers ──────────────────────────────────────────────────────

/**
 * Return the last `n` non-empty lines from a raw maestro output string.
 * An empty maestroOutput yields an empty array.
 */
function buildLogTail(maestroOutput: string, n: number): string[] {
  if (!maestroOutput) return [];
  const lines = maestroOutput.split('\n');
  return lines.slice(Math.max(0, lines.length - n));
}

/**
 * Query the last `n` runs of a given flow from jobSteps and compute
 * aggregate stats.  Returns null if no rows are found.
 */
async function loadFlowHistory(
  fastify: FastifyInstance,
  flowName: string,
  n: number,
) {
  const rows = await fastify.db
    .select({
      jobId: schema.jobSteps.jobId,
      status: schema.jobSteps.status,
      finishedAt: schema.jobSteps.finishedAt,
      durationMs: schema.jobSteps.durationMs,
    })
    .from(schema.jobSteps)
    .where(eq(schema.jobSteps.flowName, flowName))
    .orderBy(desc(schema.jobSteps.startedAt))
    .limit(n);

  if (rows.length === 0) return null;

  const passed = rows.filter((r) => r.status === 'passed').length;
  const avg = Math.round(
    rows.reduce((s, r) => s + (r.durationMs ?? 0), 0) / rows.length,
  );

  return {
    flowName,
    runs: rows.map((r) => ({
      jobId: r.jobId,
      status: r.status,
      finishedAt: r.finishedAt ?? null,
      durationMs: r.durationMs ?? null,
    })),
    passRate: passed / rows.length,
    avgDurationMs: avg,
  };
}
