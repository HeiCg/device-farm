/**
 * Phase 22 / Plan 22-03 — Streaming subscriber DB-gated spec (SC1 + SC2).
 *
 * Proves end-to-end that:
 *   SC2: JobBroadcaster receives its input from bus subscriptions (job.log/
 *        job.step/job.status). No producer calls broadcaster.emit directly.
 *        Ring-buffer replay on WS reconnect returns last <=200 envelopes.
 *   SC1 (partial): Every envelope carries correlationId, v:1, type, ts, payload.
 *
 * Full SC1 correlationId round-trip + TRACE-06 grep-ability are in
 * correlation.spec.ts (Task 3.2). safeParse drop path is in envelope.spec.ts
 * (Task 3.3; non-DB, fast).
 *
 * DB-gated: boots real config/correlation/db/event-bus/queue + stub auth/
 * pool/jobs + real streaming plugin. Skips cleanly on DB-less host with
 * console.warn.
 *
 * Uses plain-object ALS store shape (NOT Map) per Phase 20 canonical.
 */
import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

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
  console.warn('[streaming/subscriber.spec] SKIPPED: set TEST_DATABASE_URL or DATABASE_URL to run');
}

function makeStubConfigPlugin() {
  return fp(async (fastify: FastifyInstance) => {
    fastify.decorate('config', {
      database_url: TEST_DATABASE_URL!,
      auth: { enabled: false },
      storage: { artifacts: { path: '/tmp/df-streaming-sub-test' } },
      pool: {
        max_devices: 10,
        android: { enabled: false, max_instances: 0 },
        ios: { enabled: false, max_instances: 0 },
      },
    } as never);
  }, { name: 'config' });
}

function makeStubAuthPlugin() {
  return fp(async (fastify: FastifyInstance) => {
    fastify.decorate('authService', { validateKey: async () => true } as never);
  }, { name: 'auth', dependencies: ['config'] });
}

function makeStubPoolPlugin() {
  return fp(async (fastify: FastifyInstance) => {
    fastify.decorate('pool', {
      getDevice: () => ({ id: 'stub-device', platform: 'android', port: 5554, emulatorId: 'stub' }),
    } as never);
  }, { name: 'pool-plugin', dependencies: ['config'] });
}

function makeStubJobsPlugin() {
  return fp(async (fastify: FastifyInstance) => {
    const bus = new TypedBus(jobsRegistry);
    const ee = (bus as unknown as { ee: EventEmitter }).ee;
    const emit = makeJobsEmitters(bus, (env: Envelope) => {
      // Side-channel forward for onPersisted consumers.
      ee.emit(`${env.type}.envelope`, env);
      // Short-circuit for non-persisted events (log/step/status are NOT persisted).
      const entry = jobsRegistry[env.type as keyof JobsRegistry];
      if (!entry || !entry.persisted) return;
      // (real persisted path would insert into events table — short-circuit here)
    });
    fastify.decorate('jobsModule', { bus, emit } as never);
  }, { name: 'stub-jobs-plugin', dependencies: ['event-bus'] });
}

interface AppWithDbClient extends FastifyInstance {
  __dbClient?: ReturnType<typeof postgres>;
}

