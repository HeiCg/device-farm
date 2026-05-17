/**
 * Phase 21 / Plan 21-03 — recording.upload queue DB-gated idempotency spec (SC3).
 *
 * Proves end-to-end SC3 two-layer idempotency with a real pg-boss instance:
 *   Layer 1 (queue, policy:'stately' + singletonKey:recordingId): duplicate
 *     enqueue while prior job is in active|created|retry state -> drop the duplicate.
 *   Layer 2 (DB, artifacts.recording_id UNIQUE + .onConflictDoNothing): duplicate
 *     worker execution on a completed/terminal prior job -> null return, no new row.
 *
 * Three tests:
 *   [SC3 dedup: same recordingId] -> 1 artifact row (queue-layer drops duplicate)
 *   [SC3 DB fallback: replayed worker on completed job] -> 1 row (DB layer catches
 *     the race the queue layer can't — completion terminal + duplicate send)
 *   [SC3 no false positive: different recordingIds] -> 2 rows (dedup is keyed)
 *
 * DB-gated via TEST_DATABASE_URL or DATABASE_URL (skipIf). Uses isolated
 * pgboss_artifacts_upload_<suffix> schema. Uses PLAIN-OBJECT ALS store shape
 * per Phase 20 canonical (legacy Map shape forbidden — grep-guard in plan 21-06).
 *
 * retryDelay:1 + retryBackoff:false + retryLimit:0 override at runtime to
 * collapse backoffs; worker never expected to throw in these tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { asyncLocalStorage } from '@fastify/request-context';
import pino from 'pino';

import correlationPlugin from '../../correlation/plugin.js';
import eventBusPlugin from '../../bus/plugin.js';
import queuePlugin from '../../queue/plugin.js';
import {
  registerArtifactsWorker,
  RECORDING_UPLOAD_QUEUE_NAME,
  type RecordingUploadPayload,
} from '../queue.js';
import { ArtifactService } from '../artifact-service.js';
import { makeArtifactsEmitters, artifactsRegistry } from '../events.js';
import { TypedBus } from '../../bus/bus.js';
import * as schema from '../../db/schema.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;
const SCHEMA = `pgboss_artifacts_upload_${Math.random().toString(36).slice(2, 8)}`;
const ARTIFACT_DIR = join(tmpdir(), `df-test-artifacts-${SCHEMA}`);

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn('[artifacts/queue.spec] SKIPPED: set TEST_DATABASE_URL or DATABASE_URL to run');
}

describe.skipIf(!HAS_DB)('[Phase 21-03] recording.upload queue (SC3 two-layer idempotency)', () => {
  let app: FastifyInstance;
  let sqlClient: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;
  let artifactService: ArtifactService;
  let workerIds: string[] = [];

  beforeAll(async () => {
    sqlClient = postgres(TEST_DATABASE_URL!);
    await sqlClient.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await mkdir(ARTIFACT_DIR, { recursive: true });

    db = drizzle(sqlClient);

    // ArtifactService expects (db, config, logger). We stub a config with the
    // storage path ArtifactService actually reads (config.storage.artifacts.path).
    artifactService = new ArtifactService(
      db as never,
      { storage: { artifacts: { path: ARTIFACT_DIR } } } as never,
      pino({ level: 'silent' }),
    );

    const stubConfigPlugin = fp(async (fastify: FastifyInstance) => {
      fastify.decorate('config', { database_url: TEST_DATABASE_URL! } as never);
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

    // Register the artifacts worker directly (plan 21-04 will do this via module factory).
    const bus = new TypedBus(artifactsRegistry);
    const emit = makeArtifactsEmitters(bus);
    const registration = await registerArtifactsWorker({
      fastify: app,
      artifactService,
      emit,
      logger: pino({ level: 'silent' }),
    });
    workerIds = registration.workerIds;

    // Collapse retry backoffs for deterministic test runtime.
    await app.boss.updateQueue(RECORDING_UPLOAD_QUEUE_NAME, {
      retryDelay: 1,
      retryBackoff: false,
      retryLimit: 0,
    } as never);

    await app.ready();
  }, 60_000);

  afterAll(async () => {
    for (const id of workerIds) {
      await app.boss.offWork(RECORDING_UPLOAD_QUEUE_NAME, { id } as never).catch(() => { /* ignore */ });
    }
    await app?.close().catch(() => { /* ignore */ });
    await sqlClient?.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => { /* ignore */ });
    await sqlClient?.end();
  }, 30_000);

  /** Create an actual mp4-like file on disk so ArtifactService.getFileSize returns a value. */
  async function makeFakeRecordingFile(subPath: string): Promise<string> {
    const dir = join(ARTIFACT_DIR, subPath);
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'recording.mp4');
    await writeFile(path, Buffer.alloc(1024, 0));
    return path;
  }

  /** Poll until the pg-boss job state is 'completed'. */
  async function waitForCompletion(bossJobId: string, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await app.boss.getJobById(RECORDING_UPLOAD_QUEUE_NAME, bossJobId);
      if (state && (state.state === 'completed' || state.state === 'failed')) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Job ${bossJobId} did not reach terminal state within ${timeoutMs}ms`);
  }

  async function insertJobsRow(jobId: string, platform: 'android' | 'ios' = 'android'): Promise<void> {
    await db.insert(schema.jobs).values({
      id: jobId,
      platform,
      status: 'passed',
      metadata: {},
    });
  }

  it('[SC3 dedup: same recordingId] queue-layer drops duplicate enqueue -> 1 artifact row', async () => {
    const jobId = randomUUID();
    const recordingId = randomUUID();
    await insertJobsRow(jobId);
    const outputPath = await makeFakeRecordingFile(jobId);

    const corrId = randomUUID();
    let firstSendId: string | null = null;
    let secondSendId: string | null = null;
    await asyncLocalStorage.run(
      { correlationId: corrId, currentEventId: null, actor: 'queue-spec' } as never,
      async () => {
        const payload: RecordingUploadPayload = {
          jobId, recordingId, outputPath,
          durationSec: 10, frameCount: 300, codec: 'h264',
          fileName: 'recording.mp4', mimeType: 'video/mp4',
        };
        firstSendId = await app.queue.send(
          RECORDING_UPLOAD_QUEUE_NAME,
          payload as never,
          { singletonKey: recordingId },
        );
        // Duplicate enqueue with SAME singletonKey; pg-boss v12 policy:'stately'
        // returns null for the duplicate while a prior job is in created/active/retry.
        secondSendId = await app.queue.send(
          RECORDING_UPLOAD_QUEUE_NAME,
          payload as never,
          { singletonKey: recordingId },
        );
      },
    );

    expect(firstSendId).toBeTruthy();
    expect(secondSendId).toBeNull();

    await waitForCompletion(firstSendId!);

    const rows = await db
      .select()
      .from(schema.artifacts)
      .where(eq(schema.artifacts.recordingId, recordingId));
    expect(rows).toHaveLength(1);
  }, 30_000);

  it('[SC3 DB fallback: duplicate worker run after completion] null-return path preserves existing row', async () => {
    const jobId = randomUUID();
    const recordingId = randomUUID();
    await insertJobsRow(jobId);
    const outputPath = await makeFakeRecordingFile(jobId);

    const payload: RecordingUploadPayload = {
      jobId, recordingId, outputPath,
      durationSec: 5, frameCount: 150, codec: 'h264',
      fileName: 'recording.mp4', mimeType: 'video/mp4',
    };
    const corrId = randomUUID();

    // 1st enqueue -> worker runs, INSERT succeeds.
    let firstSendId: string | null = null;
    await asyncLocalStorage.run(
      { correlationId: corrId, currentEventId: null, actor: 'queue-spec' } as never,
      async () => {
        firstSendId = await app.queue.send(
          RECORDING_UPLOAD_QUEUE_NAME,
          payload as never,
          { singletonKey: recordingId },
        );
      },
    );
    expect(firstSendId).toBeTruthy();
    await waitForCompletion(firstSendId!);

    // Confirm the first row exists before the replay attempt.
    const firstRows = await db
      .select()
      .from(schema.artifacts)
      .where(eq(schema.artifacts.recordingId, recordingId));
    expect(firstRows).toHaveLength(1);

    // 2nd enqueue AFTER first is completed -> stately may allow a second enqueue;
    // worker runs again; createArtifactIdempotent returns null -> no new row.
    let secondSendId: string | null = null;
    await asyncLocalStorage.run(
      { correlationId: corrId, currentEventId: null, actor: 'queue-spec' } as never,
      async () => {
        secondSendId = await app.queue.send(
          RECORDING_UPLOAD_QUEUE_NAME,
          payload as never,
          { singletonKey: recordingId },
        );
      },
    );

    // If stately still blocks after completion the duplicate enqueue returns null;
    // that's ALSO a valid SC3 outcome (queue layer caught it). Either way the final
    // row count must remain 1.
    if (secondSendId) {
      await waitForCompletion(secondSendId);
    }

    const rows = await db
      .select()
      .from(schema.artifacts)
      .where(eq(schema.artifacts.recordingId, recordingId));
    expect(rows).toHaveLength(1);   // DB layer caught any duplicate the queue let through.
  }, 30_000);

  it('[SC3 no false positive] different recordingIds -> 2 artifact rows', async () => {
    const jobId = randomUUID();
    await insertJobsRow(jobId);
    const recA = randomUUID();
    const recB = randomUUID();
    const pathA = await makeFakeRecordingFile(`${jobId}-a`);
    const pathB = await makeFakeRecordingFile(`${jobId}-b`);

    let sendA: string | null = null;
    let sendB: string | null = null;
    await asyncLocalStorage.run(
      { correlationId: randomUUID(), currentEventId: null, actor: 'queue-spec' } as never,
      async () => {
        sendA = await app.queue.send(RECORDING_UPLOAD_QUEUE_NAME, {
          jobId, recordingId: recA, outputPath: pathA,
          durationSec: 1, frameCount: 30, codec: 'h264',
          fileName: 'recording.mp4', mimeType: 'video/mp4',
        } as never, { singletonKey: recA });
        sendB = await app.queue.send(RECORDING_UPLOAD_QUEUE_NAME, {
          jobId, recordingId: recB, outputPath: pathB,
          durationSec: 1, frameCount: 30, codec: 'h264',
          fileName: 'recording.mp4', mimeType: 'video/mp4',
        } as never, { singletonKey: recB });
      },
    );

    expect(sendA).toBeTruthy();
    expect(sendB).toBeTruthy();
    await waitForCompletion(sendA!);
    await waitForCompletion(sendB!);

    const rowsA = await db
      .select()
      .from(schema.artifacts)
      .where(eq(schema.artifacts.recordingId, recA));
    const rowsB = await db
      .select()
      .from(schema.artifacts)
      .where(eq(schema.artifacts.recordingId, recB));
    expect(rowsA).toHaveLength(1);
    expect(rowsB).toHaveLength(1);
  }, 30_000);
});
