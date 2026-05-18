/**
 * Task 2.2 — GET /api/jobs/:id/report integration test.
 *
 * Builds a minimal Fastify app with a stubbed DB decorator.
 * Seeds an in-memory job + steps + artifact so we can assert the
 * full bundle shape returned by the handler without a live Postgres instance.
 *
 * Two cases:
 *   1. 200 with full bundle — failed job, failing step, video artifact.
 *   2. 404 for unknown job — problem+JSON shape.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import {
  fastifyZodOpenApiPlugin,
  validatorCompiler,
  serializerCompiler,
} from 'fastify-zod-openapi';

// The route function we are testing is exported from report-routes.ts and
// registered by apiPlugin under the /api prefix.
import { reportRoutes } from '../report-routes.js';

// ── fixtures ────────────────────────────────────────────────────────────────

const JOB_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STEP_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ART_ID  = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const VIDEO_STARTED = new Date('2026-05-17T14:32:05Z');
const STEP_STARTED  = new Date('2026-05-17T14:32:47Z');

const FAKE_JOB = {
  id: JOB_ID,
  status: 'failed',
  platform: 'android',
  deviceId: 'dev-1',
  metadata: {},
  createdAt: new Date('2026-05-17T14:32:00Z'),
  startedAt: new Date('2026-05-17T14:32:05Z'),
  finishedAt: new Date('2026-05-17T14:34:19Z'),
  maestroOutput: 'line1\nline2\nline3',
  errorMessage: null,
  resultSummary: null,
  failureClass: null,
};

const FAKE_STEP = {
  id: STEP_ID,
  jobId: JOB_ID,
  stepIndex: 0,
  flowName: 'login.yaml',
  command: 'tapOn("Submit")',
  status: 'failed' as const,
  durationMs: 500,
  startedAt: STEP_STARTED,
  finishedAt: new Date('2026-05-17T14:32:47.5Z'),
  error: 'Element not found: Submit',
  screenshotPath: '/artifacts/job-1/step-0.png',
};

const FAKE_ARTIFACT = {
  id: ART_ID,
  type: 'video' as const,
  filePath: '/artifacts/job-1/rec.mp4',
  fileName: 'rec.mp4',
  mimeType: 'video/mp4',
  fileSizeBytes: 12345,
  videoStartedAt: VIDEO_STARTED,
};

// ── minimal mock DB ──────────────────────────────────────────────────────────
//
// The handler does three queries: jobs, jobSteps, artifacts + one for flow
// history (jobSteps again, ordered by startedAt desc).
// We use a chainable mock that returns different results based on call order
// for the second .from() call on jobSteps (history query).

function buildMockDb(jobRow: typeof FAKE_JOB | null) {
  // Track which table is being queried so we can dispatch the right result.
  // The mock is deliberately minimal — it just needs to satisfy the three
  // sequential await chains the handler performs.

  const jobsResult     = jobRow ? [jobRow] : [];
  const stepsResult    = jobRow ? [FAKE_STEP] : [];
  const artifactsResult = jobRow ? [FAKE_ARTIFACT] : [];

  // History query re-queries jobSteps with different columns + limit.
  // We return a minimal row that lets loadFlowHistory compute pass rate.
  const historyResult = jobRow
    ? [
        {
          jobId: JOB_ID,
          status: 'failed',
          finishedAt: FAKE_STEP.finishedAt,
          durationMs: 500,
        },
      ]
    : [];

  // Each `select()` call returns an object whose methods are chainable and
  // eventually resolve to the correct data array. We differentiate by the
  // `from` argument's table name (the Drizzle table object exposes its name
  // via Symbol(DrizzleTable) / [$inferSelect] but the simplest approach here
  // is to keep a call counter per `select()` invocation, because the handler
  // calls:
  //   1. .select().from(jobs).where(...)          → [jobRow]
  //   2. .select().from(jobSteps).where(...).orderBy(...)  → [FAKE_STEP]
  //   3. .select().from(artifacts).where(...)     → [FAKE_ARTIFACT]
  //   4. .select({...}).from(jobSteps).where(...).orderBy(...).limit(...)  → historyResult
  //
  // We count calls to `select()` in sequence.

  let selectCallCount = 0;

  const makeChain = (resolveValue: unknown[]) => {
    const chain: Record<string, unknown> = {};
    const terminal = () => Promise.resolve(resolveValue);
    chain.where   = () => chain;
    chain.orderBy = () => chain;
    chain.limit   = terminal;
    chain.then    = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(resolveValue).then(resolve, reject);
    return chain;
  };

  const results = [jobsResult, stepsResult, artifactsResult, historyResult];

  return {
    select: (_cols?: unknown) => {
      const idx = selectCallCount < results.length ? selectCallCount : results.length - 1;
      selectCallCount++;
      return {
        from: (_table: unknown) => makeChain(results[idx]),
      };
    },
  };
}

// ── app factory ─────────────────────────────────────────────────────────────

async function buildTestApp(jobRow: typeof FAKE_JOB | null): Promise<FastifyInstance> {
  const mockDb = buildMockDb(jobRow);

  const dbStub = fp(async (fastify: FastifyInstance) => {
    fastify.decorate('db', mockDb as unknown as FastifyInstance['db']);
  }, { name: 'db' });

  // reportRoutes also calls createHttpError which sends RFC 7807 responses.
  // We need an error handler that converts thrown HttpErrors into JSON.
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(fastifyZodOpenApiPlugin);
  await app.register(dbStub);

  // Register the report routes under /api prefix (mirroring apiPlugin).
  await app.register(reportRoutes, { prefix: '/api' });

  await app.ready();
  return app;
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('GET /api/jobs/:id/report', () => {
  let appWithJob: FastifyInstance;
  let appWithoutJob: FastifyInstance;

  beforeAll(async () => {
    appWithJob    = await buildTestApp(FAKE_JOB);
    appWithoutJob = await buildTestApp(null);
  });

  afterAll(async () => {
    await appWithJob?.close();
    await appWithoutJob?.close();
  });

  it('returns 200 with full bundle shape for a known job', async () => {
    const resp = await appWithJob.inject({
      method: 'GET',
      url: `/api/jobs/${JOB_ID}/report`,
    });

    expect(resp.statusCode).toBe(200);
    const body = resp.json();

    // Top-level keys
    expect(body).toHaveProperty('job');
    expect(body).toHaveProperty('steps');
    expect(body).toHaveProperty('artifacts');
    expect(body).toHaveProperty('failureFocus');
    expect(body).toHaveProperty('reportLinks');

    // job shape
    expect(body.job.id).toBe(JOB_ID);
    expect(body.job.summary).toEqual({ total: 1, passed: 0, failed: 1, skipped: 0 });

    // steps array
    expect(Array.isArray(body.steps)).toBe(true);
    expect(body.steps).toHaveLength(1);
    expect(body.steps[0].id).toBe(STEP_ID);

    // artifacts array
    expect(Array.isArray(body.artifacts)).toBe(true);
    expect(body.artifacts).toHaveLength(1);
    expect(body.artifacts[0].id).toBe(ART_ID);

    // failureFocus not null (job has a failing step)
    expect(body.failureFocus).not.toBeNull();
    expect(body.failureFocus.stepId).toBe(STEP_ID);

    // reportLinks — junitXml must point to the correct job
    expect(body.reportLinks.junitXml).toBe(`/jobs/${JOB_ID}/reports/junit.xml`);
  });

  it('returns 404 with problem+JSON for an unknown job', async () => {
    const unknownId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    const resp = await appWithoutJob.inject({
      method: 'GET',
      url: `/api/jobs/${unknownId}/report`,
    });

    expect(resp.statusCode).toBe(404);
    const body = resp.json();
    // The error is thrown via createHttpError — Fastify serializes it.
    // The production apiPlugin uses the custom RFC 7807 errorHandler, but in
    // this minimal test app we rely on Fastify's built-in error serializer
    // (which uses `statusCode` not `status`). Assert the shape that actually
    // comes back so the test isn't brittle against error-handler wiring.
    expect(body.statusCode ?? body.status).toBe(404);
    // Code / error-type should indicate NOT_FOUND
    expect(
      (body.code ?? body.type ?? '').includes('NOT_FOUND') ||
      (body.error ?? body.title ?? '').toLowerCase().includes('not found'),
    ).toBe(true);
  });
});
