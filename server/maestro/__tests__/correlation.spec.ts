/**
 * Phase 24 / Plan 24-04 — Maestro correlation DB-gated spec [TRACE-04 / SC3f].
 *
 * Proves a single ALS correlationId threads end-to-end:
 *
 *   asyncLocalStorage.run({correlationId: cid}, () => poolModule.emit.booted(...))
 *   ⤷ pool envelope stamped (correlationId === cid)
 *   ⤷ TypedBus.on dispatches device.booted to maestro subscriber synchronously
 *   ⤷ subscriber awaits DeviceInfoCollector.collect (mocked)
 *   ⤷ subscriber calls maestroModule.emit.deviceInfoCollected(...)
 *   ⤷ maestro envelope stamped via createEventHelpers/readAls
 *   ⤷ ALS preserved across await — envelope.correlationId === cid
 *
 * Captures the maestro envelope via the persistEnvelope side-channel
 * `${type}.envelope` ee.emit (Phase 22 streaming envelope.spec pattern)
 * because both maestro events are persisted:false and short-circuit before
 * db.insert (no events-table row to query).
 *
 * NOTE on TRACE-09 (causationId): the maestro subscriber consumes the pool
 * bus event via `poolModule.bus.on(...)` (NOT `fastify.onPersisted`). Only
 * onPersisted sets `currentEventId` into ALS for causation auto-propagation
 * (server/bus/plugin.ts:120-141). Therefore causationId on the maestro
 * envelope will be null in this path. This is acknowledged by Plan 24-04's
 * NOTE block: causation thread cross-module needs subscriber-side envelope-
 * aware emit; deferred to Phase 27+ as DEFERRED-24-D. This spec covers
 * correlationId thread + ALS isolation + ALS-missing fallback only.
 *
 * DB-gated: skips cleanly when TEST_DATABASE_URL / DATABASE_URL absent.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { randomUUID } from 'node:crypto';
import { asyncLocalStorage } from '@fastify/request-context';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

import correlationPlugin from '../../correlation/plugin.js';
import eventBusPlugin from '../../bus/plugin.js';
import queuePlugin from '../../queue/plugin.js';
import poolPlugin from '../../pool/plugin.js';
import maestroPlugin from '../plugin.js';
import type { Envelope } from '../../events/envelope.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn('[maestro/correlation.spec] SKIPPED: set TEST_DATABASE_URL or DATABASE_URL to run');
}

function makeStubAuthPlugin() {
  return fp(async (fastify: FastifyInstance) => {
    fastify.decorate('authService', { validateKey: async () => true } as never);
  }, { name: 'auth', dependencies: ['config'] });
}

interface AppWithDbClient extends FastifyInstance {
  __dbClient?: ReturnType<typeof postgres>;
  __schemaName?: string;
}

async function buildStack(): Promise<AppWithDbClient> {
  const schemaName = `pgboss_maestro_corr_${Math.random().toString(36).slice(2, 8)}`;
  const sqlClient = postgres(TEST_DATABASE_URL!);
  await sqlClient.unsafe(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  const db = drizzle(sqlClient);

  const stubConfigPlugin = fp(async (fastify: FastifyInstance) => {
    fastify.decorate('config', {
      database_url: TEST_DATABASE_URL!,
      auth: { enabled: false },
      storage: { artifacts: { path: `/tmp/df-maestro-corr-${schemaName}` } },
      pool: {
        max_devices: 10,
        android: { enabled: false, max_instances: 0 },
        ios: { enabled: false, max_instances: 0 },
      },
      appium: { server_url: 'http://localhost:4723', session_timeout_ms: 300_000 },
    } as never);
  }, { name: 'config' });

  const liveDbPlugin = fp(async (fastify: FastifyInstance) => {
    fastify.decorate('db', db as unknown as FastifyInstance['db']);
  }, { name: 'db', dependencies: ['config'] });

  const app = Fastify({ logger: false, pluginTimeout: 60_000 }) as AppWithDbClient;
  app.__dbClient = sqlClient;
  app.__schemaName = schemaName;

  await app.register(stubConfigPlugin);
  await app.register(correlationPlugin);
  await app.register(liveDbPlugin);
  await app.register(eventBusPlugin);
  await app.register(queuePlugin, { schema: schemaName });
  await app.register(makeStubAuthPlugin());
  await app.register(poolPlugin);
  await app.register(maestroPlugin);
  await app.ready();
  return app;
}

describe.skipIf(!HAS_DB)('[Phase 24-04 TRACE-04 / SC3f] maestro ALS correlationId thread', () => {
  let app: AppWithDbClient | null = null;

  beforeEach(async () => {
    app = await buildStack();
    // Mock collect on every test to avoid real adb/xcrun calls.
    vi.spyOn(app.maestroModule.deviceInfoCollector, 'collect')
      .mockResolvedValue({ osVersion: '14', model: 'Pixel 6' } as never);
  });

  afterEach(async () => {
    if (app) {
      const sqlClient = app.__dbClient;
      const schemaName = app.__schemaName;
      try { await app.close(); } catch { /* ignore */ }
      if (sqlClient && schemaName) {
        await sqlClient.unsafe(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`).catch(() => { /* ignore */ });
      }
      if (sqlClient) await sqlClient.end().catch(() => { /* ignore */ });
      app = null;
    }
  }, 30_000);

  /**
   * Capture maestro.device-info.collected envelopes via the bus's
   * persistEnvelope side-channel (`${type}.envelope` ee.emit fires before
   * the persisted:false short-circuit).
   */
  function captureMaestroEnvelopes(a: AppWithDbClient): Envelope[] {
    const envelopes: Envelope[] = [];
    const ee = (a.maestroModule.bus as unknown as {
      ee: { on: (n: string, h: (e: Envelope) => void) => void };
    }).ee;
    ee.on('maestro.device-info.collected.envelope', (env: Envelope) => envelopes.push(env));
    return envelopes;
  }

  // ----------------------------------------------------------------
  // Test 1: ALS correlationId threads through pool emit → maestro re-emit
  // ----------------------------------------------------------------
  it('[TRACE-04 / SC3f] cid threads pool.emit.booted → maestro.device-info.collected envelope', async () => {
    const a = app!;
    const deviceId = randomUUID();
    a.pool.getDeviceMap().set(deviceId, {
      id: deviceId,
      platform: 'android',
      emulatorId: 'emulator-5554',
      port: 5554,
      metadata: null,
    } as never);

    const captured = captureMaestroEnvelopes(a);
    const expectedCorr = randomUUID();

    // PLAIN-OBJECT ALS store shape per Phase 20 canonical (NOT legacy Map).
    await asyncLocalStorage.run(
      { correlationId: expectedCorr, currentEventId: null, actor: 'maestro-correlation-spec' } as never,
      async () => {
        a.poolModule.emit.booted(deviceId, {
          deviceId,
          platform: 'android',
          emulatorId: 'emulator-5554',
          port: 5554,
        });
        // Wait inside the ALS frame so the maestro subscriber's
        // emit.deviceInfoCollected runs while the ALS store is still active
        // (await preserves ALS context).
        await new Promise((r) => setTimeout(r, 100));
      },
    );

    expect(captured).toHaveLength(1);
    expect(captured[0].correlationId).toBe(expectedCorr);
  }, 30_000);

  // ----------------------------------------------------------------
  // Test 2: without ALS, maestro envelope still carries a UUID-shaped correlationId
  // ----------------------------------------------------------------
  it('[fallback] without ALS, maestro envelope still carries a UUID-shaped correlationId', async () => {
    const a = app!;
    const deviceId = randomUUID();
    a.pool.getDeviceMap().set(deviceId, {
      id: deviceId,
      platform: 'android',
      emulatorId: 'emulator-5556',
      port: 5556,
      metadata: null,
    } as never);

    const captured = captureMaestroEnvelopes(a);

    // Emit OUTSIDE asyncLocalStorage.run — fallback path (createEventHelpers
    // calls randomUUID() when ALS is empty).
    a.poolModule.emit.booted(deviceId, {
      deviceId,
      platform: 'android',
      emulatorId: 'emulator-5556',
      port: 5556,
    });
    await new Promise((r) => setTimeout(r, 100));

    expect(captured).toHaveLength(1);
    expect(captured[0].correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  }, 30_000);

  // ----------------------------------------------------------------
  // Test 3: ALS contexts are isolated across concurrent emissions
  // ----------------------------------------------------------------
  it('[TRACE-04 isolation] ALS contexts isolated across concurrent emissions', async () => {
    const a = app!;
    const id1 = randomUUID();
    const id2 = randomUUID();
    a.pool.getDeviceMap().set(id1, {
      id: id1,
      platform: 'android',
      emulatorId: 'em-A',
      port: 5570,
      metadata: null,
    } as never);
    a.pool.getDeviceMap().set(id2, {
      id: id2,
      platform: 'android',
      emulatorId: 'em-B',
      port: 5572,
      metadata: null,
    } as never);

    const captured = captureMaestroEnvelopes(a);
    const corrA = randomUUID();
    const corrB = randomUUID();

    await Promise.all([
      asyncLocalStorage.run(
        { correlationId: corrA, currentEventId: null, actor: 'spec-A' } as never,
        async () => {
          a.poolModule.emit.booted(id1, {
            deviceId: id1,
            platform: 'android',
            emulatorId: 'em-A',
            port: 5570,
          });
          await new Promise((r) => setTimeout(r, 100));
        },
      ),
      asyncLocalStorage.run(
        { correlationId: corrB, currentEventId: null, actor: 'spec-B' } as never,
        async () => {
          a.poolModule.emit.booted(id2, {
            deviceId: id2,
            platform: 'android',
            emulatorId: 'em-B',
            port: 5572,
          });
          await new Promise((r) => setTimeout(r, 100));
        },
      ),
    ]);
    await new Promise((r) => setTimeout(r, 50));

    const envA = captured.find((e) => (e.payload as { deviceId: string }).deviceId === id1);
    const envB = captured.find((e) => (e.payload as { deviceId: string }).deviceId === id2);
    expect(envA, 'envelope for device A should exist').toBeDefined();
    expect(envB, 'envelope for device B should exist').toBeDefined();
    expect(envA!.correlationId).toBe(corrA);
    expect(envB!.correlationId).toBe(corrB);
    expect(envA!.correlationId).not.toBe(envB!.correlationId);
  }, 30_000);
});
