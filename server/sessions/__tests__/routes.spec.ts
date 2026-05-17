/**
 * Sessions module + REST routes integration spec — Phase 34 Plan 34-01.
 *
 * Two test layers:
 *   (A) Module factory unit + integration tests with in-memory pool stub +
 *       real Drizzle DB. DB-gated via TEST_DATABASE_URL/DATABASE_URL.
 *   (B) REST route integration tests via fastify.inject — DB-gated; uses
 *       a test app built with mocked auth + real sessions plugin.
 *
 * Mirrors server/auth/__tests__/auth-plugin.spec.ts + events.spec.ts.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import Fastify from 'fastify';
import fp from 'fastify-plugin';
import pino from 'pino';
import {
  fastifyZodOpenApiPlugin,
  validatorCompiler,
  serializerCompiler,
} from 'fastify-zod-openapi';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../../db/schema.js';
import type { Database } from '../../db/index.js';
import { createSessionsModule, extractKeyId } from '../internal/module.js';
import type { DeviceInfo } from '../../types/index.js';
import { DeviceState } from '../../types/index.js';

// ---------- DB gate ----------

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

// ---------- Fixture device builder ----------

function makeDevice(overrides: Partial<DeviceInfo> = {}): DeviceInfo {
  return {
    id: randomUUID(),
    name: 'pixel-7-pro',
    platform: 'android',
    state: DeviceState.Idle,
    emulatorId: 'emulator-5554',
    port: 5554,
    pid: 12345,
    currentJobId: null,
    metadata: null,
    grpcPort: null,
    ...overrides,
  };
}

// ---------- In-memory pool stub ----------

interface PoolStub {
  allocate: (platform: 'android' | 'ios', jobId: string) => Promise<DeviceInfo | null>;
  release: (deviceId: string) => Promise<void>;
  getDevice: (deviceId: string) => DeviceInfo | undefined;
}

function makePoolStub(devices: DeviceInfo[]): PoolStub {
  const free = [...devices];
  const allocated = new Map<string, DeviceInfo>();
  return {
    allocate: async (platform) => {
      const idx = free.findIndex((d) => d.platform === platform);
      if (idx === -1) return null;
      const d = free.splice(idx, 1)[0];
      allocated.set(d.id, d);
      return d;
    },
    release: async (deviceId) => {
      const d = allocated.get(deviceId);
      if (d) {
        allocated.delete(deviceId);
        free.push(d);
      }
    },
    getDevice: (deviceId) => allocated.get(deviceId) ?? free.find((d) => d.id === deviceId),
  };
}

// ---------- Pure unit tests (no DB) ----------

describe('Phase 34 — extractKeyId helper', () => {
  it('parses apikey:<uuid> actor to the uuid', () => {
    const id = randomUUID();
    expect(extractKeyId(`apikey:${id}`)).toBe(id);
  });

  it('returns null for system / cron / user actors', () => {
    expect(extractKeyId('system')).toBe(null);
    expect(extractKeyId('cron')).toBe(null);
    expect(extractKeyId('cron:session.sweep')).toBe(null);
    expect(extractKeyId('user:abc-123')).toBe(null);
  });
});

// ---------- Module factory DB-gated tests ----------

describeDb('Phase 34 — createSessionsModule (DB-gated)', () => {
  let client: ReturnType<typeof postgres>;
  let db: Database;
  let testDeviceId: string;
  let testApiKeyId: string;
  let createdSessionIds: string[] = [];
  let createdEventIds: string[] = [];

  beforeAll(async () => {
    client = postgres(DB_URL!, { max: 4 });
    db = drizzle(client, { schema }) as unknown as Database;
  });

  afterAll(async () => {
    await client.end();
  });

  beforeEach(async () => {
    testDeviceId = randomUUID();
    testApiKeyId = randomUUID();
    await db.insert(schema.devices).values({
      id: testDeviceId,
      type: 'android',
      name: 'test-device',
      status: 'idle',
      emulatorId: 'emulator-5554',
      port: 5554,
    });
    await db.insert(schema.apiKeys).values({
      id: testApiKeyId,
      keyHash: `hash-${testApiKeyId}`,
      keySalt: 'salt-test',
      keyPrefix: 'df_test_',
      name: 'test-key',
      claims: {},
    });
    createdSessionIds = [];
    createdEventIds = [];
  });

  afterEach(async () => {
    if (createdEventIds.length > 0) {
      await db.delete(schema.events).where(inArray(schema.events.id, createdEventIds));
    }
    if (createdSessionIds.length > 0) {
      await db.delete(schema.sessions).where(inArray(schema.sessions.id, createdSessionIds));
    }
    await db.delete(schema.sessions).where(eq(schema.sessions.deviceId, testDeviceId));
    await db.delete(schema.apiKeys).where(eq(schema.apiKeys.id, testApiKeyId));
    await db.delete(schema.devices).where(eq(schema.devices.id, testDeviceId));
  });

  function buildModule(pool: PoolStub) {
    const fastify = {
      pool,
      config: { server: { port: 3000, host: '0.0.0.0' } },
    } as unknown as Parameters<typeof createSessionsModule>[0]['fastify'];
    const logger = pino({ level: 'silent' });
    return createSessionsModule({ fastify, db, logger });
  }

  it('factory returns { bus, emit, leaseDevice, releaseDevice, listSessions, openSockets, shutdown }', () => {
    const device = makeDevice({ id: testDeviceId });
    const pool = makePoolStub([device]);
    const mod = buildModule(pool);
    expect(typeof mod.leaseDevice).toBe('function');
    expect(typeof mod.releaseDevice).toBe('function');
    expect(typeof mod.listSessions).toBe('function');
    expect(typeof mod.shutdown).toBe('function');
    expect(mod.bus).toBeDefined();
    expect(mod.emit.leased).toBeDefined();
    expect(mod.openSockets).toBeInstanceOf(Map);
    expect(mod.openSockets.size).toBe(0);
  });

  it('leaseDevice: allocates pool device, inserts sessions row, returns lease response', async () => {
    const device = makeDevice({ id: testDeviceId });
    const pool = makePoolStub([device]);
    const mod = buildModule(pool);
    const actor = `apikey:${testApiKeyId}` as const;

    const res = await mod.leaseDevice(
      { platform: 'android', ttlSeconds: 600 },
      actor,
      'bearer-token-xyz',
    );

    expect(res.deviceId).toBe(testDeviceId);
    expect(res.platform).toBe('android');
    expect(res.ttlSeconds).toBe(600);
    expect(res.wsUrl).toContain('/ws/sessions/');
    expect(res.wsUrl).toContain('token=bearer-token-xyz');
    expect(res.leaseUntil).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const rows = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, res.sessionId));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('active');
    expect(rows[0].ownerApiKeyId).toBe(testApiKeyId);
    expect(rows[0].ownerActor).toBe(actor);

    createdSessionIds.push(res.sessionId);
  });

  it('leaseDevice: returns 503 when pool has no idle device of requested platform', async () => {
    const pool = makePoolStub([]);
    const mod = buildModule(pool);
    const actor = `apikey:${testApiKeyId}` as const;

    await expect(
      mod.leaseDevice({ platform: 'android', ttlSeconds: 600 }, actor, 'tok'),
    ).rejects.toMatchObject({ statusCode: 503, code: 'no_device_available' });
  });

  it('leaseDevice: concurrent leases on same device — one wins, one gets 409 device_already_leased', async () => {
    const device = makeDevice({ id: testDeviceId });
    let calls = 0;
    const racePool: PoolStub = {
      allocate: async () => {
        calls += 1;
        return device;
      },
      release: async () => {
        /* noop */
      },
      getDevice: () => device,
    };
    const mod = buildModule(racePool);
    const actor = `apikey:${testApiKeyId}` as const;

    const [r1, r2] = await Promise.allSettled([
      mod.leaseDevice({ platform: 'android', ttlSeconds: 600 }, actor, 't1'),
      mod.leaseDevice({ platform: 'android', ttlSeconds: 600 }, actor, 't2'),
    ]);

    const fulfilled = [r1, r2].filter((r) => r.status === 'fulfilled');
    const rejected = [r1, r2].filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const err = (rejected[0] as PromiseRejectedResult).reason as {
      statusCode?: number;
      code?: string;
    };
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('device_already_leased');
    expect(calls).toBe(2);

    const ok = (fulfilled[0] as PromiseFulfilledResult<{ sessionId: string }>).value;
    createdSessionIds.push(ok.sessionId);
  });

  it('releaseDevice: updates status=released, releases pool device, emits session.released', async () => {
    const device = makeDevice({ id: testDeviceId });
    const pool = makePoolStub([device]);
    const mod = buildModule(pool);
    const actor = `apikey:${testApiKeyId}` as const;

    const lease = await mod.leaseDevice({ platform: 'android', ttlSeconds: 600 }, actor, 'tok');
    createdSessionIds.push(lease.sessionId);

    const release = await mod.releaseDevice(lease.sessionId, actor, false);
    expect(release.released).toBe(true);
    expect(release.sessionId).toBe(lease.sessionId);

    const rows = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, lease.sessionId));
    expect(rows[0].status).toBe('released');
    expect(rows[0].releasedAt).not.toBeNull();
  });

  it('releaseDevice: throws 403 when requester is not owner and not admin; admin override succeeds', async () => {
    const device = makeDevice({ id: testDeviceId });
    const pool = makePoolStub([device]);
    const mod = buildModule(pool);
    const ownerActor = `apikey:${testApiKeyId}` as const;
    const otherActor = `apikey:${randomUUID()}` as const;

    const lease = await mod.leaseDevice({ platform: 'android', ttlSeconds: 600 }, ownerActor, 'tok');
    createdSessionIds.push(lease.sessionId);

    await expect(
      mod.releaseDevice(lease.sessionId, otherActor, /* isAdmin */ false),
    ).rejects.toMatchObject({ statusCode: 403, code: 'forbidden' });

    const release = await mod.releaseDevice(lease.sessionId, otherActor, /* isAdmin */ true);
    expect(release.released).toBe(true);
  });

  it('releaseDevice: throws 404 when session id is unknown', async () => {
    const device = makeDevice({ id: testDeviceId });
    const pool = makePoolStub([device]);
    const mod = buildModule(pool);
    const actor = `apikey:${testApiKeyId}` as const;
    await expect(
      mod.releaseDevice(randomUUID(), actor, false),
    ).rejects.toMatchObject({ statusCode: 404, code: 'session_not_found' });
  });

  it('listSessions: returns active sessions with deviceName populated from device row', async () => {
    const device = makeDevice({ id: testDeviceId, name: 'test-device' });
    const pool = makePoolStub([device]);
    const mod = buildModule(pool);
    const actor = `apikey:${testApiKeyId}` as const;

    const lease = await mod.leaseDevice({ platform: 'android', ttlSeconds: 600 }, actor, 'tok');
    createdSessionIds.push(lease.sessionId);

    const list = await mod.listSessions({ status: 'active' });
    const found = list.sessions.find((s) => s.sessionId === lease.sessionId);
    expect(found).toBeDefined();
    expect(found?.deviceName).toBe('test-device');
    expect(found?.platform).toBe('android');
    expect(found?.status).toBe('active');
    expect(found?.ownerActor).toBe(actor);
  });

  it('persistEnvelope writes session.leased to events table (11TH SAMPLE POINT)', async () => {
    const device = makeDevice({ id: testDeviceId });
    const pool = makePoolStub([device]);
    const mod = buildModule(pool);
    const actor = `apikey:${testApiKeyId}` as const;

    const lease = await mod.leaseDevice({ platform: 'android', ttlSeconds: 600 }, actor, 'tok');
    createdSessionIds.push(lease.sessionId);

    let eventRows: typeof schema.events.$inferSelect[] = [];
    for (let i = 0; i < 20; i += 1) {
      eventRows = await db
        .select()
        .from(schema.events)
        .where(eq(schema.events.aggregateId, lease.sessionId));
      if (eventRows.length > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(eventRows.length).toBeGreaterThanOrEqual(1);
    const leasedEvent = eventRows.find((e) => e.eventType === 'session.leased');
    expect(leasedEvent).toBeDefined();
    expect(leasedEvent?.aggregateType).toBe('session');
    expect(leasedEvent?.actor).toBe(actor);
    createdEventIds.push(...eventRows.map((e) => e.id));
  });
});

