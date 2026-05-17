/**
 * Phase 19 / Plan 19-04 — End-to-end correlationId trace spec (ROADMAP SC4).
 *
 * Proves: enqueueing a webhook delivery inside an ALS-scoped correlationId
 * produces the SAME correlationId on every one of the 5 retry attempts,
 * the DLQ row, and the terminal webhook.failed.retryExhausted event in the
 * events table.
 *
 * The core SC4 invariant: ONE correlationId threads
 *   request → enqueue → 5 retries → DLQ row → terminal event row.
 *
 * Uses the canonical plain-object ALS store shape (checker W5):
 *   asyncLocalStorage.run({correlationId, currentEventId, actor} as never, ...)
 * This matches how server/correlation/plugin.ts + server/queue/plugin.ts:196-208
 * actually populate the store in production.
 *
 * DB-gated (TEST_DATABASE_URL / DATABASE_URL); runs in ~20-30s.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { asyncLocalStorage } from '@fastify/request-context';

import {
  fastifyZodOpenApiPlugin,
  validatorCompiler,
  serializerCompiler,
} from 'fastify-zod-openapi';

import reportingPlugin from '../plugin.js';
import queuePlugin from '../../queue/plugin.js';
import busPlugin from '../../bus/plugin.js';
import correlationPlugin from '../../correlation/plugin.js';
import { events as eventsTable } from '../../db/schema.js';
import {
  WEBHOOK_DELIVER_QUEUE_NAME,
  WEBHOOK_DELIVER_DLQ_QUEUE_NAME,
} from '../queue.js';
import { startFailingServer, type FailingServerHandle } from './fixtures/failing-server.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;
const SCHEMA = 'pgboss_reporting_correlation_spec';

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn('[reporting/correlation.spec] SKIPPED: set TEST_DATABASE_URL or DATABASE_URL to run');
}

describe.skipIf(!HAS_DB)('reporting correlationId end-to-end trace (Phase 19-04 — SC4)', () => {
  let app: FastifyInstance;
  let client: ReturnType<typeof postgres>;
  let failingServer: FailingServerHandle;

  beforeAll(async () => {
    client = postgres(TEST_DATABASE_URL!);
    await client.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);

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
    await app.register(queuePlugin, {
      schema: SCHEMA,
      maintenanceIntervalSeconds: 1,
    });
    await app.register(reportingPlugin);
    await app.ready();

    // Tighten retry timing so all 5 retries + DLQ transfer fire within the vitest budget.
    // See queue.spec.ts for the math (plans.js:1063-1069 random exponential backoff).
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

  it('a single correlationId threads request → enqueue → 5 retries → DLQ row → events table', async () => {
    const expectedCid = randomUUID();

    // Enqueue inside an ALS fiber with a known correlationId, using the CANONICAL
    // plain-object store shape per 19-CONTEXT.md §Specifics (checker W5). The
    // queue wrapper reads store[correlationId] via readStore and serialises it
    // into the envelope; all retries + DLQ re-insert inherit the same id.
    const jobId = await asyncLocalStorage.run(
      { correlationId: expectedCid, currentEventId: null, actor: 'test' } as never,
      async () => app.queue.send(WEBHOOK_DELIVER_QUEUE_NAME, {
        url: failingServer.url,
        payload: { event: 'job.completed', job: { id: 'test-job-sc4' } },
      }, {}),
    );
    expect(jobId).not.toBeNull();

    // Wait for the terminal `webhook.failed.retryExhausted` row to land in the
    // events table with the expected correlationId — the tail of the SC4 chain.
    await vi.waitFor(async () => {
      const termEvents = await app.db
        .select()
        .from(eventsTable)
        .where(
          and(
            eq(eventsTable.eventType, 'webhook.failed.retryExhausted'),
            eq(eventsTable.correlationId, expectedCid),
          ),
        );
      expect(termEvents.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 45_000, interval: 500 });

    // Assert 1: DLQ row exists with matching correlationId in envelope.data.
    const dlqJobs = await app.boss.findJobs(WEBHOOK_DELIVER_DLQ_QUEUE_NAME);
    const matchingDlq = dlqJobs.filter(
      (j) => (j.data as { correlationId?: string })?.correlationId === expectedCid,
    );
    expect(matchingDlq.length).toBeGreaterThanOrEqual(1);

    // Assert 2: terminal event in the events table has matching correlationId.
    const termEvents = await app.db
      .select()
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.eventType, 'webhook.failed.retryExhausted'),
          eq(eventsTable.correlationId, expectedCid),
        ),
      );
    expect(termEvents.length).toBeGreaterThanOrEqual(1);
    expect(termEvents[0].correlationId).toBe(expectedCid);
    expect(termEvents[0].aggregateType).toBe('reporting');

    // Assert 3: MAIN queue's job row (still findable via findJobs on main queue)
    // carries the SAME correlationId — proves all 5 retries shared ONE envelope
    // because pg-boss re-uses the same row across attempts (RESEARCH §Pitfall 3).
    const mainJobs = await app.boss.findJobs(WEBHOOK_DELIVER_QUEUE_NAME);
    const matchingMain = mainJobs.filter(
      (j) => (j.data as { correlationId?: string })?.correlationId === expectedCid,
    );
    expect(matchingMain.length).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
