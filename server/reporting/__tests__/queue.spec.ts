/**
 * Phase 19 / Plan 19-04 — Reporting queue DLQ pipeline spec (ROADMAP SC1).
 *
 * Proves: 5× 500 Internal Server Error → after pg-boss exhausts retries +
 * runs maintenance → the DLQ queue contains the failed payload; the Fastify
 * app does NOT crash during any of the 5 attempts.
 *
 * Runtime budget: with retryBackoff:true + retryDelay:1 + retryDelayMax:30
 * defaults set by registerWebhookDeliveryWorkers, pg-boss's failJobs SQL
 * formula (plans.js:1063-1069) produces randomised exponential backoff:
 *   retry_delay * (2^n/2 + 2^n/2 * random()) capped by retry_delay_max
 * For retry_count 0→5 with retryDelay:1, retryDelayMax:30:
 *   attempt 1→2: 1-2s, 2→3: 2-4s, 3→4: 4-8s, 4→5: 8-16s, 5→final: 16-30s
 * Worst-case cumulative: ~60s. Add pollingIntervalSeconds default 2s per
 * transition. Use a 120s per-test timeout with defensive 100s waitFor budget.
 *
 * DB-gated (TEST_DATABASE_URL / DATABASE_URL). Skips cleanly when unset.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

import {
  fastifyZodOpenApiPlugin,
  validatorCompiler,
  serializerCompiler,
} from 'fastify-zod-openapi';

import reportingPlugin from '../plugin.js';
import queuePlugin from '../../queue/plugin.js';
import busPlugin from '../../bus/plugin.js';
import correlationPlugin from '../../correlation/plugin.js';
import {
  WEBHOOK_DELIVER_QUEUE_NAME,
  WEBHOOK_DELIVER_DLQ_QUEUE_NAME,
} from '../queue.js';
import { startFailingServer, type FailingServerHandle } from './fixtures/failing-server.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;
const SCHEMA = 'pgboss_reporting_queue_spec';

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn('[reporting/queue.spec] SKIPPED: set TEST_DATABASE_URL or DATABASE_URL to run');
}

describe.skipIf(!HAS_DB)('reporting queue DLQ pipeline (Phase 19-04 — SC1)', () => {
  let app: FastifyInstance;
  let client: ReturnType<typeof postgres>;
  let failingServer: FailingServerHandle;

  beforeAll(async () => {
    client = postgres(TEST_DATABASE_URL!);
    await client.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);

    // Shared DRY fixture per checker W1 — always returns 500, tracks requestCount().
    failingServer = await startFailingServer({
      defaultResponse: { status: 500, body: 'nope' },
    });

    const db = drizzle(client);

    const stubConfigPlugin = fp(async (fastify: FastifyInstance) => {
      fastify.decorate('config', {
        database_url: TEST_DATABASE_URL!,
        webhooks: {
          url: failingServer.url,
          timeout_ms: 2_000,
          max_retries: 5,
        },
      } as never);
    }, { name: 'config' });

    const liveDbPlugin = fp(async (fastify: FastifyInstance) => {
      fastify.decorate('db', db as unknown as FastifyInstance['db']);
    }, { name: 'db' });

    app = Fastify({ logger: false });
    // Plan 19-05: reportingPlugin registers GET /api/queue/dlq via Zod-typed
    // schema; Fastify needs the zod-openapi validator/serializer + plugin
    // installed at root scope before registration, else app.ready() throws
    // FST_ERR_SCH_VALIDATION_BUILD on the route's response schema.
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(fastifyZodOpenApiPlugin);
    await app.register(stubConfigPlugin);
    await app.register(correlationPlugin);
    await app.register(liveDbPlugin);
    await app.register(busPlugin);
    // pollingIntervalSeconds: 1 speeds up retryable-job pickup (default 2s).
    // maintenanceIntervalSeconds: 1 keeps maintenance loop tight (plan 19-00 passthrough).
    await app.register(queuePlugin, {
      schema: SCHEMA,
      maintenanceIntervalSeconds: 1,
    });
    await app.register(reportingPlugin);
    await app.ready();

    // Override the production retry timing with test-local values to stay
    // inside the vitest per-test budget. pg-boss's formula in plans.js:1063-1069
    // produces 1-2+2-4+4-8+8-16+16-30 = worst-case 60s with retryDelayMax:30.
    // Tighten to retryDelay:1 + retryDelayMax:2 → worst-case ~1+2+2+2+2 = 9s
    // before the final DLQ transfer.
    await app.boss.updateQueue(WEBHOOK_DELIVER_QUEUE_NAME, {
      retryDelay: 1,
      retryBackoff: true,
      retryDelayMax: 2,
    } as never);
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await failingServer?.close();
    await client?.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => { /* ignore */ });
    await client?.end();
  }, 30_000);

  it('5× 500 → DLQ row appears; server does not crash', async () => {
    const requestCountBefore = failingServer.requestCount();

    // Enqueue directly via the queue wrapper (bypassing bus subscriber for
    // deterministic scope — the subscriber fires from onPersisted('job.completed')
    // which is exercised in the broader correlation.spec). Scope discipline.
    const jobId = await app.queue.send(WEBHOOK_DELIVER_QUEUE_NAME, {
      url: failingServer.url,
      payload: { event: 'job.completed', job: { id: 'test-job-sc1' } },
    }, {});
    expect(jobId).not.toBeNull();

    // Wait for pg-boss to exhaust 5 retries + DLQ transfer.
    // With retryDelay:1 + retryDelayMax:2 (overridden in beforeAll after queue
    // creation), worst-case retries fire within ~9s; DLQ row appears inline
    // via the failJobs CTE (plans.js:1155-1168) on final attempt's completion.
    // 45s budget is conservative headroom for pollingInterval jitter.
    await vi.waitFor(async () => {
      const dlqJobs = await app.boss.findJobs(WEBHOOK_DELIVER_DLQ_QUEUE_NAME);
      expect(dlqJobs.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 45_000, interval: 500 });

    // Assert: >= 5 requests hit the failing server (the retry attempts).
    // pg-boss retryLimit:5 means 1 initial + 5 retries = up to 6 attempts.
    expect(failingServer.requestCount() - requestCountBefore).toBeGreaterThanOrEqual(5);

    // Assert: DLQ row payload references our URL (proves envelope flowed through).
    const dlqJobs = await app.boss.findJobs(WEBHOOK_DELIVER_DLQ_QUEUE_NAME);
    expect(dlqJobs.length).toBeGreaterThanOrEqual(1);
    const matching = dlqJobs.filter((j) => {
      const data = j.data as { payload?: { url?: string }; url?: string };
      // pg-boss copies the full envelope into DLQ — {correlationId, causationId, actor, payload: {url, payload}}
      return (
        data?.url === failingServer.url
        || (data?.payload as { url?: string } | undefined)?.url === failingServer.url
      );
    });
    expect(matching.length).toBeGreaterThanOrEqual(1);

    // Assert: app is still responsive — the core SC1 invariant (no crash).
    // We probe with a root-level inject; non-throwing response of any kind proves survival.
    const survived = await app.inject({ method: 'GET', url: '/' }).then(() => true).catch(() => false);
    expect(survived).toBe(true);
  }, 60_000);
});
