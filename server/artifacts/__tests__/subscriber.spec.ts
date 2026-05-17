/**
 * Phase 21 / Plan 21-05 — Artifacts bus subscriber DB-gated spec (SC1 + MOD-08).
 *
 * Proves end-to-end that artifact-service side-effects are driven by bus events,
 * not by direct calls. Three tests covering the 3 subscribers:
 *   [SC1 job.started]       → recordingService.startRecording + emit recording.started
 *   [SC1 job.completed]     → stopRecording + enqueue recording.upload + emit recording.stopped
 *   [SC1 maestro.log.written] → artifactService.createArtifact(log) + emit artifact.created
 *
 * DB-gated via TEST_DATABASE_URL or DATABASE_URL (skipIf). Uses isolated
 * pgboss_artifacts_sub_<suffix> schema. Boots a minimal Fastify stack that
 * mimics server/index.ts ordering:
 *   config → correlation → db → event-bus → queue → pool (drivers disabled) →
 *   stub-jobs-plugin (decorates jobsModule) → artifacts plugin.
 *
 * Uses makeStubRecordingService from ./fixtures/stub-recording-service.ts to
 * avoid real adb/scrcpy dependency. Swapped via direct assignment on
 * fastify.artifactsModule.recordingService AFTER plugin register (safe because
 * the only consumer is the subscribers inside registerWorkersAndSubscribers).
 *
 * Uses PLAIN-OBJECT ALS store shape per Phase 20 canonical.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { asyncLocalStorage } from '@fastify/request-context';

import correlationPlugin from '../../correlation/plugin.js';
import eventBusPlugin from '../../bus/plugin.js';
import queuePlugin from '../../queue/plugin.js';
import poolPlugin from '../../pool/plugin.js';
import artifactsPlugin from '../plugin.js';
import { TypedBus } from '../../bus/bus.js';
import { jobsRegistry, makeJobsEmitters, type JobsRegistry } from '../../jobs/events.js';
import { RECORDING_UPLOAD_QUEUE_NAME } from '../queue.js';
import { ARTIFACTS_EVENT_NAMES } from '../events.js';
import { makeStubRecordingService } from './fixtures/stub-recording-service.js';
import * as schema from '../../db/schema.js';
import type { Envelope } from '../../events/envelope.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;
const SCHEMA = `pgboss_artifacts_sub_${Math.random().toString(36).slice(2, 8)}`;

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn('[artifacts/subscriber.spec] SKIPPED: set TEST_DATABASE_URL or DATABASE_URL to run');
}

/** Stub jobs-plugin: decorates fastify.jobsModule with bus + 3-key emitters. */
function makeStubJobsPlugin() {
  return fp(async (fastify: FastifyInstance) => {
    const bus = new TypedBus(jobsRegistry);
    const ee = (bus as unknown as { ee: import('node:events').EventEmitter }).ee;
    const emit = makeJobsEmitters(bus, (env: Envelope) => {
      // Forward side-channel for onPersisted subscribers (same mechanism as bus/plugin.ts).
      ee.emit(`${env.type}.envelope`, env);
      // Persist only for persisted entries (matches real behaviour).
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

describe.skipIf(!HAS_DB)('[Phase 21-05] artifacts bus subscribers (SC1 end-to-end)', () => {
  let app: FastifyInstance;
  let sqlClient: ReturnType<typeof postgres>;

  beforeAll(async () => {
    sqlClient = postgres(TEST_DATABASE_URL!);
    await sqlClient.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    const db = drizzle(sqlClient);

    const stubConfigPlugin = fp(async (fastify: FastifyInstance) => {
      fastify.decorate('config', {
        database_url: TEST_DATABASE_URL!,
        storage: { artifacts: { path: `/tmp/df-sub-${SCHEMA}` } },
        pool: {
          max_devices: 10,
          android: { enabled: false, max_instances: 0 },
          ios: { enabled: false, max_instances: 0 },
        },
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
    await app.ready();  // triggers artifacts onReady subscriber registration

    // Swap in stub recording service AFTER subscribers are registered.
    // Safe because subscribers read from the (fastify.artifactsModule as any).recordingService
    // reference at event-fire time, not capture-at-boot.
    (app.artifactsModule as unknown as { recordingService: unknown }).recordingService = makeStubRecordingService();

    // Collapse retry backoffs.
    await app.boss.updateQueue(RECORDING_UPLOAD_QUEUE_NAME, {
      retryDelay: 1, retryBackoff: false, retryLimit: 0,
    } as never);
  }, 60_000);

  afterAll(async () => {
    await app?.close().catch(() => { /* ignore */ });
    await sqlClient?.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => { /* ignore */ });
    await sqlClient?.end();
  }, 30_000);

  async function insertJobsRow(jobId: string): Promise<void> {
    await app.db.insert(schema.jobs).values({ id: jobId, platform: 'android', status: 'running', metadata: {} });
  }

  it('[SC1 job.started] emit triggers recordingService.startRecording + emit.recordingStarted', async () => {
    const jobId = randomUUID();
    await insertJobsRow(jobId);

    // Subscribe to artifacts bus to capture recording.started envelope.
    type RecordingStartedPayload = { recordingId: string; jobId: string; method: string };
    const captured: RecordingStartedPayload[] = [];
    const unsub = app.artifactsModule.bus.on(
      ARTIFACTS_EVENT_NAMES.RECORDING_STARTED as never,
      (payload: unknown) => { captured.push(payload as RecordingStartedPayload); },
    );

    try {
      const corrId = randomUUID();
      await asyncLocalStorage.run(
        { correlationId: corrId, currentEventId: null, actor: 'subscriber-spec' } as never,
        async () => {
          // Trigger job.started.
          app.jobsModule.emit.started(jobId, { jobId, deviceId: randomUUID(), platform: 'android' });
          // Subscriber is async — give it a tick.
          await new Promise(r => setTimeout(r, 100));
        },
      );

      expect(captured.length).toBeGreaterThanOrEqual(1);
      expect(captured[0].jobId).toBe(jobId);
      expect(captured[0].recordingId).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      unsub();
    }
  }, 20_000);

  it('[SC1 job.completed] emit triggers stopRecording + enqueues recording.upload with singletonKey', async () => {
    const jobId = randomUUID();
    await insertJobsRow(jobId);

    const corrId = randomUUID();
    const startedEnvelopes: Array<{ recordingId: string }> = [];
    const unsubStarted = app.artifactsModule.bus.on(
      ARTIFACTS_EVENT_NAMES.RECORDING_STARTED as never,
      (payload: unknown) => { startedEnvelopes.push(payload as { recordingId: string }); },
    );

    try {
      await asyncLocalStorage.run(
        { correlationId: corrId, currentEventId: null, actor: 'subscriber-spec' } as never,
        async () => {
          app.jobsModule.emit.started(jobId, { jobId, deviceId: randomUUID(), platform: 'android' });
          await new Promise(r => setTimeout(r, 100));
          app.jobsModule.emit.completed(jobId, { jobId, status: 'passed', platform: 'android' });
          await new Promise(r => setTimeout(r, 300));
        },
      );

      expect(startedEnvelopes.length).toBeGreaterThanOrEqual(1);
      const recordingId = startedEnvelopes[0].recordingId;
      expect(recordingId).toMatch(/^[0-9a-f-]{36}$/);

      // Assert recording.upload was enqueued with singletonKey: recordingId.
      // findJobs returns rows across all states — the worker may have already
      // picked it up (active|completed) or it may still be waiting (created).
      const jobs = await app.boss.findJobs(RECORDING_UPLOAD_QUEUE_NAME);
      const found = jobs.find((j) => {
        const d = j.data as { recordingId?: string } | null;
        return d?.recordingId === recordingId;
      });
      expect(found).toBeDefined();
      expect((found?.data as { recordingId?: string })?.recordingId).toBe(recordingId);
      // pg-boss stores singletonKey in the internal `singleton_key` column —
      // findJobs projects it onto `singletonKey` on the returned row.
      expect(found?.singletonKey).toBe(recordingId);
    } finally {
      unsubStarted();
    }
  }, 20_000);

  it('[SC1 maestro.log.written] emit triggers artifactService.createArtifact(type:log) + emit artifact.created', async () => {
    const jobId = randomUUID();
    await insertJobsRow(jobId);

    // Write the fake maestro.log file (subscriber calls createArtifact but path must exist for getFileSize).
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const dir = join('/tmp', `df-sub-${SCHEMA}`, jobId);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, 'maestro.log');
    await writeFile(filePath, 'fake maestro stdout', 'utf-8');

    type ArtifactCreatedPayload = { artifactId: string; type: string; jobId: string };
    const artifactCreatedEvents: ArtifactCreatedPayload[] = [];
    const unsub = app.artifactsModule.bus.on(
      ARTIFACTS_EVENT_NAMES.ARTIFACT_CREATED as never,
      (payload: unknown) => {
        const p = payload as ArtifactCreatedPayload;
        if (p.type === 'log' && p.jobId === jobId) artifactCreatedEvents.push(p);
      },
    );

    try {
      await asyncLocalStorage.run(
        { correlationId: randomUUID(), currentEventId: null, actor: 'subscriber-spec' } as never,
        async () => {
          app.jobsModule.emit.maestroLogWritten(jobId, {
            jobId, filePath, fileName: 'maestro.log',
            mimeType: 'text/plain', fileSizeBytes: 20,
          });
          await new Promise(r => setTimeout(r, 200));
        },
      );

      expect(artifactCreatedEvents.length).toBeGreaterThanOrEqual(1);
      expect(artifactCreatedEvents[0].type).toBe('log');

      // Verify DB row.
      const rows = await app.db.select().from(schema.artifacts)
        .where(eq(schema.artifacts.jobId, jobId));
      expect(rows.some((r) => r.type === 'log')).toBe(true);
    } finally {
      unsub();
    }
  }, 20_000);
});
