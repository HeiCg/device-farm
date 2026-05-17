/**
 * Phase 23 / Plan 23-06 — jobs saga subscribers DB-gated spec [EVENTS-10 / SC1].
 *
 * Proves the jobs-owned saga subscribers wired by Plan 23-04 in
 * server/jobs/internal/subscribers.ts. Three describe blocks, each itDB-gated,
 * exercise the three subscriber paths end-to-end with real DB writes:
 *
 *   1. pool.device.allocated → jobs subscriber writes jobs.status='allocated'
 *      + jobs.deviceId set + emits job.allocated.
 *   2. jobs.job.completed    → jobs subscriber writes jobs.status terminal
 *      + finishedAt set + emits job.cleanup.requested (PERSISTED) — the
 *      cleanup row in events table proves the saga hand-off.
 *   3. jobs.job.failed       → jobs subscriber writes jobs.status='failed'
 *      + errorMessage set + emits job.cleanup.requested (PERSISTED).
 *
 * Harness mirrors Phase 21 artifacts/subscriber.spec.ts: spins minimal Fastify
 * stack with config/correlation/db/event-bus/queue/pool plugins + the real
 * jobs plugin under test. Pool plugin runs with android/ios disabled (no real
 * emulators booted). Each test seeds prerequisite jobs/devices rows then drives
 * a bus emit and polls for the expected DB state.
 *
 * DB-gated: skips cleanly via describe.skipIf when TEST_DATABASE_URL /
 * DATABASE_URL absent. Uses ephemeral pgboss schemas per spec for parallel-safety.
 *
 * Phase 22 reference: server/streaming/__tests__/subscriber.spec.ts.
 * Phase 21 reference: server/artifacts/__tests__/subscriber.spec.ts.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, and } from 'drizzle-orm';

import correlationPlugin from '../../correlation/plugin.js';
import eventBusPlugin from '../../bus/plugin.js';
import queuePlugin from '../../queue/plugin.js';
import poolPlugin from '../../pool/plugin.js';
import jobsPlugin from '../plugin.js';
import * as schema from '../../db/schema.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;
const SCHEMA = `pgboss_jobs_sub_${Math.random().toString(36).slice(2, 8)}`;

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn('[jobs/subscriber.spec] SKIPPED: set TEST_DATABASE_URL or DATABASE_URL to run');
}

/**
 * Stub auth plugin — jobsPlugin transitively depends on auth (drain endpoint).
 * Mirrors streaming/__tests__/subscriber.spec.ts pattern.
 */
function makeStubAuthPlugin() {
  return fp(async (fastify: FastifyInstance) => {
    fastify.decorate('authService', { validateKey: async () => true } as never);
  }, { name: 'auth', dependencies: ['config'] });
}