async function buildMinimalStack(schemaName: string): Promise<AppWithDbClient> {
  const sqlClient = postgres(TEST_DATABASE_URL!);
  await sqlClient.unsafe(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  const db = drizzle(sqlClient, { schema });

  const liveDbPlugin = fp(async (fastify: FastifyInstance) => {
    fastify.decorate('db', db as unknown as FastifyInstance['db']);
  }, { name: 'db', dependencies: ['config'] });

  const app = Fastify({ logger: false, pluginTimeout: 60_000 }) as AppWithDbClient;
  app.__dbClient = sqlClient;

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

describe.skipIf(!HAS_DB)('[Phase 22-03 SC1 + SC2] Streaming subscriber end-to-end', () => {
  let app: AppWithDbClient | null = null;

  afterEach(async () => {
    if (app) {
      const sqlClient = app.__dbClient;
      const schemaName = (app as unknown as { __schemaName?: string }).__schemaName;
      try { await app.close(); } catch { /* swallow */ }
      if (sqlClient && schemaName) {
        await sqlClient.unsafe(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`).catch(() => { /* ignore */ });
      }
      if (sqlClient) await sqlClient.end().catch(() => { /* ignore */ });
      app = null;
    }
  }, 30_000);

  async function boot(): Promise<AppWithDbClient> {
    const schemaName = `pgboss_stream_sub_${Math.random().toString(36).slice(2, 8)}`;
    const a = await buildMinimalStack(schemaName);
    (a as unknown as { __schemaName: string }).__schemaName = schemaName;
    return a;
  }

  it('[SC2] job.log bus emit delivers envelope to broadcaster subscribers', async () => {
    app = await boot();
    const jobsModule = (app as unknown as { jobsModule: { emit: ReturnType<typeof makeJobsEmitters> } }).jobsModule;

    const jobId = randomUUID();
    const received: WsEnvelope[] = [];

    const unsub = app.jobBroadcaster.subscribe(jobId, (env) => received.push(env));

    jobsModule.emit.log(jobId, {
      jobId,
      data: { line: 'hello world', stream: 'stdout' },
    });

    // Give microtask a tick to propagate bus → subscriber → broadcaster.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(received).toHaveLength(1);
    const env = received[0];
    expect(env.type).toBe('log');
    expect(env.v).toBe(1);
    expect(env.correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(env.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(env.payload).toEqual({ line: 'hello world', stream: 'stdout' });

    unsub();
  }, 60_000);

  it('[SC2] job.step bus emit delivers envelope', async () => {
    app = await boot();
    const jobsModule = (app as unknown as { jobsModule: { emit: ReturnType<typeof makeJobsEmitters> } }).jobsModule;

    const jobId = randomUUID();
    const received: WsEnvelope[] = [];
    const unsub = app.jobBroadcaster.subscribe(jobId, (env) => received.push(env));

    jobsModule.emit.step(jobId, {
      jobId,
      data: { flowName: 'login.yaml', status: 'running' },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('step');
    expect(received[0].payload).toMatchObject({ flowName: 'login.yaml', status: 'running' });

    unsub();
  }, 60_000);

  it('[SC2] job.status bus emit delivers envelope', async () => {
    app = await boot();
    const jobsModule = (app as unknown as { jobsModule: { emit: ReturnType<typeof makeJobsEmitters> } }).jobsModule;

    const jobId = randomUUID();
    const received: WsEnvelope[] = [];
    const unsub = app.jobBroadcaster.subscribe(jobId, (env) => received.push(env));

    jobsModule.emit.status(jobId, { jobId, data: { status: 'running' } });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('status');
    expect(received[0].payload).toMatchObject({ status: 'running' });

    unsub();
  }, 60_000);

  it('[SC2 ring-buffer] replay returns envelopes in emission order on late subscribe', async () => {
    app = await boot();
    const jobsModule = (app as unknown as { jobsModule: { emit: ReturnType<typeof makeJobsEmitters> } }).jobsModule;

    const jobId = randomUUID();

    // Emit 5 messages BEFORE subscribing.
    for (let i = 0; i < 5; i++) {
      jobsModule.emit.log(jobId, {
        jobId,
        data: { line: `line-${i}`, stream: 'stdout' },
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Subscribe late — should replay all 5 in order.
    const received: WsEnvelope[] = [];
    const unsub = app.jobBroadcaster.subscribe(jobId, (env) => received.push(env));

    expect(received).toHaveLength(5);
    expect(received.map((e) => (e.payload as { line: string }).line)).toEqual(
      ['line-0', 'line-1', 'line-2', 'line-3', 'line-4'],
    );
    for (const env of received) {
      expect(env.type).toBe('log');
      expect(env.v).toBe(1);
    }

    unsub();
  }, 60_000);
});
