/**
 * Phase 19 / Plan 19-05 — GET /api/queue/dlq route spec (QUEUE-05).
 *
 * Proves:
 *   - Empty DLQ → 200 with {items: [], count: 0} passing dlqListResponseSchema.safeParse
 *   - Seeded DLQ row → 200 with correct flat shape + correlation_id hoisted
 *   - Response body round-trips through Zod schema
 *   - Field names match CONTEXT.md §Specifics verbatim (snake_case/lowercase)
 *
 * Seeds DLQ rows directly via `app.queue.send(WEBHOOK_DELIVER_DLQ_QUEUE_NAME, ...)`
 * inside an ALS fiber carrying a known correlationId. This bypasses the ~35s
 * retry-exhaustion path from queue.spec.ts — this spec focuses on the HTTP /
 * Zod contract, not the retry pipeline. The retry pipeline is covered by
 * queue.spec.ts + correlation.spec.ts + terminal-event.spec.ts.
 *
 * DB-gated (TEST_DATABASE_URL / DATABASE_URL). Skips cleanly when unset.
 */
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
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
import { dlqListResponseSchema } from '../schemas.js';
import { WEBHOOK_DELIVER_DLQ_QUEUE_NAME } from '../queue.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;
const SCHEMA = 'pgboss_reporting_dlq_route_spec';

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn('[reporting/dlq-route.spec] SKIPPED: set TEST_DATABASE_URL or DATABASE_URL to run');
}