describe.skipIf(!HAS_DB)('[Phase 23-06] jobs saga subscribers (SC1 end-to-end)', () => {
  let app: FastifyInstance;
  let sqlClient: ReturnType<typeof postgres>;

  beforeAll(async () => {
    sqlClient = postgres(TEST_DATABASE_URL!);
    await sqlClient.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    const db = drizzle(sqlClient);

    const stubConfigPlugin = fp(async (fastify: FastifyInstance) => {
      fastify.decorate('config', {
        database_url: TEST_DATABASE_URL!,
        auth: { enabled: false },
        storage: { artifacts: { path: `/tmp/df-jobs-sub-${SCHEMA}` } },
        pool: {
          max_devices: 10,
          android: { enabled: false, max_instances: 0 },
          ios: { enabled: false, max_instances: 0 },
        },
        jobs: { timeout_minutes: 30 },
      } as never);
    }, { name: 'config' });

    const liveDbPlugin = fp(async (fastify: FastifyInstance) => {
      fastify.decorate('db', db as unknown as FastifyInstance['db']);
    }, { name: 'db', dependencies: ['config'] });

    app = Fastify({ logger: false, pluginTimeout: 60_000 });
    await app.register(stubConfigPlugin);
    await app.register(correlationPlugin);
    await app.register(liveDbPlugin);
    await app.register(eventBusPlugin);
    await app.register(queuePlugin, { schema: SCHEMA });
    await app.register(makeStubAuthPlugin());
    await app.register(poolPlugin);
    await app.register(jobsPlugin);
    await app.ready();  // triggers jobs onReady saga subscriber wiring
  }, 60_000);

  afterAll(async () => {
    await app?.close().catch(() => { /* ignore */ });
    await sqlClient?.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => { /* ignore */ });
    await sqlClient?.end();
  }, 30_000);

  /**
   * Insert a jobs row in 'queued' or 'running' state. We bypass the gen_random_uuid
   * default by supplying our own jobId to thread through assertions.
   */
  async function insertJobRow(jobId: string, status: 'queued' | 'running' = 'queued'): Promise<void> {
    await app.db.insert(schema.jobs).values({
      id: jobId,
      platform: 'android',
      status: status as never,
      metadata: {},
    });
  }

  /**
   * Insert a devices row so the device.allocated subscriber can reference it.
   */
  async function insertDeviceRow(deviceId: string): Promise<void> {
    await app.db.insert(schema.devices).values({
      id: deviceId,
      name: 'Stub Pixel 7',
      platform: 'android',
      status: 'idle',
      emulatorId: 'stub-emulator',
      port: 5554,
    } as never);
  }

  // ----------------------------------------------------------------
  // Test 1: device.allocated → jobs subscriber writes status='allocated'
  // ----------------------------------------------------------------
  it('[SC1] pool device.allocated → jobs subscriber updates jobs.status=allocated + deviceId', async () => {
    const jobId = randomUUID();
    const deviceId = randomUUID();
    await insertJobRow(jobId);
    await insertDeviceRow(deviceId);

    // Pool emits device.allocated. The jobs subscriber wired in Plan 23-04
    // catches it and updates jobs.status + jobs.deviceId.
    const poolModule = (app as FastifyInstance & {
      poolModule?: { emit: { allocated: (id: string, p: unknown) => void } };
    }).poolModule;

    if (!poolModule) {
      throw new Error('poolModule decorator missing — pool plugin failed to register');
    }

    poolModule.emit.allocated(deviceId, {
      deviceId,
      jobId,
      platform: 'android',
    });

    // Wait for jobs subscriber to write status='allocated'.
    await vi.waitFor(async () => {
      const rows = await app.db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, jobId));
      expect(rows[0]?.status).toBe('allocated');
      expect(rows[0]?.deviceId).toBe(deviceId);
    }, { timeout: 5_000, interval: 100 });
  }, 20_000);

  // ----------------------------------------------------------------
  // Test 2: job.completed → jobs subscriber writes terminal + emits cleanup
  // ----------------------------------------------------------------
  it('[SC1] job.completed → jobs subscriber writes finishedAt + emits job.cleanup.requested (persisted)', async () => {
    const jobId = randomUUID();
    await insertJobRow(jobId, 'running');

    // Drive job.completed via the jobs module emit helper. The subscriber
    // updates jobs.status to terminal + finishedAt set + emits cleanup.requested.
    app.jobsModule.emit.completed(jobId, {
      jobId,
      status: 'passed',
      platform: 'android',
    });

    // Wait for cleanup.requested PERSISTED row in events table.
    await vi.waitFor(async () => {
      const cleanupRows = await app.db
        .select()
        .from(schema.events)
        .where(
          and(
            eq(schema.events.eventType, 'job.cleanup.requested'),
            eq(schema.events.aggregateId, jobId),
          ),
        );
      expect(cleanupRows.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 10_000, interval: 200 });

    // Verify jobs row terminal state landed.
    const rows = await app.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, jobId));
    expect(rows[0]?.status).toBe('passed');
    expect(rows[0]?.finishedAt).toBeTruthy();
  }, 30_000);

  // ----------------------------------------------------------------
  // Test 3: job.failed → jobs subscriber writes status=failed + emits cleanup
  // ----------------------------------------------------------------
  it('[SC1] job.failed → jobs subscriber writes status=failed + errorMessage + emits cleanup.requested', async () => {
    const jobId = randomUUID();
    await insertJobRow(jobId, 'running');

    app.jobsModule.emit.failed(jobId, {
      jobId,
      step: 'run',
      reason: 'maestro returned exit 1',
    });

    // Wait for jobs.status=failed + errorMessage written.
    await vi.waitFor(async () => {
      const rows = await app.db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, jobId));
      expect(rows[0]?.status).toBe('failed');
      expect(rows[0]?.errorMessage).toContain('maestro returned exit 1');
    }, { timeout: 10_000, interval: 200 });

    // Cleanup.requested fired (persisted row in events table).
    await vi.waitFor(async () => {
      const cleanupRows = await app.db
        .select()
        .from(schema.events)
        .where(
          and(
            eq(schema.events.eventType, 'job.cleanup.requested'),
            eq(schema.events.aggregateId, jobId),
          ),
        );
      expect(cleanupRows.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 10_000, interval: 200 });

    // job.failed itself is also persisted (TRACE-08 terminal error).
    const failedRows = await app.db
      .select()
      .from(schema.events)
      .where(
        and(
          eq(schema.events.eventType, 'job.failed'),
          eq(schema.events.aggregateId, jobId),
        ),
      );
    expect(failedRows.length).toBeGreaterThanOrEqual(1);
  }, 30_000);
});
