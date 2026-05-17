/**
 * Phase 18 / Plan 18-02 — lifecycle queue contract DB-gated integration spec.
 *
 * Proves:
 *   - registerLifecycleSchedulesAndWorkers creates 3 queues, 3 schedules, 3 workers.
 *   - boss.getSchedules() returns the 3 named schedules with correct crons AND
 *     data.correlationId === null (Option B per-fire correlationId, plan 18-00 fix).
 *   - policy:'stately' + singletonKey dedup: second send with same singletonKey returns null.
 *
 * Gated on TEST_DATABASE_URL / DATABASE_URL. Isolated pg-boss schema.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import postgres from 'postgres';
import pino from 'pino';

import { correlationPlugin } from '../../correlation/index.js';
import queuePlugin from '../../queue/plugin.js';
import { QUEUE_NAMES } from '../../queue/names.js';
import {
  registerLifecycleSchedulesAndWorkers,
  LIFECYCLE_COMPRESS_DAILY_QUEUE_NAME,
  LIFECYCLE_RETENTION_DAILY_QUEUE_NAME,
  LIFECYCLE_DISK_HOURLY_QUEUE_NAME,
  COMPRESS_CRON,
  RETENTION_CRON,
  DISK_CRON,
} from '../queue.js';
import type { LifecycleEmitters } from '../events.js';
import type { LifecycleStats } from '../stats.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;
const SCHEMA = 'pgboss_lifecycle_queue_spec';

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn('[lifecycle/queue.spec] SKIPPED: set TEST_DATABASE_URL to run');
}

function makeStubConfigPlugin(databaseUrl: string) {
  return fp(async (fastify: FastifyInstance) => {
    fastify.decorate('config', {
      database_url: databaseUrl,
      storage: {
        artifacts: {
          path: '/tmp/artifacts-spec',
          retention_days: 30,
          compress_after_days: 7,
          format: 'mp4' as const,
          max_storage_gb: 50,
        },
      },
    } as never);
  }, { name: 'config' });
}

const stubDbPlugin = fp(async (fastify: FastifyInstance) => {
  fastify.decorate('db', {} as never);
}, { name: 'db' });

const noopEmit: LifecycleEmitters = {
  compressionCompleted: (() => { /* no-op */ }) as never,
  retentionCompleted:   (() => { /* no-op */ }) as never,
  diskChecked:          (() => { /* no-op */ }) as never,
  taskFailed:           (() => { /* no-op */ }) as never,
};

const emptyStats: LifecycleStats = {
  lastCompressionRun: null,
  lastRetentionRun:   null,
  lastDiskCheck:      null,
};

describe.skipIf(!HAS_DB)('lifecycle queue contract (Phase 18-02)', () => {
  let app: FastifyInstance;
  let client: ReturnType<typeof postgres>;
  let workerIds: string[] = [];

  beforeAll(async () => {
    client = postgres(TEST_DATABASE_URL!);
    await client.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);

    app = Fastify({ logger: false });
    await app.register(makeStubConfigPlugin(TEST_DATABASE_URL!));
    await app.register(stubDbPlugin);
    await app.register(correlationPlugin);
    await app.register(queuePlugin, { schema: SCHEMA });
    await app.ready();

    const registration = await registerLifecycleSchedulesAndWorkers({
      fastify: app,
      db: app.db as never,
      config: app.config as never,
      emit: noopEmit,
      stats: emptyStats,
      logger: pino({ level: 'silent' }),
    });
    workerIds = registration.workerIds;
  }, 30_000);

  afterAll(async () => {
    for (const id of workerIds) {
      await app.boss.offWork(id).catch(() => { /* ignore */ });
    }
    await app?.close();
    await client?.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => { /* ignore */ });
    await client?.end();
  });

  it('registers 3 distinct worker ids', () => {
    expect(workerIds).toHaveLength(3);
    expect(new Set(workerIds).size).toBe(3);
    for (const id of workerIds) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it('boss.getSchedules returns 3 schedules with expected crons AND data.correlationId=null', async () => {
    const schedules = await app.boss.getSchedules();
    const byName = new Map(schedules.map((s: { name: string }) => [s.name, s]));

    const compress = byName.get(LIFECYCLE_COMPRESS_DAILY_QUEUE_NAME) as {
      cron: string;
      data: { correlationId: unknown; actor: string };
    } | undefined;
    const retention = byName.get(LIFECYCLE_RETENTION_DAILY_QUEUE_NAME) as {
      cron: string;
      data: { correlationId: unknown; actor: string };
    } | undefined;
    const disk = byName.get(LIFECYCLE_DISK_HOURLY_QUEUE_NAME) as {
      cron: string;
      data: { correlationId: unknown; actor: string };
    } | undefined;

    expect(compress).toBeDefined();
    expect(retention).toBeDefined();
    expect(disk).toBeDefined();

    expect(compress!.cron).toBe(COMPRESS_CRON);
    expect(retention!.cron).toBe(RETENTION_CRON);
    expect(disk!.cron).toBe(DISK_CRON);

    // Plan 18-00 Option B fix — stored correlationId must be null so queue.work generates per-fire.
    expect(compress!.data.correlationId).toBeNull();
    expect(retention!.data.correlationId).toBeNull();
    expect(disk!.data.correlationId).toBeNull();

    // actor stamped as 'cron' at schedule time (this did NOT change).
    expect(compress!.data.actor).toBe('cron');
  });

  it('[RESEARCH §Pitfall 1] policy:stately + singletonKey dedup: second send returns null', async () => {
    const QUEUE = QUEUE_NAMES.LIFECYCLE_COMPRESS_DAILY;
    // registerLifecycleSchedulesAndWorkers already called createQueue with policy:'stately'.
    const key = `${QUEUE}-dedup-test`;

    const job1 = await app.queue.send(QUEUE, { marker: 'dedup-1' }, { singletonKey: key, retryLimit: 1 });
    const job2 = await app.queue.send(QUEUE, { marker: 'dedup-2' }, { singletonKey: key, retryLimit: 1 });

    expect(job1).toBeTruthy();
    expect(job2).toBeNull();
  });
});
