import type { FastifyInstance } from 'fastify';
import type { FastifyZodOpenApiTypeProvider, FastifyZodOpenApiSchema } from 'fastify-zod-openapi';
import { z } from 'zod';
import { eq, desc, and, gte, isNotNull } from 'drizzle-orm';
import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { generateJUnitXML } from './junit-generator.js';
import { createHttpError } from '../api/error-handler.js';
import { webhookCreateRequestSchema, webhookSchema } from './schemas.js';
import * as schema from '../db/schema.js';
import { buildReportBundle, type ReportStep } from './report-bundle-service.js';
import { aggregateSuites, type SuiteInput } from './suite-aggregation-service.js';
import { computeTrends, type TrendInput } from './trends-service.js';

// ── share-token request schema ────────────────────────────────────────────────

const mintBodySchema = z.object({
  ttlDays: z.union([z.literal(5), z.literal(15), z.literal(30)]),
});

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

    const jobMeta = (jobRow.metadata as { maestroVersion?: string; osVersion?: string } | null) ?? null;

    // Fallback: derive OS / Maestro version from current server state when
    // metadata is empty (legacy jobs that ran before per-job capture shipped).
    const maestroVersion = jobMeta?.maestroVersion ?? cachedServerMaestroVersion ?? null;
    const osVersion = jobMeta?.osVersion ?? deriveOsVersionFromConfig(fastify, jobRow.platform);

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
        maestroVersion,
        osVersion,
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

  /**
   * GET /jobs/trends - Pass/fail counts by day and by flow over a rolling window.
   *
   * Query param: windowDays (default 7) — how many days of job_steps to include.
   * Returns TrendsOutput: byDay[], byFlow[], windowDays.
   */
  fastify.get<{ Querystring: { windowDays?: string } }>('/jobs/trends', async (req) => {
    const { windowDays = '7' } = req.query;
    const n = parseInt(windowDays, 10);
    const cutoff = new Date(Date.now() - n * 24 * 60 * 60 * 1000);

    const rows = await fastify.db
      .select({
        flowName: schema.jobSteps.flowName,
        status: schema.jobSteps.status,
        finishedAt: schema.jobSteps.finishedAt,
      })
      .from(schema.jobSteps)
      .where(and(isNotNull(schema.jobSteps.flowName), gte(schema.jobSteps.finishedAt, cutoff)));

    return computeTrends(
      rows.filter((r): r is TrendInput => r.flowName !== null && r.finishedAt !== null),
      n,
    );
  });

  /**
   * POST /jobs/:id/share-token — Mint a scoped share JWT for a job.
   *
   * Task 3.4: Returns {token, expiresAt, url} for valid requests.
   * - 503 when sharing is disabled (reportTokenService not decorated).
   * - 400 when ttlDays ∉ {5, 15, 30}.
   * - 404 when the job ID is unknown.
   * - 200 with { token, expiresAt, url } on success.
   *
   * Auth: the route is protected by the bearer-auth gate registered in
   * api/plugin.ts. These tests exercise handler logic in isolation.
   */
  fastify.post('/jobs/:id/share-token', async (req, reply) => {
    if (!fastify.reportTokenService) {
      return reply.code(503).send({ type: 'about:blank', title: 'Sharing disabled', status: 503 });
    }

    const { id } = req.params as { id: string };

    const body = mintBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({
        type: 'about:blank',
        title: 'Invalid body',
        status: 400,
        detail: body.error.message,
      });
    }

    const [job] = await fastify.db
      .select({ id: schema.jobs.id })
      .from(schema.jobs)
      .where(eq(schema.jobs.id, id));

    if (!job) {
      return reply.code(404).send({ type: 'about:blank', title: 'Job not found', status: 404 });
    }

    const { token, expiresAt } = await fastify.reportTokenService.mint({
      jobId: id,
      ttlDays: body.data.ttlDays,
    });

    return { token, expiresAt: expiresAt.toISOString(), url: `/jobs/${id}?t=${token}` };
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

// ── version fallback helpers ──────────────────────────────────────────────────

const pExecFile = promisify(nodeExecFile);

/**
 * Cached Maestro version detected on the running server. Surfaced as a
 * fallback for legacy jobs whose metadata lacks maestroVersion. Resolved
 * lazily on first /jobs/:id/report call.
 */
let cachedServerMaestroVersion: string | null | undefined = undefined;

async function ensureServerMaestroVersion(): Promise<void> {
  if (cachedServerMaestroVersion !== undefined) return;
  try {
    const { stdout } = await pExecFile('maestro', ['--version']);
    cachedServerMaestroVersion = stdout.trim().split('\n')[0] || null;
  } catch {
    cachedServerMaestroVersion = null;
  }
}

// fire-and-forget warmup on module load
void ensureServerMaestroVersion();

// Android API level → marketing version mapping. Truncated at API 26 (8.0).
const ANDROID_API_TO_VERSION: Record<string, string> = {
  '35': '15',
  '34': '14',
  '33': '13',
  '32': '12L',
  '31': '12',
  '30': '11',
  '29': '10',
  '28': '9',
  '27': '8.1',
  '26': '8.0',
};

function deriveOsVersionFromConfig(fastify: FastifyInstance, platform: 'android' | 'ios'): string | null {
  const cfg = (fastify as unknown as { config?: { pool?: { android?: { api_level?: string | number }; ios?: { runtime?: string } } } }).config;
  if (!cfg?.pool) return null;
  if (platform === 'android') {
    const api = String(cfg.pool.android?.api_level ?? '');
    const v = ANDROID_API_TO_VERSION[api];
    return v ? `Android ${v}` : api ? `API ${api}` : null;
  }
  if (platform === 'ios') {
    const runtime = cfg.pool.ios?.runtime ?? '';
    // "iOS-18-5" → "iOS 18.5"
    const m = runtime.match(/^iOS-(\d+)-(\d+)$/);
    if (m) return `iOS ${m[1]}.${m[2]}`;
    return runtime || null;
  }
  return null;
}
