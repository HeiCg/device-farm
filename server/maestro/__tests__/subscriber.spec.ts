/**
 * Phase 24 / Plan 24-04 — Maestro subscriber DB-gated spec [SC2 / EVENTS-10].
 *
 * Proves the maestro device.booted subscriber wired by Plan 24-03 in
 * server/maestro/internal/{module.ts,subscribers.ts}. Five DB-gated tests
 * exercise the subscriber path end-to-end:
 *
 *   1. device.booted on poolModule.bus → maestro subscriber awakes →
 *      DeviceInfoCollector.collect called with payload args (platform,
 *      emulatorId, port).
 *   2. collect resolves → fastify.pool.getDeviceMap().get(deviceId).metadata
 *      mutated with collect result (cache update SC2 main clause).
 *   3. collect resolves → maestro.device-info.collected envelope arrives on
 *      maestroModule.bus side-channel (`${type}.envelope` ee.emit per the
 *      persistEnvelope short-circuit pattern Phase 22 streaming inheritance).
 *   4. collect rejects → handler swallows + logs warn → no
 *      maestro.device-info.collected envelope emitted (Phase 21 invariant —
 *      subscriber failures must NOT propagate).
 *   5. Multiple concurrent device.booted events for different deviceIds —
 *      each handled independently (no cross-talk; isolation invariant).
 *
 * MUST subscribe via the decorator surface (fastify.maestroModule.bus) per
 * RESEARCH §Pitfall 5 — a fresh TypedBus would not receive the maestro
 * factory's emissions because the factory closes over its own bus instance.
 *
 * MUST mock DeviceInfoCollector.collect to avoid real adb/xcrun calls —
 * real collect requires a booted device (out of scope per VALIDATION.md
 * §Manual-Only Verifications).
 *
 * Harness mirrors Phase 22 streaming/__tests__/subscriber.spec.ts: spins a
 * minimal Fastify stack with config/correlation/db/event-bus/queue/auth-
 * stub/pool plugins + the real maestro plugin under test. Pool runs with
 * android/ios disabled (no real emulators booted). Each test seeds a fake
 * device row in the pool's deviceMap then drives a real bus emit.
 *
 * DB-gated: skips cleanly via describe.skipIf when TEST_DATABASE_URL /
 * DATABASE_URL absent. Uses ephemeral pgboss schemas per spec for
 * parallel-safety.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { randomUUID } from 'node:crypto';
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
  console.warn('[maestro/subscriber.spec] SKIPPED: set TEST_DATABASE_URL or DATABASE_URL to run');
}

/** Stub auth plugin — maestro plugin transitively depends on auth (back-compat). */
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
  const schemaName = `pgboss_maestro_sub_${Math.random().toString(36).slice(2, 8)}`;
  const sqlClient = postgres(TEST_DATABASE_URL!);
  await sqlClient.unsafe(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  const db = drizzle(sqlClient);

  const stubConfigPlugin = fp(async (fastify: FastifyInstance) => {
    fastify.decorate('config', {
      database_url: TEST_DATABASE_URL!,
      auth: { enabled: false },
      storage: { artifacts: { path: `/tmp/df-maestro-sub-${schemaName}` } },
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
  await app.ready(); // triggers maestro registerSubscribers via onReady

  return app;
}

describe.skipIf(!HAS_DB)('[Phase 24-04 SC2] maestro device.booted subscriber end-to-end', () => {
  let app: AppWithDbClient | null = null;

  beforeEach(async () => {
    app = await buildStack();
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

  // ----------------------------------------------------------------
  // Test 1: device.booted → DeviceInfoCollector.collect(platform, emulatorId, port)
  // ----------------------------------------------------------------
  it('[SC2] device.booted triggers DeviceInfoCollector.collect with payload args', async () => {
    const a = app!;
    const deviceId = randomUUID();
    const collectSpy = vi.spyOn(a.maestroModule.deviceInfoCollector, 'collect')
      .mockResolvedValue({
        osVersion: '14',
        sdkVersion: '34',
        screenWidth: 1080,
        screenHeight: 2400,
        screenDensity: 420,
        ramMb: 8192,
        abi: 'arm64-v8a',
        manufacturer: 'Google',
        model: 'Pixel 6',
        locale: 'en-US',
        timezone: 'UTC',
        batteryLevel: 100,
        collectedAt: new Date().toISOString(),
      } as never);

    const deviceMap = a.pool.getDeviceMap();
    deviceMap.set(deviceId, {
      id: deviceId,
      platform: 'android',
      emulatorId: 'emulator-5554',
      port: 5554,
      metadata: null,
    } as never);

    a.poolModule.emit.booted(deviceId, {
      deviceId,
      platform: 'android',
      emulatorId: 'emulator-5554',
      port: 5554,
    });

    // Give async handler a tick to propagate bus → subscriber → collect.
    await new Promise((r) => setTimeout(r, 100));

    expect(collectSpy).toHaveBeenCalledWith('android', 'emulator-5554', 5554);
  }, 30_000);

  // ----------------------------------------------------------------
  // Test 2: handler mutates Device.metadata with collect result
  // ----------------------------------------------------------------
  it('[SC2] handler mutates Device.metadata with collect result', async () => {
    const a = app!;
    const deviceId = randomUUID();
    const metadata = {
      osVersion: '14',
      sdkVersion: '34',
      screenWidth: 1080,
      screenHeight: 2400,
      screenDensity: 420,
      ramMb: 8192,
      abi: 'arm64-v8a',
      manufacturer: 'Google',
      model: 'Pixel 6',
      locale: 'en-US',
      timezone: 'UTC',
      batteryLevel: 100,
      collectedAt: new Date().toISOString(),
    };
    vi.spyOn(a.maestroModule.deviceInfoCollector, 'collect')
      .mockResolvedValue(metadata as never);

    const deviceMap = a.pool.getDeviceMap();
    const fakeDevice = {
      id: deviceId,
      platform: 'android',
      emulatorId: 'emulator-5556',
      port: 5556,
      metadata: null,
    };
    deviceMap.set(deviceId, fakeDevice as never);

    a.poolModule.emit.booted(deviceId, {
      deviceId,
      platform: 'android',
      emulatorId: 'emulator-5556',
      port: 5556,
    });

    await new Promise((r) => setTimeout(r, 100));

    expect((fakeDevice as { metadata: unknown }).metadata).toEqual(
      expect.objectContaining({ osVersion: '14', model: 'Pixel 6' }),
    );
  }, 30_000);

  // ----------------------------------------------------------------
  // Test 3: handler emits maestro.device-info.collected envelope
  // ----------------------------------------------------------------
  it('[SC2] handler emits maestro.device-info.collected envelope on side-channel', async () => {
    const a = app!;
    const deviceId = randomUUID();
    vi.spyOn(a.maestroModule.deviceInfoCollector, 'collect')
      .mockResolvedValue({ osVersion: '14', model: 'Pixel 6' } as never);

    const deviceMap = a.pool.getDeviceMap();
    deviceMap.set(deviceId, {
      id: deviceId,
      platform: 'android',
      emulatorId: 'emulator-5558',
      port: 5558,
      metadata: null,
    } as never);

    const envelopes: Envelope[] = [];
    const ee = (a.maestroModule.bus as unknown as { ee: { on: (n: string, h: (e: Envelope) => void) => void } }).ee;
    ee.on('maestro.device-info.collected.envelope', (env: Envelope) => envelopes.push(env));

    a.poolModule.emit.booted(deviceId, {
      deviceId,
      platform: 'android',
      emulatorId: 'emulator-5558',
      port: 5558,
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(envelopes).toHaveLength(1);
    expect(envelopes[0].type).toBe('maestro.device-info.collected');
    expect(envelopes[0].payload).toMatchObject({
      deviceId,
      osVersion: '14',
      model: 'Pixel 6',
    });
  }, 30_000);

  // ----------------------------------------------------------------
  // Test 4: handler swallows collect errors without re-throw or emit
  // ----------------------------------------------------------------
  it('[SC2 invariant] handler swallows collect errors — no envelope emitted', async () => {
    const a = app!;
    const deviceId = randomUUID();
    vi.spyOn(a.maestroModule.deviceInfoCollector, 'collect')
      .mockRejectedValue(new Error('adb not available'));

    const deviceMap = a.pool.getDeviceMap();
    deviceMap.set(deviceId, {
      id: deviceId,
      platform: 'android',
      emulatorId: 'emulator-5560',
      port: 5560,
      metadata: null,
    } as never);

    const envelopes: Envelope[] = [];
    const ee = (a.maestroModule.bus as unknown as { ee: { on: (n: string, h: (e: Envelope) => void) => void } }).ee;
    ee.on('maestro.device-info.collected.envelope', (env: Envelope) => envelopes.push(env));

    // Should NOT throw — handler catches.
    a.poolModule.emit.booted(deviceId, {
      deviceId,
      platform: 'android',
      emulatorId: 'emulator-5560',
      port: 5560,
    });
    await new Promise((r) => setTimeout(r, 100));

    expect(envelopes).toHaveLength(0);
  }, 30_000);

  // ----------------------------------------------------------------
  // Test 5: multiple concurrent device.booted events handled independently
  // ----------------------------------------------------------------
  it('[SC2 isolation] multiple concurrent device.booted events handled independently', async () => {
    const a = app!;
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    vi.spyOn(a.maestroModule.deviceInfoCollector, 'collect')
      .mockImplementation(async (_platform, emulatorId) => ({
        osVersion: '14',
        model: `device-${emulatorId}`,
      } as never));

    const deviceMap = a.pool.getDeviceMap();
    ids.forEach((id, i) =>
      deviceMap.set(id, {
        id,
        platform: 'android',
        emulatorId: `emulator-${5562 + i * 2}`,
        port: 5562 + i * 2,
        metadata: null,
      } as never),
    );

    const envelopes: Envelope[] = [];
    const ee = (a.maestroModule.bus as unknown as { ee: { on: (n: string, h: (e: Envelope) => void) => void } }).ee;
    ee.on('maestro.device-info.collected.envelope', (env: Envelope) => envelopes.push(env));

    ids.forEach((id, i) =>
      a.poolModule.emit.booted(id, {
        deviceId: id,
        platform: 'android',
        emulatorId: `emulator-${5562 + i * 2}`,
        port: 5562 + i * 2,
      }),
    );

    await new Promise((r) => setTimeout(r, 200));

    expect(envelopes).toHaveLength(3);
    for (let i = 0; i < 3; i += 1) {
      const env = envelopes.find((e) => (e.payload as { deviceId: string }).deviceId === ids[i]);
      expect(env).toBeDefined();
      expect((env!.payload as { model: string }).model).toBe(`device-emulator-${5562 + i * 2}`);
    }
  }, 30_000);
});
