/**
 * Phase 31 Plan 31-01 — Streaming log-parsing integration spec (SC1 end-to-end).
 *
 * Proves the streaming subscriber:
 *   1. Calls parseLogcatLine on incoming job.log payloads.
 *   2. On first crash detection per jobId: sets jobs.failure_class='crash' AND
 *      emits a single `crash-detected` WS envelope carrying the firstLine.
 *   3. Subsequent crash markers for the same job are suppressed
 *      (firstCrashSeen Set gate — Pitfall 7 in 31-RESEARCH.md).
 *   4. Normal log streams (no crash markers) leave failure_class NULL and
 *      emit zero `crash-detected` events.
 *
 * DB-gated. Uses live postgres + ephemeral pg-boss schema. Skips cleanly
 * when no DATABASE_URL is set (mirrors correlation.spec.ts pattern).
 */
import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';

import correlationPlugin from '../../correlation/plugin.js';
import eventBusPlugin from '../../bus/plugin.js';
import queuePlugin from '../../queue/plugin.js';
import streamingPlugin from '../plugin.js';
import { TypedBus } from '../../bus/bus.js';
import { jobsRegistry, makeJobsEmitters, type JobsRegistry } from '../../jobs/events.js';
import type { WsEnvelope } from '../internal/ws-schemas.js';
import type { Envelope } from '../../events/envelope.js';
import * as schema from '../../db/schema.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn(
    '[streaming/log-parsing-integration.spec] SKIPPED: set TEST_DATABASE_URL or DATABASE_URL to run',
  );
}

const FIXTURES_DIR = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
  '..',
  'jobs',
  '__tests__',
  'fixtures',
);

