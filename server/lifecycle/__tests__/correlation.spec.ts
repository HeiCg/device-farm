/**
 * Phase 18 / Plan 18-02 — lifecycle schedule → worker correlationId round-trip spec.
 *
 * Proves ROADMAP §Phase 18 SC2:
 *   "an integration test proves schedule-triggered work carries a correlationId
 *    from scheduler to worker logs."
 *
 * Additionally proves Option B (plan 18-00 Task 0.2): consecutive schedule-dispatched
 * fires observe DIFFERENT correlationIds — because server/queue/plugin.ts
 * schedule() stores data.correlationId=null and queue.work() generates a fresh
 * randomUUID() on every fire.
 *
 * Implementation note: pg-boss v12's cron dispatcher applies `singletonSeconds: 60`
 * to every scheduled fire (see node_modules/pg-boss/dist/timekeeper.js:139), which
 * means a single schedule can only emit ONE job per 60 seconds regardless of cron
 * granularity. To observe two distinct schedule fires within the test budget we
 * register TWO schedules (each fires once within the first cron monitor cycle),
 * and assert each worker captured a distinct UUID correlationId.
 *
 * `cronMonitorIntervalSeconds: 1` (passed to the queue plugin) reduces the cron
 * monitor interval from its 30s default so both schedules dispatch within ~2s.
 *
 * Gated on TEST_DATABASE_URL / DATABASE_URL. Isolated pg-boss schema.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import postgres from 'postgres';
import { requestContext } from '@fastify/request-context';

import { correlationPlugin } from '../../correlation/index.js';
import queuePlugin from '../../queue/plugin.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;
const SCHEMA = 'pgboss_lifecycle_correlation_spec';
const TEST_SCHEDULE_A = 'lifecycle.test.every-second.a';
const TEST_SCHEDULE_B = 'lifecycle.test.every-second.b';

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn('[lifecycle/correlation.spec] SKIPPED: set TEST_DATABASE_URL to run');
}

function makeStubConfigPlugin(databaseUrl: string) {
  return fp(async (fastify: FastifyInstance) => {
    fastify.decorate('config', { database_url: databaseUrl } as never);
  }, { name: 'config' });
}

const stubDbPlugin = fp(async (fastify: FastifyInstance) => {
  fastify.decorate('db', {} as never);
}, { name: 'db' });

describe.skipIf(!HAS_DB)('lifecycle schedule → worker per-fire correlationId (Phase 18-02)', () => {
  let app: FastifyInstance;
  let client: ReturnType<typeof postgres>;
  const workerIds: string[] = [];
  const capturedA: Array<string | null | undefined> = [];
  const capturedB: Array<string | null | undefined> = [];

  beforeAll(async () => {
    client = postgres(TEST_DATABASE_URL!);
    await client.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);

    app = Fastify({ logger: false });
    await app.register(makeStubConfigPlugin(TEST_DATABASE_URL!));
    await app.register(stubDbPlugin);
    await app.register(correlationPlugin);
    // cronMonitorIntervalSeconds: 1 so the cron monitor dispatches schedules
    // within 1-2s instead of the 30s default — bounded test budget.
    await app.register(queuePlugin, { schema: SCHEMA, cronMonitorIntervalSeconds: 1 });
    await app.ready();

    for (const name of [TEST_SCHEDULE_A, TEST_SCHEDULE_B]) {
      await app.boss.createQueue(name, {
        policy: 'stately',
        retryLimit: 1,
      } as never);

      await app.queue.schedule(
        name,
        '* * * * * *',   // every second — test-only cron; production uses daily/hourly
        {} as never,
        { singletonKey: name },
      );
    }

    const workerIdA = await app.queue.work<unknown>(TEST_SCHEDULE_A, async () => {
      // requestContext is the OBJECT-store reader used by production worker code.
      // queue.work calls asyncLocalStorage.run(OBJECT_STORE, handler),
      // so requestContext.get('correlationId') reads the per-fire UUID here.
      capturedA.push(requestContext.get('correlationId') as string | null | undefined);
    });
    const workerIdB = await app.queue.work<unknown>(TEST_SCHEDULE_B, async () => {
      capturedB.push(requestContext.get('correlationId') as string | null | undefined);
    });
    workerIds.push(workerIdA, workerIdB);
  }, 30_000);

  afterAll(async () => {
    for (const id of workerIds) {
      await app.boss.offWork(id).catch(() => { /* ignore */ });
    }
    for (const name of [TEST_SCHEDULE_A, TEST_SCHEDULE_B]) {
      await app.boss.unschedule(name).catch(() => { /* ignore */ });
    }
    await app?.close();
    await client?.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => { /* ignore */ });
    await client?.end();
  });

  it('[QUEUE-08 SC2] worker observes a non-empty UUID correlationId on schedule-triggered fire', async () => {
    // cronMonitorIntervalSeconds:1 + cronWorkerIntervalSeconds:5 default means
    // first fire arrives within ~6s. Wait up to 20s defensively.
    await vi.waitFor(
      () => { expect(capturedA.length).toBeGreaterThan(0); },
      { timeout: 20_000, interval: 500 },
    );

    const first = capturedA[0];
    expect(typeof first).toBe('string');
    expect(first!.length).toBeGreaterThan(0);
    // UUID v4 shape — pg-boss work wrapper uses crypto.randomUUID().
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  }, 30_000);

  it('[QUEUE-08 SC2 + Option B] two schedule fires observe DIFFERENT correlationIds', async () => {
    // Schedule A already captured in prior test. Wait for schedule B to fire.
    // Separate schedules have independent 60s singletonSeconds windows, so B
    // fires within ~2s of A even though pg-boss dedupes within a single schedule.
    await vi.waitFor(
      () => {
        expect(capturedA.length).toBeGreaterThan(0);
        expect(capturedB.length).toBeGreaterThan(0);
      },
      { timeout: 30_000, interval: 500 },
    );

    const firstA = capturedA[0];
    const firstB = capturedB[0];
    expect(firstA).toBeDefined();
    expect(firstB).toBeDefined();
    expect(typeof firstA).toBe('string');
    expect(typeof firstB).toBe('string');
    expect(firstB).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // Core Option B proof — two distinct schedule-triggered fires produce two
    // distinct correlationIds (would be IDENTICAL if plan 18-00's per-fire fix regressed).
    expect(firstA).not.toBe(firstB);
  }, 40_000);
});