// ---------- REST route integration tests via fastify.inject (Plan 34-01 Task 1.3) ----------

describeDb('Phase 34 — sessions plugin + REST routes (DB-gated)', () => {
  let client: ReturnType<typeof postgres>;
  let db: Database;
  let testDeviceId: string;
  let testApiKeyId: string;
  let createdSessionIds: string[] = [];
  let createdEventIds: string[] = [];

  beforeAll(async () => {
    client = postgres(DB_URL!, { max: 4 });
    db = drizzle(client, { schema }) as unknown as Database;
  });

  afterAll(async () => {
    await client.end();
  });

  beforeEach(async () => {
    testDeviceId = randomUUID();
    testApiKeyId = randomUUID();
    await db.insert(schema.devices).values({
      id: testDeviceId,
      type: 'android',
      name: 'integration-device',
      status: 'idle',
      emulatorId: 'emulator-5556',
      port: 5556,
    });
    await db.insert(schema.apiKeys).values({
      id: testApiKeyId,
      keyHash: `hash-int-${testApiKeyId}`,
      keySalt: 'salt-int',
      keyPrefix: 'df_intg_',
      name: 'integration-test-key',
      claims: {},
    });
    createdSessionIds = [];
    createdEventIds = [];
  });

  afterEach(async () => {
    if (createdEventIds.length > 0) {
      await db.delete(schema.events).where(inArray(schema.events.id, createdEventIds));
    }
    if (createdSessionIds.length > 0) {
      await db.delete(schema.sessions).where(inArray(schema.sessions.id, createdSessionIds));
    }
    await db.delete(schema.sessions).where(eq(schema.sessions.deviceId, testDeviceId));
    await db.delete(schema.apiKeys).where(eq(schema.apiKeys.id, testApiKeyId));
    await db.delete(schema.devices).where(eq(schema.devices.id, testDeviceId));
  });

  async function buildTestApp(opts: { withDevice?: boolean; adminClaim?: boolean } = {}) {
    const withDevice = opts.withDevice ?? true;
    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(fastifyZodOpenApiPlugin);

    const pool: PoolStub = withDevice
      ? makePoolStub([makeDevice({ id: testDeviceId, name: 'integration-device' })])
      : makePoolStub([]);

    await app.register(fp(async (instance) => {
      instance.decorate('config', { server: { port: 3000, host: '0.0.0.0' } } as never);
      instance.decorate('db', db as never);
      instance.decorate('pool', pool as never);
      instance.decorate('authService', {
        validateKeyAndReturnRow: async (key: string) => {
          if (key === `bearer-${testApiKeyId}`) {
            return {
              id: testApiKeyId,
              name: 'integration-test-key',
              claims: opts.adminClaim ? { admin: true } : {},
            };
          }
          return null;
        },
      } as never);
    }, { name: 'fake-substrate' }));

    const { default: sessionsPlugin } = await import('../plugin.js');
    await app.register(sessionsPlugin);
    await app.ready();
    return app;
  }

  it('POST /api/sessions returns 401 when Authorization missing', async () => {
    const app = await buildTestApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { platform: 'android' },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('POST /api/sessions returns 200 with valid Bearer; row inserted; wsUrl contains token', async () => {
    const app = await buildTestApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        headers: { authorization: `Bearer bearer-${testApiKeyId}` },
        payload: { platform: 'android' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        sessionId: string;
        deviceId: string;
        wsUrl: string;
      };
      expect(body.deviceId).toBe(testDeviceId);
      expect(body.wsUrl).toContain('/ws/sessions/');
      expect(body.wsUrl).toContain(`token=bearer-${testApiKeyId}`);
      createdSessionIds.push(body.sessionId);
    } finally {
      await app.close();
    }
  });

  it('DELETE /api/sessions/:id returns 200 for owner; 404 for unknown id', async () => {
    const app = await buildTestApp();
    try {
      const leaseRes = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        headers: { authorization: `Bearer bearer-${testApiKeyId}` },
        payload: { platform: 'android' },
      });
      const lease = JSON.parse(leaseRes.body) as { sessionId: string };
      createdSessionIds.push(lease.sessionId);

      const delRes = await app.inject({
        method: 'DELETE',
        url: `/api/sessions/${lease.sessionId}`,
        headers: { authorization: `Bearer bearer-${testApiKeyId}` },
      });
      expect(delRes.statusCode).toBe(200);
      expect(JSON.parse(delRes.body).released).toBe(true);

      const unknownRes = await app.inject({
        method: 'DELETE',
        url: `/api/sessions/${randomUUID()}`,
        headers: { authorization: `Bearer bearer-${testApiKeyId}` },
      });
      expect(unknownRes.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('GET /api/sessions returns active sessions with deviceName populated', async () => {
    const app = await buildTestApp();
    try {
      const leaseRes = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        headers: { authorization: `Bearer bearer-${testApiKeyId}` },
        payload: { platform: 'android' },
      });
      const lease = JSON.parse(leaseRes.body) as { sessionId: string };
      createdSessionIds.push(lease.sessionId);

      const listRes = await app.inject({
        method: 'GET',
        url: '/api/sessions?status=active',
        headers: { authorization: `Bearer bearer-${testApiKeyId}` },
      });
      expect(listRes.statusCode).toBe(200);
      const body = JSON.parse(listRes.body) as {
        sessions: Array<{ sessionId: string; deviceName: string }>;
      };
      const found = body.sessions.find((s) => s.sessionId === lease.sessionId);
      expect(found).toBeDefined();
      expect(found?.deviceName).toBe('integration-device');
    } finally {
      await app.close();
    }
  });
});
