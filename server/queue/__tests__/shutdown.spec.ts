/**
 * Phase 15 Plan 05, Task 5.4 — graceful shutdown timing spike.
 *
 * Proves QUEUE-07 at the single-job scale:
 *   - With one in-flight 200ms job, `app.close()` drains + resolves in < 2_000ms
 *     (the 30_000ms budget is plenty for light workloads).
 *   - With no in-flight jobs, `app.close()` resolves in < 1_500ms.
 *
 * Larger-scale timing (50 × 5s jobs) lives in `scripts/spikes/shutdown-timing.ts`
 * — executed by hand on the Mac Mini — with the number captured in
 * `.planning/phases/15-fix-operational-dependencies/spikes/shutdown-timing.md`.
 *
 * DB-gated via `describe.skipIf(!TEST_DATABASE_URL)`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { correlationPlugin } from '../../correlation/index.js';
import { queuePlugin, QUEUE_NAMES } from '../index.js';
import { makeStubConfigPlugin, stubDbPlugin } from './test-helpers.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;
const SCHEMA = 'pgboss_shutdown_spec';

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn('[queue/shutdown.spec] SKIPPED: set TEST_DATABASE_URL to run');
}

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(makeStubConfigPlugin(TEST_DATABASE_URL!));
  await app.register(stubDbPlugin);
  await app.register(correlationPlugin);
  await app.register(queuePlugin, { schema: SCHEMA });
  await app.ready();
  return app;
}

describe.skipIf(!HAS_DB)('graceful shutdown timing (QUEUE-07 spike)', () => {
  beforeAll(async () => {
    const sql = postgres(TEST_DATABASE_URL!);
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await sql.end();
  });

  afterAll(async () => {
    const sql = postgres(TEST_DATABASE_URL!);
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await sql.end();
  });

  it('drains a single 200ms in-flight job inside 2000ms', async () => {
    const app = await buildTestApp();
    try {
      await app.queue.work(QUEUE_NAMES.DEMO, async () => {
        await new Promise((r) => setTimeout(r, 200));
      });
      await app.queue.send(QUEUE_NAMES.DEMO, { i: 0 });
      // Let pg-boss pick up the job (poll interval can be 500ms-ish on cold start).
      await new Promise((r) => setTimeout(r, 250));

      const start = Date.now();
      await app.close();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(2_000);
    } finally {
      // If the close path threw mid-way we still want to avoid leaking the pg-boss connection pool.
      if (!app.server.listening) {
        /* already closed */
      } else {
        await app.close().catch(() => { /* ignore */ });
      }
    }
  });

  it('closes in under 1500ms when no in-flight jobs exist', async () => {
    const app = await buildTestApp();
    try {
      const start = Date.now();
      await app.close();
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(1_500);
    } finally {
      if (app.server.listening) {
        await app.close().catch(() => { /* ignore */ });
      }
    }
  });
});
