/**
 * Phase 23 / Plan 23-06 — jobs saga correlation DB-gated spec [TRACE-04 / SC1].
 *
 * Proves a single correlationId threads end-to-end via ALS:
 *   asyncLocalStorage.run({correlationId: cid}, () => emit.completed(...))
 *   ⤷ jobs subscriber emits job.cleanup.requested (persisted)
 *   ⤷ both rows in events table carry correlationId === cid.
 *
 * Phase 21 reference: server/artifacts/__tests__/correlation.spec.ts.
 * Phase 22 reference: server/streaming/__tests__/correlation.spec.ts.
 *
 * DB-gated: skips cleanly when TEST_DATABASE_URL / DATABASE_URL absent.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, and } from 'drizzle-orm';
import { asyncLocalStorage } from '@fastify/request-context';

import correlationPlugin from '../../correlation/plugin.js';
import eventBusPlugin from '../../bus/plugin.js';
import queuePlugin from '../../queue/plugin.js';
import poolPlugin from '../../pool/plugin.js';
import jobsPlugin from '../plugin.js';
import * as schema from '../../db/schema.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;
const SCHEMA = `pgboss_jobs_corr_${Math.random().toString(36).slice(2, 8)}`;

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn('[jobs/correlation.spec] SKIPPED: set TEST_DATABASE_URL or DATABASE_URL to run');
}

function makeStubAuthPlugin() {
  return fp(async (fastify: FastifyInstance) => {
    fastify.decorate('authService', { validateKey: async () => true } as never);
  }, { name: 'auth', dependencies: ['config'] });
}

describe.skipIf(!HAS_DB)('[Phase 23-06] jobs saga correlationId end-to-end (TRACE-04 / SC1)', () => {
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
        storage: { artifacts: { path: `/tmp/df-jobs-corr-${SCHEMA}` } },
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
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close().catch(() => { /* ignore */ });
    await sqlClient?.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => { /* ignore */ });
    await sqlClient?.end();
  }, 30_000);

  async function insertJobRow(jobId: string, status: 'queued' | 'running' = 'running'): Promise<void> {
    await app.db.insert(schema.jobs).values({
      id: jobId,
      platform: 'android',
      status: status as never,
      metadata: {},
    });
  }

  // ----------------------------------------------------------------
  // Test 1: correlationId threads through job.completed → cleanup chain
  // ----------------------------------------------------------------
  it('[TRACE-04 / SC1] cid threads through job.completed + job.cleanup.requested persisted rows', async () => {
    const cid = randomUUID();
    const jobId = randomUUID();
    await insertJobRow(jobId, 'running');

    // PLAIN-OBJECT ALS store shape per Phase 20 canonical (NOT legacy Map).
    await asyncLocalStorage.run(
      { correlationId: cid, currentEventId: null, actor: 'jobs-correlation-spec' } as never,
      async () => {
        app.jobsModule.emit.completed(jobId, {
          jobId,
          status: 'passed',
          platform: 'android',
        });
      },
    );

    // Both job.completed (Phase 19 persisted) AND job.cleanup.requested
    // (Phase 23 persisted) must land in events table with correlationId === cid.
    await vi.waitFor(async () => {
      const completedRows = await app.db
        .select()
        .from(schema.events)
        .where(
          and(
            eq(schema.events.eventType, 'job.completed'),
            eq(schema.events.aggregateId, jobId),
          ),
        );
      const cleanupRows = await app.db
        .select()
        .from(schema.events)
        .where(
          and(
            eq(schema.events.eventType, 'job.cleanup.requested'),
            eq(schema.events.aggregateId, jobId),
          ),
        );

      expect(completedRows.length).toBeGreaterThanOrEqual(1);
      expect(cleanupRows.length).toBeGreaterThanOrEqual(1);
      expect(completedRows[0].correlationId).toBe(cid);
      expect(cleanupRows[0].correlationId).toBe(cid);
    }, { timeout: 10_000, interval: 200 });
  }, 30_000);

  // ----------------------------------------------------------------
  // Test 2: correlationId threads through job.failed → cleanup chain
  // ----------------------------------------------------------------
  it('[TRACE-04 / SC1] cid threads through job.failed + cleanup.requested persisted rows', async () => {
    const cid = randomUUID();
    const jobId = randomUUID();
    await insertJobRow(jobId, 'running');

    await asyncLocalStorage.run(
      { correlationId: cid, currentEventId: null, actor: 'jobs-correlation-spec' } as never,
      async () => {
        app.jobsModule.emit.failed(jobId, {
          jobId,
          step: 'run',
          reason: 'maestro returned exit 1 (correlation test)',
        });
      },
    );

    await vi.waitFor(async () => {
      const failedRows = await app.db
        .select()
        .from(schema.events)
        .where(
          and(
            eq(schema.events.eventType, 'job.failed'),
            eq(schema.events.aggregateId, jobId),
          ),
        );
      const cleanupRows = await app.db
        .select()
        .from(schema.events)
        .where(
          and(
            eq(schema.events.eventType, 'job.cleanup.requested'),
            eq(schema.events.aggregateId, jobId),
          ),
        );

      expect(failedRows.length).toBeGreaterThanOrEqual(1);
      expect(cleanupRows.length).toBeGreaterThanOrEqual(1);
      expect(failedRows[0].correlationId).toBe(cid);
      expect(cleanupRows[0].correlationId).toBe(cid);
    }, { timeout: 10_000, interval: 200 });
  }, 30_000);
});