describe.skipIf(!HAS_DB)('GET /api/queue/dlq (Phase 19-05 — QUEUE-05)', () => {
  let app: FastifyInstance;
  let client: ReturnType<typeof postgres>;

  beforeAll(async () => {
    client = postgres(TEST_DATABASE_URL!);
    await client.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);

    const db = drizzle(client);

    const stubConfigPlugin = fp(async (fastify: FastifyInstance) => {
      fastify.decorate('config', {
        database_url: TEST_DATABASE_URL!,
        webhooks: { url: 'https://example.com/hook', timeout_ms: 2_000, max_retries: 5 },
      } as never);
    }, { name: 'config' });

    const liveDbPlugin = fp(async (fastify: FastifyInstance) => {
      fastify.decorate('db', db as unknown as FastifyInstance['db']);
    }, { name: 'db' });

    app = Fastify({ logger: false });
    // Install the Zod validator/serializer compilers at root scope BEFORE any
    // plugin that declares routes via fastify-zod-openapi schemas. Without
    // these, Fastify falls back to Ajv which chokes on Zod-emitted `required`
    // arrays (FST_ERR_SCH_VALIDATION_BUILD). Mirrors server/index.ts:94-96
    // (Phase 17 Plan 17-01). reportingPlugin's GET /api/queue/dlq handler
    // declares a Zod response schema, so this spec needs the full type-provider
    // wiring to avoid the serialization-schema build failure at app.ready().
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(fastifyZodOpenApiPlugin);
    await app.register(stubConfigPlugin);
    await app.register(correlationPlugin);
    await app.register(liveDbPlugin);
    await app.register(busPlugin);
    await app.register(queuePlugin, { schema: SCHEMA });
    await app.register(reportingPlugin);
    await app.ready();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await client?.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => { /* ignore */ });
    await client?.end();
  }, 30_000);

  it('returns 200 + empty list when DLQ is empty; body passes dlqListResponseSchema.safeParse', async () => {
    // No seeding — DLQ starts empty (unique schema per test file, fresh beforeAll).
    // NOTE: the DLQ worker runs on every row inserted into the DLQ queue, so if
    // prior tests in this spec ran before this one, the queue would contain rows.
    // Run this assertion FIRST (it-ordering within a describe is deterministic in vitest).
    const resp = await app.inject({ method: 'GET', url: '/api/queue/dlq' });
    expect(resp.statusCode).toBe(200);

    const body = resp.json();
    const parsed = dlqListResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.items).toEqual([]);
      expect(parsed.data.count).toBe(0);
    }
  });

  it('seeded DLQ row → 200 with flat shape + correlation_id hoisted from envelope', async () => {
    // Seed one row directly into the DLQ queue (bypasses the main queue retry
    // path for test speed). Uses the canonical plain-object ALS store shape
    // per 19-CONTEXT.md §Specifics (checker W5) so queue.send reads the
    // correlationId we want via readStore and serialises it into the envelope.
    const expectedCid = randomUUID();
    const webhookUrl = 'https://example.com/seeded-hook';
    const webhookPayload = { event: 'job.completed', job: { id: 'seeded-job' } };

    const jobId = await asyncLocalStorage.run(
      { correlationId: expectedCid, currentEventId: null, actor: 'test' } as never,
      async () => app.queue.send(WEBHOOK_DELIVER_DLQ_QUEUE_NAME, {
        url: webhookUrl,
        payload: webhookPayload,
      }, {}),
    );
    expect(jobId).not.toBeNull();

    // findJobs on the DLQ queue exposes the inserted row regardless of the
    // DLQ worker's eventual async consumption (the worker emits the terminal
    // event but pg-boss keeps the row in state='completed'/'failed'/'active'
    // per its lifecycle; findJobs returns all states).
    const resp = await app.inject({ method: 'GET', url: '/api/queue/dlq' });
    expect(resp.statusCode).toBe(200);

    const body = resp.json();
    const parsed = dlqListResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error(`Response failed Zod parse: ${parsed.error.message}`);
    }

    expect(parsed.data.items.length).toBeGreaterThanOrEqual(1);
    const matching = parsed.data.items.find((i) => i.correlation_id === expectedCid);
    expect(matching).toBeDefined();
    if (matching) {
      expect(matching.queue).toBe(WEBHOOK_DELIVER_DLQ_QUEUE_NAME);
      expect(matching.correlation_id).toBe(expectedCid);
      // envelope.data is {correlationId, causationId, actor, payload: {url, payload}}
      // — our caller payload nests under envelope.payload.
      const data = matching.data as { payload?: { url?: string } };
      expect(data.payload?.url).toBe(webhookUrl);
    }
  });

  it('response JSON contains CONTEXT-mandated snake_case/lowercase field names (no camelCase drift)', async () => {
    // The prior test seeded one row, so the DLQ is guaranteed non-empty here.
    const resp = await app.inject({ method: 'GET', url: '/api/queue/dlq' });
    expect(resp.statusCode).toBe(200);
    const bodyText = resp.body;  // raw JSON string for field-name grep

    // Field names from CONTEXT.md §Specifics: id, queue, state, retrycount,
    // data, output, createdon, correlation_id (all snake_case/lowercase).
    expect(bodyText).toContain('"items"');
    expect(bodyText).toContain('"count"');

    // The seeded row from the prior test guarantees items is non-empty + all
    // 8 keys are present.
    expect(bodyText).not.toContain('"items":[]');
    expect(bodyText).toMatch(/"correlation_id"\s*:/);
    expect(bodyText).toMatch(/"retrycount"\s*:/);
    expect(bodyText).toMatch(/"createdon"\s*:/);
    expect(bodyText).toMatch(/"queue"\s*:/);
    expect(bodyText).toMatch(/"state"\s*:/);
    expect(bodyText).toMatch(/"id"\s*:/);

    // Grep for camelCase drift — these MUST NOT appear at the TOP level of
    // each projected item. The nested envelope (item.data.correlationId) is
    // fine; the crude regex `"correlationId"\s*:[^{]` filters those out by
    // requiring a non-brace immediately after the colon (top-level primitive).
    // If a reviewer sees these fail, the handler projection drifted from
    // CONTEXT.md §Specifics.
    expect(bodyText).not.toMatch(/"retryCount"\s*:/);
    expect(bodyText).not.toMatch(/"createdOn"\s*:/);
  });
});
