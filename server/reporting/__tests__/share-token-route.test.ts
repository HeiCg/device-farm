/**
 * Task 3.4 — POST /api/jobs/:id/share-token integration tests.
 *
 * Builds a minimal Fastify app using the same pattern as
 * report-routes.report.test.ts (mirror, not imported shared helper).
 *
 * Auth strategy: we test the route handler logic in isolation.
 * The minimal test app does NOT register @fastify/bearer-auth, so there is no
 * auth gate in front of the route — this lets us exercise the handler's own
 * 503/400/404/200 branches without needing a valid API key in the test.
 * The auth gate is covered by the integration layer tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import {
  fastifyZodOpenApiPlugin,
  validatorCompiler,
  serializerCompiler,
} from 'fastify-zod-openapi';
import { createReportTokenService, type ReportTokenService } from '../../auth/report-token.js';

import { reportRoutes } from '../report-routes.js';

// ── fixtures ─────────────────────────────────────────────────────────────────

const JOB_ID   = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const UNKNOWN_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

const FAKE_JOB = { id: JOB_ID };

// ── mock DB builder ───────────────────────────────────────────────────────────
//
// The share-token route performs exactly ONE query:
//   .select({ id: schema.jobs.id }).from(schema.jobs).where(eq(...))
// which must resolve to [] or [{ id }].

function buildMockDb(jobRow: { id: string } | null) {
  const result = jobRow ? [jobRow] : [];

  const makeChain = (resolveValue: unknown[]) => {
    const chain: Record<string, unknown> = {};
    const terminal = () => Promise.resolve(resolveValue);
    chain.from  = () => chain;
    chain.where = terminal;
    // add-ons used by other route helpers (noop for this route)
    chain.orderBy = () => chain;
    chain.limit   = terminal;
    chain.then    = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(resolveValue).then(resolve, reject);
    return chain;
  };

  return {
    select: (_cols?: unknown) => makeChain(result),
  };
}

// ── real token service ────────────────────────────────────────────────────────

const TOKEN_SERVICE: ReportTokenService = createReportTokenService({ secret: 'test-secret-at-least-32-chars-long!!' });

// ── app factory ───────────────────────────────────────────────────────────────
//
// withService=true  → decorate reportTokenService (sharing enabled)
// withService=false → omit decorator (sharing disabled / 503)
// jobRow            → what the mock DB returns for the jobs query

async function buildTestApp(opts: {
  withService: boolean;
  jobRow: { id: string } | null;
}): Promise<FastifyInstance> {
  const mockDb = buildMockDb(opts.jobRow);

  const dbStub = fp(async (fastify: FastifyInstance) => {
    fastify.decorate('db', mockDb as unknown as FastifyInstance['db']);
  }, { name: 'db' });

  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(fastifyZodOpenApiPlugin);
  await app.register(dbStub);

  if (opts.withService) {
    // Decorate reportTokenService before registering routes so the handler can
    // see it via fastify.reportTokenService.
    app.decorate('reportTokenService', TOKEN_SERVICE as FastifyInstance['reportTokenService']);
  }

  // Register reporting routes under /api prefix (mirroring apiPlugin).
  await app.register(reportRoutes, { prefix: '/api' });

  await app.ready();
  return app;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/jobs/:id/share-token', () => {
  let appNoService: FastifyInstance;   // sharing disabled
  let appWithJob: FastifyInstance;     // sharing enabled + job exists
  let appWithoutJob: FastifyInstance;  // sharing enabled + job missing

  beforeAll(async () => {
    appNoService   = await buildTestApp({ withService: false, jobRow: FAKE_JOB });
    appWithJob     = await buildTestApp({ withService: true,  jobRow: FAKE_JOB });
    appWithoutJob  = await buildTestApp({ withService: true,  jobRow: null });
  });

  afterAll(async () => {
    await appNoService?.close();
    await appWithJob?.close();
    await appWithoutJob?.close();
  });

  it('returns 503 when sharing is disabled (reportTokenService missing)', async () => {
    const resp = await appNoService.inject({
      method: 'POST',
      url: `/api/jobs/${JOB_ID}/share-token`,
      payload: { ttlDays: 30 },
    });

    expect(resp.statusCode).toBe(503);
    const body = resp.json();
    expect(body.status ?? body.statusCode).toBe(503);
  });

  it('returns 200 with {token, url, expiresAt} for a known job', async () => {
    const resp = await appWithJob.inject({
      method: 'POST',
      url: `/api/jobs/${JOB_ID}/share-token`,
      payload: { ttlDays: 30 },
    });

    expect(resp.statusCode).toBe(200);
    const body = resp.json();

    // token is a JWT — three dot-separated base64url segments
    expect(typeof body.token).toBe('string');
    expect(body.token.split('.').length).toBe(3);

    // url must contain the query param
    expect(body.url).toBe(`/jobs/${JOB_ID}?t=${body.token}`);

    // expiresAt is an ISO-8601 string in the future
    expect(typeof body.expiresAt).toBe('string');
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects ttlDays not in {5, 15, 30} with 400', async () => {
    const resp = await appWithJob.inject({
      method: 'POST',
      url: `/api/jobs/${JOB_ID}/share-token`,
      payload: { ttlDays: 7 },
    });

    expect(resp.statusCode).toBe(400);
  });

  it('returns 404 for an unknown job', async () => {
    const resp = await appWithoutJob.inject({
      method: 'POST',
      url: `/api/jobs/${UNKNOWN_ID}/share-token`,
      payload: { ttlDays: 15 },
    });

    expect(resp.statusCode).toBe(404);
    const body = resp.json();
    expect(body.status ?? body.statusCode).toBe(404);
  });
});
