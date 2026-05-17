/**
 * Phase 21 / Plan 21-05 — Artifacts correlation DB-gated spec (SC4 + TRACE-04 + TRACE-09).
 *
 * Proves single correlationId threads end-to-end:
 *   ALS.run(correlationId) → jobsEmit.completed → onPersisted(job.completed) subscriber →
 *   fastify.queue.send(RECORDING_UPLOAD, {}, {singletonKey}) → recording.upload worker executes →
 *   artifactService.createArtifactIdempotent → emit.artifactCreated →
 *   events-table row for 'artifact.created' has correlation_id = original UUID.
 *
 * Also proves TRACE-09 causation chaining: the artifact.created row's causation_id
 * equals the job.completed envelope's id (the Phase 15 substrate's onPersisted
 * wrapper sets currentEventId in ALS before invoking the subscriber; subsequent
 * emit calls read it as causationId).
 *
 * DB-gated + isolated pgboss_artifacts_corr_<suffix> schema. Uses stub-recording-service.
 * Uses PLAIN-OBJECT ALS store shape per Phase 20 canonical.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, and } from 'drizzle-orm';
import { asyncLocalStorage } from '@fastify/request-context';

import correlationPlugin from '../../correlation/plugin.js';
import eventBusPlugin from '../../bus/plugin.js';
import queuePlugin from '../../queue/plugin.js';
import poolPlugin from '../../pool/plugin.js';
import artifactsPlugin from '../plugin.js';
import { TypedBus } from '../../bus/bus.js';
import { jobsRegistry, makeJobsEmitters, type JobsRegistry } from '../../jobs/events.js';
import { RECORDING_UPLOAD_QUEUE_NAME } from '../queue.js';
import { makeStubRecordingService } from './fixtures/stub-recording-service.js';
import * as schema from '../../db/schema.js';
import type { Envelope } from '../../events/envelope.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;
const SCHEMA = `pgboss_artifacts_corr_${Math.random().toString(36).slice(2, 8)}`;

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn('[artifacts/correlation.spec] SKIPPED: set TEST_DATABASE_URL or DATABASE_URL to run');
}

function makeStubJobsPlugin() {
  return fp(async (fastify: FastifyInstance) => {
    const bus = new TypedBus(jobsRegistry);
    const ee = (bus as unknown as { ee: import('node:events').EventEmitter }).ee;
    const emit = makeJobsEmitters(bus, (env: Envelope) => {
      // Fire side-channel FIRST so onPersisted subscribers observe the envelope
      // on the same call stack as the originating emit (TRACE-09 causation path).
      ee.emit(`${env.type}.envelope`, env);
      const entry = jobsRegistry[env.type as keyof JobsRegistry];
      if (entry?.persisted) {
        void (async () => {
          try {
            await fastify.db.insert(schema.events).values({
              id: env.id,
              eventType: env.type,
              eventVersion: env.v,
              correlationId: env.correlationId,
              causationId: env.causationId ?? undefined,
              aggregateType: env.aggregateType,
              aggregateId: env.aggregateId,
              payload: env.payload as unknown,
              occurredAt: new Date(env.occurredAt),
              actor: env.actor,
            });
          } catch {
            /* test cleanup tolerates */
          }
        })();
      }
    });
    fastify.decorate('jobsModule', { bus, emit });
  }, { name: 'job-plugin', dependencies: ['db', 'event-bus'] });
}

describe.skipIf(!HAS_DB)('[Phase 21-05] artifacts correlation (SC4 + TRACE-04 + TRACE-09)', () => {
  let app: FastifyInstance;
  let sqlClient: ReturnType<typeof postgres>;
  const ART_DIR = `/tmp/df-corr-${SCHEMA}`;

  beforeAll(async () => {
    sqlClient = postgres(TEST_DATABASE_URL!);
    await sqlClient.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await mkdir(ART_DIR, { recursive: true });
    const db = drizzle(sqlClient);

    const stubConfigPlugin = fp(async (fastify: FastifyInstance) => {
      fastify.decorate('config', {
        database_url: TEST_DATABASE_URL!,
        storage: { artifacts: { path: ART_DIR } },
        pool: { max_devices: 10, android: { enabled: false, max_instances: 0 }, ios: { enabled: false, max_instances: 0 } },
      } as never);
    }, { name: 'config' });

    const liveDbPlugin = fp(async (fastify: FastifyInstance) => {
      fastify.decorate('db', db as unknown as FastifyInstance['db']);
    }, { name: 'db' });

    app = Fastify({ logger: false, pluginTimeout: 60_000 });
    await app.register(stubConfigPlugin);
    await app.register(correlationPlugin);
    await app.register(liveDbPlugin);
    await app.register(eventBusPlugin);
    await app.register(queuePlugin, { schema: SCHEMA });
    await app.register(poolPlugin);
    await app.register(makeStubJobsPlugin());
    await app.register(artifactsPlugin);
    await app.ready();

    (app.artifactsModule as unknown as { recordingService: unknown }).recordingService = makeStubRecordingService();

    await app.boss.updateQueue(RECORDING_UPLOAD_QUEUE_NAME, {
      retryDelay: 1, retryBackoff: false, retryLimit: 0,
    } as never);
  }, 60_000);

  afterAll(async () => {
    await app?.close().catch(() => { /* ignore */ });
    await sqlClient?.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => { /* ignore */ });
    await sqlClient?.end();
  }, 30_000);

  /** Poll events table for matching rows. */
  async function findEvents(correlationId: string, eventType: string, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const rows = await app.db.select().from(schema.events).where(
        and(eq(schema.events.correlationId, correlationId), eq(schema.events.eventType, eventType)),
      );
      if (rows.length > 0) return rows;
      await new Promise(r => setTimeout(r, 200));
    }
    return [];
  }

  it('[SC4 + TRACE-04] single correlationId threads from ALS → job.completed → recording.upload worker → artifact.created row', async () => {
    const jobId = randomUUID();
    await app.db.insert(schema.jobs).values({ id: jobId, platform: 'android', status: 'running', metadata: {} });
    const fakeOutputPath = join(ART_DIR, jobId, 'recording.mp4');
    await mkdir(join(ART_DIR, jobId), { recursive: true });
    await writeFile(fakeOutputPath, Buffer.alloc(1024, 0));

    const correlationId = randomUUID();

    await asyncLocalStorage.run(
      { correlationId, currentEventId: null, actor: 'correlation-spec' } as never,
      async () => {
        app.jobsModule.emit.started(jobId, { jobId, deviceId: randomUUID(), platform: 'android' });
        await new Promise(r => setTimeout(r, 100));
        app.jobsModule.emit.completed(jobId, { jobId, status: 'passed', platform: 'android' });
      },
    );

    // Wait up to 15s for artifact.created persisted row with our correlationId.
    const artifactRows = await findEvents(correlationId, 'artifact.created');
    expect(artifactRows.length).toBeGreaterThanOrEqual(1);
    expect(artifactRows[0].correlationId).toBe(correlationId);

    // TRACE-09 causation — find the job.completed envelope id, then assert at least
    // one artifact.created row's causationId matches.
    const jobCompletedRows = await findEvents(correlationId, 'job.completed');
    expect(jobCompletedRows.length).toBe(1);
    const jobCompletedId = jobCompletedRows[0].id;
    const anyArtifact = artifactRows.find(r => r.causationId === jobCompletedId);
    expect(anyArtifact).toBeDefined();
  }, 30_000);
});
