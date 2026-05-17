/**
 * Spec for ALS → pg-boss job.data serialization — Phase 15 Plan 05, Task 5.2.
 *
 * Inside a request that has written `correlationId='cid-als-1'` into ALS, calling
 * `fastify.queue.send(QUEUE_NAMES.DEMO, {...})` must write a pg-boss job whose
 * `data.correlationId === 'cid-als-1'`. Proven by querying `pgboss.job` after send.
 *
 * This is the producer half of TRACE-05. The consumer half (worker restores ALS)
 * lives in `als-crossqueue.spec.ts`.
 *
 * DB-gated: requires TEST_DATABASE_URL pointed at a writable Postgres.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { correlationPlugin } from '../../correlation/index.js';
import { queuePlugin, QUEUE_NAMES } from '../index.js';
import { makeStubConfigPlugin, stubDbPlugin } from './test-helpers.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;
const SCHEMA = 'pgboss_als_spec';

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn('[queue/als.spec] SKIPPED: set TEST_DATABASE_URL to run');
}

describe.skipIf(!HAS_DB)('queue.send — ALS → job.data serialization (TRACE-05 producer)', () => {
  let app: FastifyInstance;
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    // Fresh schema for the whole suite.
    const sql0 = postgres(TEST_DATABASE_URL!);
    await sql0.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await sql0.end();

    app = Fastify({ logger: false });
    await app.register(makeStubConfigPlugin(TEST_DATABASE_URL!));
    await app.register(stubDbPlugin);
    await app.register(correlationPlugin);
    await app.register(queuePlugin, { schema: SCHEMA });

    // Echo-like route — send a demo job; return the resulting jobId so the test
    // can look it up.
    app.post('/enqueue', async () => {
      const jobId = await app.queue.send(QUEUE_NAMES.DEMO, { x: 1 });
      return { jobId };
    });
    await app.ready();

    sql = postgres(TEST_DATABASE_URL!);
  });

  afterAll(async () => {
    await app.close();
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await sql.end();
  });

  beforeEach(async () => {
    // Clear the job table so per-test queries are deterministic.
    await sql.unsafe(`DELETE FROM ${SCHEMA}.job`);
  });

  it('writes correlationId from ALS into the pg-boss job.data', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/enqueue',
      headers: { 'x-correlation-id': 'cid-als-1' },
    });
    expect(res.statusCode).toBe(200);
    const { jobId } = res.json() as { jobId: string };
    expect(typeof jobId).toBe('string');

    const rows = await sql.unsafe<Array<{ data: { correlationId?: string; payload?: unknown } }>>(
      `SELECT data FROM ${SCHEMA}.job WHERE id = $1`,
      [jobId],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].data.correlationId).toBe('cid-als-1');
    expect(rows[0].data.payload).toEqual({ x: 1 });
  });
});
