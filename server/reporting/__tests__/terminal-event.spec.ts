/**
 * Phase 19 / Plan 19-04 — Terminal event persistence spec (EVENTS-07 + SC2).
 *
 * Proves: when a webhook delivery exhausts retries, the DLQ worker emits
 * `webhook.failed.retryExhausted` AND persistEnvelope writes the row to the
 * `events` table with correct shape:
 *   - event_type = 'webhook.failed.retryExhausted'
 *   - event_version = 1
 *   - aggregate_type = 'reporting'
 *   - aggregate_id = REPORTING_AGGREGATE_ID (v5 UUID of 'reporting')
 *   - correlation_id non-null (EVENTS-07 mandate)
 *   - payload JSON matches webhookFailedRetryExhaustedPayload shape
 *     (url, event, attempts, payloadSnapshot)
 *
 * Distinct from correlation.spec.ts — correlation.spec proves the CORRELATION
 * invariant (all rows share one id); terminal-event.spec proves the
 * PERSISTENCE invariant (the event row exists with the correct payload shape).
 *
 * DB-gated (TEST_DATABASE_URL / DATABASE_URL); runs in ~20-30s.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
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
import { WEBHOOK_DELIVER_QUEUE_NAME } from '../queue.js';
import { REPORTING_AGGREGATE_ID } from '../events.js';
import { startFailingServer, type FailingServerHandle } from './fixtures/failing-server.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;
const SCHEMA = 'pgboss_reporting_terminal_event_spec';

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn('[reporting/terminal-event.spec] SKIPPED: set TEST_DATABASE_URL or DATABASE_URL to run');
}

describe.skipIf(!HAS_DB)('reporting terminal event persistence (Phase 19-04 — EVENTS-07 / SC2)', () => {
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

  it('persists webhook.failed.retryExhausted row with full shape after DLQ pipeline', async () => {
    const testPayload = { event: 'job.completed', job: { id: 'test-job-terminal-event' } };

    const jobId = await app.queue.send(WEBHOOK_DELIVER_QUEUE_NAME, {
      url: failingServer.url,
      payload: testPayload,
    }, {});
    expect(jobId).not.toBeNull();

    // Wait for terminal event to be persisted.
    // Multi-test parallelism: other reporting specs in the same DB share the
    // events table. Match on (url === failingServer.url) — the ephemeral OS-
    // allocated port in failing-server fixture is unique per test file.
    await vi.waitFor(async () => {
      const rows = await app.db
        .select()
        .from(eventsTable)
        .where(eq(eventsTable.eventType, 'webhook.failed.retryExhausted'));
      const ours = rows.find((r) => {
        const payload = r.payload as { url?: string };
        return payload?.url === failingServer.url;
      });
      expect(ours).toBeDefined();
    }, { timeout: 45_000, interval: 500 });

    // Fetch + filter by our ephemeral URL to find OUR row deterministically.
    const rows = await app.db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.eventType, 'webhook.failed.retryExhausted'));
    const ourRow = rows.find((r) => {
      const payload = r.payload as { url?: string };
      return payload?.url === failingServer.url;
    });
    expect(ourRow).toBeDefined();

    // Shape assertions (EVENTS-07 + reportingRegistry shape from plan 19-01).
    expect(ourRow!.eventType).toBe('webhook.failed.retryExhausted');
    expect(ourRow!.eventVersion).toBe(1);
    expect(ourRow!.aggregateType).toBe('reporting');
    expect(ourRow!.aggregateId).toBe(REPORTING_AGGREGATE_ID);
    expect(typeof ourRow!.correlationId).toBe('string');
    expect(ourRow!.correlationId.length).toBeGreaterThan(0);

    // Payload shape assertions (matches webhookFailedRetryExhaustedPayload).
    const payload = ourRow!.payload as Record<string, unknown>;
    expect(typeof payload.url).toBe('string');
    expect(payload.url).toBe(failingServer.url);
    expect(payload.event).toBeDefined();
    expect(typeof payload.attempts).toBe('number');
    expect(payload.attempts as number).toBeGreaterThanOrEqual(5);
    expect(payload.payloadSnapshot).toBeDefined();
    expect((payload.payloadSnapshot as { event?: string })?.event).toBe('job.completed');
  }, 60_000);
});
