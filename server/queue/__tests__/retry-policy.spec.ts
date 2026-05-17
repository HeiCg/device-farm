/**
 * Spec for retryLimit defaults — Phase 15 Plan 05, Task 5.2.
 *
 * Proves QUEUE-04:
 *   - The `DEMO` queue is created with `retryLimit: 1` via `boss.createQueue(...)`,
 *     so jobs enqueued without caller opts inherit retryLimit=1 (physical-side-effect default).
 *   - Caller-supplied `{ retryLimit: 0 }` is honoured verbatim — the wrapper never
 *     silently overrides caller intent.
 *
 * DB-gated: requires TEST_DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { correlationPlugin } from '../../correlation/index.js';
import { queuePlugin, QUEUE_NAMES } from '../index.js';
import { makeStubConfigPlugin, stubDbPlugin } from './test-helpers.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;
const SCHEMA = 'pgboss_retry_spec';

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn('[queue/retry-policy.spec] SKIPPED: set TEST_DATABASE_URL to run');
}

describe.skipIf(!HAS_DB)('queue retry policy (QUEUE-04)', () => {
  let app: FastifyInstance;
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    const sql0 = postgres(TEST_DATABASE_URL!);
    await sql0.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await sql0.end();

    app = Fastify({ logger: false });
    await app.register(makeStubConfigPlugin(TEST_DATABASE_URL!));
    await app.register(stubDbPlugin);
    await app.register(correlationPlugin);
    await app.register(queuePlugin, { schema: SCHEMA });
    await app.ready();

    sql = postgres(TEST_DATABASE_URL!);
  });

  afterAll(async () => {
    await app.close();
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await sql.end();
  });

  beforeEach(async () => {
    await sql.unsafe(`DELETE FROM ${SCHEMA}.job`);
  });

  it('defaults retry_limit to 1 when caller provides no opts (from createQueue defaults)', async () => {
    const jobId = await app.queue.send(QUEUE_NAMES.DEMO, { x: 1 });
    expect(typeof jobId).toBe('string');

    const rows = await sql.unsafe<Array<{ retry_limit: number }>>(
      `SELECT retry_limit FROM ${SCHEMA}.job WHERE id = $1`,
      [jobId!],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].retry_limit).toBe(1);
  });

  it('honours caller-supplied retryLimit: 0 without silent override', async () => {
    const jobId = await app.queue.send(QUEUE_NAMES.DEMO, { x: 1 }, { retryLimit: 0 });
    expect(typeof jobId).toBe('string');

    const rows = await sql.unsafe<Array<{ retry_limit: number }>>(
      `SELECT retry_limit FROM ${SCHEMA}.job WHERE id = $1`,
      [jobId!],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].retry_limit).toBe(0);
  });
});
