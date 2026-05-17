/**
 * Spec for full request → queue.send → worker ALS restore — Phase 15 Plan 05, Task 5.2.
 *
 * End-to-end proof of TRACE-05: a correlation id set on an inbound HTTP request crosses
 * the pg-boss boundary and is still observable inside the worker handler via
 * `requestContext.get('correlationId')` — even though the worker runs in a different
 * async context opened by pg-boss's internal polling loop.
 *
 * Mirrors RESEARCH §3's integration test pattern (vi.waitFor, 5s timeout).
 *
 * DB-gated: requires TEST_DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { requestContext } from '@fastify/request-context';
import { correlationPlugin } from '../../correlation/index.js';
import { queuePlugin, QUEUE_NAMES } from '../index.js';
import { makeStubConfigPlugin, stubDbPlugin } from './test-helpers.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;
const SCHEMA = 'pgboss_alscq_spec';

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn('[queue/als-crossqueue.spec] SKIPPED: set TEST_DATABASE_URL to run');
}

describe.skipIf(!HAS_DB)('ALS survives request → queue.send → worker (TRACE-05 full)', () => {
  let app: FastifyInstance;
  const captured: Array<string | null | undefined> = [];

  beforeAll(async () => {
    const sql = postgres(TEST_DATABASE_URL!);
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await sql.end();

    app = Fastify({ logger: false });
    await app.register(makeStubConfigPlugin(TEST_DATABASE_URL!));
    await app.register(stubDbPlugin);
    await app.register(correlationPlugin);
    await app.register(queuePlugin, { schema: SCHEMA });

    // Routes MUST be registered before app.ready() — Fastify prohibits late route adds.
    app.post('/emit', async () => {
      await app.queue.send(QUEUE_NAMES.DEMO, { x: 1 });
      return { ok: true };
    });
    await app.ready();

    // Worker registration goes through boss.work — safe after ready().
    await app.queue.work(QUEUE_NAMES.DEMO, async () => {
      captured.push(requestContext.get('correlationId') as string | null | undefined);
    });
  });

  afterAll(async () => {
    await app.close();
    const sql = postgres(TEST_DATABASE_URL!);
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await sql.end();
  });

  it('worker restores ALS so requestContext.get(correlationId) returns the inbound header value', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/emit',
      headers: { 'x-correlation-id': 'cid-abc' },
    });
    expect(res.statusCode).toBe(200);

    await vi.waitFor(() => expect(captured.length).toBeGreaterThan(0), { timeout: 5000 });
    expect(captured[0]).toBe('cid-abc');
  });
});