function loadFixture(name: string): string[] {
  const content = readFileSync(join(FIXTURES_DIR, name), 'utf-8');
  return content
    .split('\n')
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

function makeStubConfigPlugin() {
  return fp(
    async (fastify: FastifyInstance) => {
      fastify.decorate('config', {
        database_url: TEST_DATABASE_URL!,
        auth: { enabled: false },
        storage: { artifacts: { path: '/tmp/df-streaming-logparse-test' } },
        pool: {
          max_devices: 10,
          android: { enabled: false, max_instances: 0 },
          ios: { enabled: false, max_instances: 0 },
        },
      } as never);
    },
    { name: 'config' },
  );
}

function makeStubAuthPlugin() {
  return fp(
    async (fastify: FastifyInstance) => {
      fastify.decorate('authService', { validateKey: async () => true } as never);
    },
    { name: 'auth', dependencies: ['config'] },
  );
}

function makeStubPoolPlugin() {
  return fp(
    async (fastify: FastifyInstance) => {
      fastify.decorate('pool', {
        getDevice: () => ({ id: 'stub', platform: 'android', port: 5554, emulatorId: 'stub' }),
      } as never);
    },
    { name: 'pool-plugin', dependencies: ['config'] },
  );
}

function makeStubJobsPlugin() {
  return fp(
    async (fastify: FastifyInstance) => {
      const bus = new TypedBus(jobsRegistry);
      const ee = (bus as unknown as { ee: EventEmitter }).ee;
      const emit = makeJobsEmitters(bus, (env: Envelope) => {
        ee.emit(`${env.type}.envelope`, env);
        const entry = jobsRegistry[env.type as keyof JobsRegistry];
        if (!entry || !entry.persisted) return;
      });
      fastify.decorate('jobsModule', { bus, emit } as never);
    },
    { name: 'stub-jobs-plugin', dependencies: ['event-bus'] },
  );
}

interface AppWithDbClient extends FastifyInstance {
  __dbClient?: ReturnType<typeof postgres>;
  __schemaName?: string;
}

async function buildStack(): Promise<AppWithDbClient> {
  const schemaName = `pgboss_logparse_${Math.random().toString(36).slice(2, 8)}`;
  const sqlClient = postgres(TEST_DATABASE_URL!);
  await sqlClient.unsafe(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  const db = drizzle(sqlClient, { schema });

  const liveDbPlugin = fp(
    async (fastify: FastifyInstance) => {
      fastify.decorate('db', db as unknown as FastifyInstance['db']);
    },
    { name: 'db', dependencies: ['config'] },
  );

  const app = Fastify({ logger: false, pluginTimeout: 60_000 }) as AppWithDbClient;
  app.__dbClient = sqlClient;
  app.__schemaName = schemaName;

  await app.register(makeStubConfigPlugin());
  await app.register(correlationPlugin);
  await app.register(liveDbPlugin);
  await app.register(eventBusPlugin);
  await app.register(queuePlugin, { schema: schemaName });
  await app.register(makeStubAuthPlugin());
  await app.register(makeStubPoolPlugin());
  await app.register(makeStubJobsPlugin());
  await app.register(streamingPlugin);
  await app.ready();
  return app;
}

async function insertTestJob(app: AppWithDbClient): Promise<string> {
  const [row] = await app.db
    .insert(schema.jobs)
    .values({
      status: 'running',
      platform: 'android',
    })
    .returning({ id: schema.jobs.id });
  return row.id;
}

async function cleanupApp(app: AppWithDbClient | null): Promise<void> {
  if (!app) return;
  const sqlClient = app.__dbClient;
  const schemaName = app.__schemaName;
  try {
    await app.close();
  } catch {
    /* swallow */
  }
  if (sqlClient && schemaName) {
    await sqlClient.unsafe(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`).catch(() => {
      /* ignore */
    });
  }
  if (sqlClient) {
    await sqlClient.end().catch(() => {
      /* ignore */
    });
  }
}

describe.skipIf(!HAS_DB)('[Phase 31-01 SC1] streaming log-parsing integration', () => {
  let app: AppWithDbClient | null = null;

  afterEach(async () => {
    await cleanupApp(app);
    app = null;
  }, 30_000);

  it('single crash detection: failure_class set once across mixed traffic', async () => {
    app = await buildStack();
    const jobsModule = (
      app as unknown as { jobsModule: { emit: ReturnType<typeof makeJobsEmitters> } }
    ).jobsModule;
    const jobId = await insertTestJob(app);

    const received: WsEnvelope[] = [];
    const unsub = app.jobBroadcaster.subscribe(jobId, (env) => received.push(env));

    // Feed the mixed fixture — 100+ lines with a single embedded crash sequence
    // (9 lines that all match crash markers). Per Pitfall 7, the gate must
    // produce exactly ONE crash-detected event.
    const lines = loadFixture('logcat-mixed.txt');
    for (const line of lines) {
      jobsModule.emit.log(jobId, { jobId, data: { line, stream: 'stdout' } });
    }

    // Drain fire-and-forget DB write.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const crashEvents = received.filter((env) => env.type === 'crash-detected');
    expect(crashEvents).toHaveLength(1);

    const [row] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(row.failureClass).toBe('crash');

    unsub();
  }, 60_000);

  it('crash event payload carries firstLine of crash sequence', async () => {
    app = await buildStack();
    const jobsModule = (
      app as unknown as { jobsModule: { emit: ReturnType<typeof makeJobsEmitters> } }
    ).jobsModule;
    const jobId = await insertTestJob(app);

    const received: WsEnvelope[] = [];
    const unsub = app.jobBroadcaster.subscribe(jobId, (env) => received.push(env));

    const firstCrashLine =
      '12-15 10:23:42.451  1234  1234 E AndroidRuntime: FATAL EXCEPTION: main';
    const followupLine =
      '12-15 10:23:42.451  1234  1234 E AndroidRuntime: java.lang.NullPointerException: oops';

    jobsModule.emit.log(jobId, { jobId, data: { line: firstCrashLine, stream: 'stdout' } });
    jobsModule.emit.log(jobId, { jobId, data: { line: followupLine, stream: 'stdout' } });

    await new Promise((resolve) => setTimeout(resolve, 200));

    const crashEvents = received.filter((env) => env.type === 'crash-detected');
    expect(crashEvents).toHaveLength(1);
    const payload = crashEvents[0].payload as { firstLine: string };
    expect(payload.firstLine).toBe(firstCrashLine);

    unsub();
  }, 60_000);

  it('no false positive: normal log stream leaves failure_class NULL', async () => {
    app = await buildStack();
    const jobsModule = (
      app as unknown as { jobsModule: { emit: ReturnType<typeof makeJobsEmitters> } }
    ).jobsModule;
    const jobId = await insertTestJob(app);

    const received: WsEnvelope[] = [];
    const unsub = app.jobBroadcaster.subscribe(jobId, (env) => received.push(env));

    // ANR fixture contains level E lines + the word "ANR" but NO crash markers.
    // 3-of-3 gate must prevent isCrash from firing.
    const lines = loadFixture('logcat-anr.txt');
    for (const line of lines) {
      jobsModule.emit.log(jobId, { jobId, data: { line, stream: 'stdout' } });
    }

    await new Promise((resolve) => setTimeout(resolve, 200));

    const crashEvents = received.filter((env) => env.type === 'crash-detected');
    expect(crashEvents).toHaveLength(0);

    const [row] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(row.failureClass).toBeNull();

    unsub();
  }, 60_000);
});

// When no DB is available, this file would otherwise be silent. Provide a single
// sentinel describe so vitest still reports the file's existence in tooling.
describe.skipIf(HAS_DB)('[Phase 31-01 SC1] streaming log-parsing integration (skipped)', () => {
  it('skipped without DATABASE_URL', () => {
    expect(true).toBe(true);
  });
});
