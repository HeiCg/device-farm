/**
 * Phase 22 / Plan 22-03 — Streaming correlation DB-gated spec (SC1 + TRACE-06 + SC3).
 *
 * Proves:
 *   SC1 / TRACE-06: Envelope.correlationId === ALS.correlationId at subscriber time
 *     (round-trip from producer → bus → subscriber → envelope stamp).
 *   SC3 dev-tool grep-ability: JSON.stringify(envelope) contains correlationId as
 *     root-level string substring (not nested inside payload).
 *   ALS-missing fallback: subscriber produces a valid envelope with randomUUID()
 *     correlationId when ALS has no value (NOT undefined).
 *
 * DB-gated. Plain-object ALS shape. Duplicates stub plugins from subscriber.spec
 * for scope discipline (Phase 21 precedent).
 */
import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { asyncLocalStorage } from '@fastify/request-context';
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
  console.warn('[streaming/correlation.spec] SKIPPED: set TEST_DATABASE_URL or DATABASE_URL to run');
}

function makeStubConfigPlugin() {
  return fp(async (fastify: FastifyInstance) => {
    fastify.decorate('config', {
      database_url: TEST_DATABASE_URL!,
      auth: { enabled: false },
      storage: { artifacts: { path: '/tmp/df-streaming-corr-test' } },
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
      getDevice: () => ({ id: 'stub', platform: 'android', port: 5554, emulatorId: 'stub' }),
    } as never);
  }, { name: 'pool-plugin', dependencies: ['config'] });
}

function makeStubJobsPlugin() {
  return fp(async (fastify: FastifyInstance) => {
    const bus = new TypedBus(jobsRegistry);
    const ee = (bus as unknown as { ee: EventEmitter }).ee;
    const emit = makeJobsEmitters(bus, (env: Envelope) => {
      ee.emit(`${env.type}.envelope`, env);
      const entry = jobsRegistry[env.type as keyof JobsRegistry];
      if (!entry || !entry.persisted) return;
    });
    fastify.decorate('jobsModule', { bus, emit } as never);
  }, { name: 'stub-jobs-plugin', dependencies: ['event-bus'] });
}

interface AppWithDbClient extends FastifyInstance {
  __dbClient?: ReturnType<typeof postgres>;
  __schemaName?: string;
}

async function buildStack(): Promise<AppWithDbClient> {
  const schemaName = `pgboss_stream_corr_${Math.random().toString(36).slice(2, 8)}`;
  const sqlClient = postgres(TEST_DATABASE_URL!);
  await sqlClient.unsafe(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  const db = drizzle(sqlClient, { schema });

  const liveDbPlugin = fp(async (fastify: FastifyInstance) => {
    fastify.decorate('db', db as unknown as FastifyInstance['db']);
  }, { name: 'db', dependencies: ['config'] });

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

describe.skipIf(!HAS_DB)('[Phase 22-03 SC1 + TRACE-06] correlation round-trip', () => {
  let app: AppWithDbClient | null = null;

  afterEach(async () => {
    if (app) {
      const sqlClient = app.__dbClient;
      const schemaName = app.__schemaName;
      try { await app.close(); } catch { /* swallow */ }
      if (sqlClient && schemaName) {
        await sqlClient.unsafe(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`).catch(() => { /* ignore */ });
      }
      if (sqlClient) await sqlClient.end().catch(() => { /* ignore */ });
      app = null;
    }
  }, 30_000);

  it('[TRACE-06 / SC1] envelope.correlationId matches ALS correlationId (round-trip)', async () => {
    app = await buildStack();
    const jobsModule = (app as unknown as { jobsModule: { emit: ReturnType<typeof makeJobsEmitters> } }).jobsModule;

    const corrId = randomUUID();
    const jobId = randomUUID();
    const received: WsEnvelope[] = [];

    const unsub = app.jobBroadcaster.subscribe(jobId, (env) => received.push(env));

    // PLAIN-OBJECT ALS store shape per Phase 20 canonical — NOT legacy Map.
    await asyncLocalStorage.run(
      { correlationId: corrId, currentEventId: null, actor: 'correlation-spec' } as never,
      async () => {
        jobsModule.emit.log(jobId, {
          jobId,
          data: { line: 'traced line', stream: 'stdout' },
        });
      },
    );

    // Allow microtask propagation.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(received).toHaveLength(1);
    expect(received[0].correlationId).toBe(corrId);

    unsub();
  }, 60_000);

  it('[SC3] JSON.stringify(envelope) contains correlationId at root (dev-tool greppable)', async () => {
    app = await buildStack();
    const jobsModule = (app as unknown as { jobsModule: { emit: ReturnType<typeof makeJobsEmitters> } }).jobsModule;

    const corrId = randomUUID();
    const jobId = randomUUID();
    const received: WsEnvelope[] = [];
    const unsub = app.jobBroadcaster.subscribe(jobId, (env) => received.push(env));

    await asyncLocalStorage.run(
      { correlationId: corrId, currentEventId: null, actor: 'sc3-spec' } as never,
      async () => {
        jobsModule.emit.status(jobId, { jobId, data: { status: 'running' } });
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(received).toHaveLength(1);
    const wire = JSON.stringify(received[0]);
    // SC3: correlationId must appear as a top-level JSON key for dev-tools
    // grep/filter to work. The string must contain `"correlationId":"<uuid>"`
    // — NOT nested inside payload.
    expect(wire).toContain(`"correlationId":"${corrId}"`);

    unsub();
  }, 60_000);

  it('[fallback] envelope.correlationId is a valid UUID when ALS has no correlationId', async () => {
    app = await buildStack();
    const jobsModule = (app as unknown as { jobsModule: { emit: ReturnType<typeof makeJobsEmitters> } }).jobsModule;

    const jobId = randomUUID();
    const received: WsEnvelope[] = [];
    const unsub = app.jobBroadcaster.subscribe(jobId, (env) => received.push(env));

    // No asyncLocalStorage.run wrapper — emit from the outer fiber.
    // The subscriber's `readAls('correlationId') ?? randomUUID()` path
    // produces a fresh UUID.
    jobsModule.emit.log(jobId, {
      jobId,
      data: { line: 'no-als line', stream: 'stdout' },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(received).toHaveLength(1);
    expect(received[0].correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    unsub();
  }, 60_000);
});
