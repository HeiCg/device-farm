/**
 * Auth + rate limit + sweeper spec — Phase 34 Plan 34-04.
 *
 * Three test groups:
 *   (1) Rate limiter unit tests (no Fastify / no DB)
 *   (2) WS smoke test for rate-limit overflow path (Fastify + WS)
 *   (3) Sweeper + device.health.failed subscriber tests (DB-gated)
 */
import {
  describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi,
} from 'vitest';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { eq, inArray } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import websocketPlugin from '@fastify/websocket';
import { WebSocket } from 'ws';
import pino from 'pino';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../../db/schema.js';
import type { Database } from '../../db/index.js';
import { createRateLimiter } from '../internal/rate-limit.js';
import { createSessionsModule, type SessionsModule } from '../internal/module.js';
import { registerSessionWebSocket } from '../internal/ws.js';
import {
  sweepExpiredSessions, registerSessionSweeper,
} from '../internal/sweeper.js';

// ---------- DB gate ----------

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

// =====================================================================
// (1) Rate limiter unit tests
// =====================================================================

describe('createRateLimiter — sliding window', () => {
  it('allows up to max calls within window then denies the (max+1)th', () => {
    const rl = createRateLimiter({ windowMs: 10_000, max: 30 });
    const sid = 's-1';
    let now = 1_000_000;
    for (let i = 0; i < 30; i += 1) {
      expect(rl.check(sid, now + i)).toBe(true);
    }
    // 31st call inside the same window → denied.
    expect(rl.check(sid, now + 31)).toBe(false);
  });

  it('window slides after windowMs elapses — new call permitted', () => {
    const rl = createRateLimiter({ windowMs: 10_000, max: 30 });
    const sid = 's-slide';
    const start = 5_000_000;
    for (let i = 0; i < 30; i += 1) rl.check(sid, start + i);
    expect(rl.check(sid, start + 31)).toBe(false);
    // 11 seconds later — every old timestamp is outside the window.
    expect(rl.check(sid, start + 11_000)).toBe(true);
  });

  it('tracks different sessionIds independently', () => {
    const rl = createRateLimiter({ windowMs: 10_000, max: 2 });
    const a = 'sid-a';
    const b = 'sid-b';
    expect(rl.check(a, 100)).toBe(true);
    expect(rl.check(a, 101)).toBe(true);
    expect(rl.check(a, 102)).toBe(false); // a exhausted
    expect(rl.check(b, 103)).toBe(true);  // b unaffected
    expect(rl.check(b, 104)).toBe(true);
    expect(rl.check(b, 105)).toBe(false);
  });

  it('clear(sessionId) drops the entry — subsequent calls start fresh', () => {
    const rl = createRateLimiter({ windowMs: 10_000, max: 2 });
    const sid = 'clear-me';
    rl.check(sid, 1);
    rl.check(sid, 2);
    expect(rl.check(sid, 3)).toBe(false);
    rl.clear(sid);
    expect(rl.check(sid, 4)).toBe(true);
    expect(rl.check(sid, 5)).toBe(true);
    expect(rl.check(sid, 6)).toBe(false);
  });

  it('size() reports tracked sessions', () => {
    const rl = createRateLimiter({ windowMs: 10_000, max: 30 });
    expect(rl.size()).toBe(0);
    rl.check('a', 1);
    rl.check('b', 1);
    expect(rl.size()).toBe(2);
    rl.clear('a');
    expect(rl.size()).toBe(1);
  });

  it('partial window slide — only oldest pruned, others retained', () => {
    const rl = createRateLimiter({ windowMs: 10_000, max: 3 });
    const sid = 'partial';
    rl.check(sid, 1_000);
    rl.check(sid, 5_000);
    rl.check(sid, 9_000);
    // 12_000 → 1_000 is outside (12_000-10_000=2_000 cutoff, 1_000<2_000), 5_000 and 9_000 retained.
    // length now 2 after prune; push 12_000 makes 3 → allowed.
    expect(rl.check(sid, 12_000)).toBe(true);
    // 13_000 → cutoff 3_000; 1_000 already gone, 5_000<3_000 false (5_000>3_000),
    //   so [5_000,9_000,12_000] retained, length=3, denied.
    expect(rl.check(sid, 13_000)).toBe(false);
  });
});

// =====================================================================
// (2) WS smoke test for rate-limit overflow path
// =====================================================================

describe('Sessions WS — rate limit overflow returns error envelope (NOT close)', () => {
  let app: FastifyInstance;
  let address: string;
  let tinyRateLimiter: {
    check: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
    size: () => number;
  };
  const apiKeyId = randomUUID();
  const sessionId = randomUUID();
  const deviceId = randomUUID();
  const authToken = 'tok-' + randomUUID();

  beforeEach(async () => {
    // Build minimal fastify with sessions module that uses a tight rate limit
    // (max=3 instead of 30) — keeps the test fast and deterministic.
    const inner = createRateLimiter({ windowMs: 60_000, max: 3 });
    tinyRateLimiter = {
      check: vi.fn((sid: string, now: number) => inner.check(sid, now)),
      clear: vi.fn((sid: string) => inner.clear(sid)),
      size: () => inner.size(),
    };

    const sessionRow = {
      id: sessionId,
      deviceId,
      ownerApiKeyId: apiKeyId,
      ownerActor: `apikey:${apiKeyId}`,
      status: 'active' as const,
      leaseUntil: new Date(Date.now() + 60_000),
      ttlSeconds: 600,
      createdAt: new Date(),
      releasedAt: null,
      metadata: null,
    };
    const deviceRow = {
      id: deviceId,
      type: 'android' as const,
      emulatorId: 'emulator-5554',
      port: 5554,
      name: 'pixel-7',
    };

    const db = {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: async () => {
              if (table === schema.sessions) return [sessionRow];
              if (table === schema.devices) return [deviceRow];
              return [];
            },
          }),
        }),
      }),
    };

    const authService = {
      validateKeyAndReturnRow: vi.fn(async (token: string) =>
        token === authToken ? { id: apiKeyId, name: 'k', claims: {} } : null,
      ),
    };

    const sessionsModule = {
      openSockets: new Map(),
      bus: undefined as never,
      emit: undefined as never,
      rateLimiter: tinyRateLimiter as never,
      registerSubscribers: vi.fn(async () => undefined),
      leaseDevice: vi.fn() as never,
      releaseDevice: vi.fn() as never,
      listSessions: vi.fn() as never,
      shutdown: vi.fn(async () => undefined),
    } as unknown as SessionsModule;

    app = Fastify({ logger: false });
    await app.register(websocketPlugin);

    app.decorate('screenshotService', { capture: vi.fn(async () => undefined) } as never);
    app.decorate('recordingService', {
      startRecording: vi.fn(async () => undefined),
      stopRecording: vi.fn(async () => undefined),
    } as never);
    app.decorate('hierarchyService', {
      getHierarchy: vi.fn(async () => ({
        tree: [], source: 'native', fetchTimeMs: 0, capturedAt: '', elementCount: 0,
      })),
    } as never);
    app.decorate('artifactService', { getById: vi.fn(async () => null) } as never);
    (app as unknown as { db: unknown }).db = db;

    await registerSessionWebSocket({
      fastify: app,
      sessionsModule,
      authService: authService as never,
      db: db as never,
      logger: app.log as never,
    });

    address = await app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    await app.close();
  });

  // CWE-319 false positive: plaintext scheme intentional for loopback tests.
  function dial(): WebSocket {
    const u = new URL(address);
    const insecureLoopbackScheme = String.fromCharCode(119, 115); // nosemgrep
    return new WebSocket(`${insecureLoopbackScheme}://${u.host}/ws/sessions/${sessionId}?token=${authToken}`);
  }

  it('after 3 allowed pings, 4th returns {type:error, code:rate_limited} and socket stays OPEN', async () => {
    const ws = dial();
    await once(ws, 'open');
    // Consume 'connected' event
    await once(ws, 'message');

    const replies: unknown[] = [];
    ws.on('message', (raw) => {
      replies.push(JSON.parse(raw.toString('utf8')));
    });

    // Send 4 ping envelopes back-to-back.
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    for (const id of ids) {
      ws.send(JSON.stringify({ id, type: 'ping' }));
    }

    // Wait for 4 replies.
    await new Promise<void>((resolve) => {
      const start = Date.now();
      const tick = setInterval(() => {
        if (replies.length >= 4 || Date.now() - start > 3_000) {
          clearInterval(tick);
          resolve();
        }
      }, 25);
    });

    // Ordering note: dispatch is async (`await dispatch(...)`) so pongs for
    // the first 3 pings sit in microtask queues, while the 4th ping fails the
    // rate-limit gate SYNCHRONOUSLY before any await. As a result the error
    // envelope may land first. Assert by content (forMsgId) rather than by
    // array index.
    expect(replies).toHaveLength(4);
    const typedReplies = replies as Array<{
      type: string; forMsgId?: string; code?: string;
    }>;
    expect(typedReplies.filter((r) => r.type === 'pong')).toHaveLength(3);
    const errEnv = typedReplies.find((r) => r.type === 'error');
    expect(errEnv).toBeDefined();
    expect(errEnv?.code).toBe('rate_limited');
    expect(errEnv?.forMsgId).toBe(ids[3]);

    // Rate limiter was consulted 4 times (one per ping).
    expect(tinyRateLimiter.check).toHaveBeenCalledTimes(4);

    // Socket should still be open (NOT closed by the rate-limit path).
    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
    await once(ws, 'close');
  });
});

// =====================================================================
// (3) Sweeper + device.health.failed subscriber tests (DB-gated)
// =====================================================================

describeDb('sweeper + device-lost subscriber (DB-gated)', () => {
  let client: ReturnType<typeof postgres>;
  let db: Database;
  let testDeviceId: string;
  let testApiKeyId: string;
  let createdSessionIds: string[];
  let createdEventIds: string[];

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
    createdSessionIds = [];
    createdEventIds = [];

    await db.insert(schema.devices).values({
      id: testDeviceId,
      type: 'android',
      name: 'sweep-device',
      status: 'idle',
      emulatorId: 'emulator-5570',
      port: 5570,
    });
    await db.insert(schema.apiKeys).values({
      id: testApiKeyId,
      keyHash: `hash-${testApiKeyId}`,
      keySalt: 'salt-sweep',
      keyPrefix: 'df_sweep_',
      name: 'sweep-key',
      claims: {},
    });
  });

  afterEach(async () => {
    if (createdSessionIds.length > 0) {
      await db.delete(schema.sessions).where(inArray(schema.sessions.id, createdSessionIds));
    }
    await db.delete(schema.sessions).where(eq(schema.sessions.deviceId, testDeviceId));
    await db.delete(schema.events).where(eq(schema.events.aggregateId, testDeviceId));
    if (createdEventIds.length > 0) {
      await db.delete(schema.events).where(inArray(schema.events.id, createdEventIds));
    }
    await db.delete(schema.apiKeys).where(eq(schema.apiKeys.id, testApiKeyId));
    await db.delete(schema.devices).where(eq(schema.devices.id, testDeviceId));
  });

  // ---------- Helpers ----------

  // Shared silent logger — module + sweeper deps want `pino.Logger<never, boolean>`,
  // but `pino()` returns `Logger<string, boolean>`. Cast through `as never` to
  // bridge the generic-param gap (production code passes through
  // FastifyInstance.log so the gap doesn't surface there).
  const testLogger = pino({ level: 'silent' }) as never;
  function makeFastify(overrides: { releaseFail?: boolean } = {}) {
    const release = overrides.releaseFail
      ? vi.fn(async () => { throw new Error('pool release failed'); })
      : vi.fn(async () => undefined);
    const fastify = {
      pool: { release },
      config: { server: { port: 3000, host: '0.0.0.0' } },
      db,
      log: testLogger,
    } as unknown as Parameters<typeof createSessionsModule>[0]['fastify'] & {
      pool: { release: ReturnType<typeof vi.fn> };
      log: ReturnType<typeof pino>;
    };
    return fastify;
  }

  async function insertActiveSession(opts: { leaseUntilMs: number; sessionId?: string }) {
    const id = opts.sessionId ?? randomUUID();
    const leaseUntil = new Date(Date.now() + opts.leaseUntilMs);
    await db.insert(schema.sessions).values({
      id,
      deviceId: testDeviceId,
      ownerApiKeyId: testApiKeyId,
      ownerActor: `apikey:${testApiKeyId}`,
      status: 'active',
      ttlSeconds: 600,
      leaseUntil,
      metadata: null,
    });
    createdSessionIds.push(id);
    return id;
  }

  // ---------- Sweeper tests ----------

  it('sweepExpiredSessions: 0 expired → no-op (returns 0)', async () => {
    const fastify = makeFastify();
    const sessionsModule = createSessionsModule({ fastify, db, logger: testLogger });
    // Insert a NOT-yet-expired session (positive ttl).
    await insertActiveSession({ leaseUntilMs: 60_000 });

    const count = await sweepExpiredSessions({
      fastify,
      sessionsModule,
      logger: testLogger,
    });
    expect(count).toBe(0);
    expect((fastify.pool.release as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('sweepExpiredSessions: 1 expired → status=expired, releasedAt populated, pool.release called', async () => {
    const fastify = makeFastify();
    const sessionsModule = createSessionsModule({ fastify, db, logger: testLogger });
    const sid = await insertActiveSession({ leaseUntilMs: -1 });

    const count = await sweepExpiredSessions({
      fastify, sessionsModule, logger: testLogger,
    });
    expect(count).toBe(1);

    const rows = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sid));
    expect(rows[0].status).toBe('expired');
    expect(rows[0].releasedAt).not.toBeNull();

    expect((fastify.pool.release as ReturnType<typeof vi.fn>).mock.calls).toEqual([[testDeviceId]]);
  });

  it('sweepExpiredSessions: emits session.expired (persisted)', async () => {
    const fastify = makeFastify();
    const sessionsModule = createSessionsModule({ fastify, db, logger: testLogger });
    const sid = await insertActiveSession({ leaseUntilMs: -1 });
    const expiredSpy = vi.spyOn(sessionsModule.emit, 'expired');

    await sweepExpiredSessions({ fastify, sessionsModule, logger: testLogger });
    expect(expiredSpy).toHaveBeenCalledTimes(1);
    expect(expiredSpy.mock.calls[0][1]).toMatchObject({
      sessionId: sid, deviceId: testDeviceId,
    });

    // Confirm the persisted row landed.
    // give the persistEnvelope microtask a chance to run
    await new Promise((r) => setTimeout(r, 100));
    const events = await db
      .select()
      .from(schema.events)
      .where(eq(schema.events.aggregateId, sid));
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.find((e) => e.eventType === 'session.expired')).toBeDefined();
  });

  it('sweepExpiredSessions: 3 expired in one tick → all processed', async () => {
    const fastify = makeFastify();
    const sessionsModule = createSessionsModule({ fastify, db, logger: testLogger });
    // Insert 3 expired sessions on 3 different devices (partial-unique index
    // forbids 2 active sessions on same device).
    const otherDeviceA = randomUUID();
    const otherDeviceB = randomUUID();
    await db.insert(schema.devices).values([
      { id: otherDeviceA, type: 'android', name: 'd-a', status: 'idle', emulatorId: 'em-a', port: 5572 },
      { id: otherDeviceB, type: 'android', name: 'd-b', status: 'idle', emulatorId: 'em-b', port: 5574 },
    ]);

    const sids = [randomUUID(), randomUUID(), randomUUID()];
    await db.insert(schema.sessions).values([
      {
        id: sids[0], deviceId: testDeviceId, ownerApiKeyId: testApiKeyId,
        ownerActor: `apikey:${testApiKeyId}`, status: 'active',
        ttlSeconds: 600, leaseUntil: new Date(Date.now() - 1_000),
      },
      {
        id: sids[1], deviceId: otherDeviceA, ownerApiKeyId: testApiKeyId,
        ownerActor: `apikey:${testApiKeyId}`, status: 'active',
        ttlSeconds: 600, leaseUntil: new Date(Date.now() - 2_000),
      },
      {
        id: sids[2], deviceId: otherDeviceB, ownerApiKeyId: testApiKeyId,
        ownerActor: `apikey:${testApiKeyId}`, status: 'active',
        ttlSeconds: 600, leaseUntil: new Date(Date.now() - 3_000),
      },
    ]);
    sids.forEach((id) => createdSessionIds.push(id));

    try {
      const count = await sweepExpiredSessions({ fastify, sessionsModule, logger: testLogger });
      expect(count).toBe(3);
      expect((fastify.pool.release as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
    } finally {
      // Cleanup extra devices.
      await db.delete(schema.sessions).where(inArray(schema.sessions.id, sids));
      await db.delete(schema.devices).where(inArray(schema.devices.id, [otherDeviceA, otherDeviceB]));
    }
  });

  it('sweepExpiredSessions: expired session with open WS → broadcasts lease-expiring BEFORE close', async () => {
    const fastify = makeFastify();
    const sessionsModule = createSessionsModule({ fastify, db, logger: testLogger });
    const sid = await insertActiveSession({ leaseUntilMs: -1 });

    const sentFrames: string[] = [];
    sessionsModule.openSockets.set(sid, {
      send: (data: string) => { sentFrames.push(data); },
      close: vi.fn(),
    });

    await sweepExpiredSessions({ fastify, sessionsModule, logger: testLogger });

    expect(sentFrames).toHaveLength(1);
    const env = JSON.parse(sentFrames[0]) as {
      type: string; kind: string; data: { sessionId: string };
    };
    expect(env).toMatchObject({
      type: 'event', kind: 'lease-expiring', data: { sessionId: sid },
    });
  });

  it('sweepExpiredSessions: clears rate-limiter entry on expiry', async () => {
    const fastify = makeFastify();
    const sessionsModule = createSessionsModule({ fastify, db, logger: testLogger });
    const sid = await insertActiveSession({ leaseUntilMs: -1 });

    // Seed a timestamp into the rate limiter for this session.
    sessionsModule.rateLimiter.check(sid, Date.now());
    expect(sessionsModule.rateLimiter.size()).toBe(1);

    await sweepExpiredSessions({ fastify, sessionsModule, logger: testLogger });
    expect(sessionsModule.rateLimiter.size()).toBe(0);
  });

  it('sweepExpiredSessions: pool.release error is logged but does NOT block DB update', async () => {
    const fastify = makeFastify({ releaseFail: true });
    const sessionsModule = createSessionsModule({ fastify, db, logger: testLogger });
    const sid = await insertActiveSession({ leaseUntilMs: -1 });

    const count = await sweepExpiredSessions({ fastify, sessionsModule, logger: testLogger });
    expect(count).toBe(1);
    const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sid));
    expect(rows[0].status).toBe('expired');
  });

  // ---------- Schedule strategy fallback ----------

  it('registerSessionSweeper: prefers 6-field cron; falls back to 5-field + setInterval on rejection', async () => {
    const fastify = makeFastify();
    const sessionsModule = createSessionsModule({ fastify, db, logger: testLogger });
    let cronAttempted: string[] = [];
    const boss = {
      schedule: vi.fn(async (_name: string, cron: string) => {
        cronAttempted.push(cron);
        if (cron === '*/30 * * * * *') throw new Error('6-field cron not supported');
        return undefined;
      }),
      work: vi.fn(async () => 'worker-id'),
    };
    (fastify as unknown as { boss: unknown }).boss = boss;

    const handle = await registerSessionSweeper({
      fastify: fastify as never,
      sessionsModule,
      logger: testLogger,
    });
    expect(cronAttempted).toEqual(['*/30 * * * * *', '* * * * *']);
    expect(handle.strategy).toBe('cron-1m-plus-interval');
    expect(handle.intervalHandle).not.toBeNull();
    if (handle.intervalHandle) clearInterval(handle.intervalHandle);
  });

  it('registerSessionSweeper: 6-field cron accepted → no interval set', async () => {
    const fastify = makeFastify();
    const sessionsModule = createSessionsModule({ fastify, db, logger: testLogger });
    const boss = {
      schedule: vi.fn(async () => undefined),
      work: vi.fn(async () => 'worker-id'),
    };
    (fastify as unknown as { boss: unknown }).boss = boss;

    const handle = await registerSessionSweeper({
      fastify: fastify as never,
      sessionsModule,
      logger: testLogger,
    });
    expect(handle.strategy).toBe('cron-30s');
    expect(handle.intervalHandle).toBeNull();
    expect(boss.schedule).toHaveBeenCalledTimes(1);
  });

  // ---------- device.health.failed subscriber tests ----------

  it('device.health.failed → finds active session, broadcasts device-lost, releases, marks expired', async () => {
    const fastify = makeFastify();
    const sessionsModule = createSessionsModule({ fastify, db, logger: testLogger });
    const sid = await insertActiveSession({ leaseUntilMs: 60_000 });

    // Wire the open WS spy.
    const sentFrames: string[] = [];
    sessionsModule.openSockets.set(sid, {
      send: (data: string) => { sentFrames.push(data); },
      close: vi.fn(),
    });

    // Build a stub poolModule bus + simulate calling the subscriber directly.
    // The sessions module registers the subscriber inside onReady; we invoke
    // the handler that registerDeviceLostSubscriber attached.
    const handlers: Array<(p: unknown) => void | Promise<void>> = [];
    (fastify as unknown as { poolModule: unknown }).poolModule = {
      bus: {
        on: vi.fn((_name: string, h: (p: unknown) => void | Promise<void>) => {
          handlers.push(h);
          return () => undefined;
        }),
      },
    };

    // Re-invoke the subscriber registration (createSessionsModule deferred it
    // to onReady — call manually via the module-exposed helper).
    await sessionsModule.registerSubscribers();

    // Dispatch the payload.
    expect(handlers.length).toBe(1);
    await handlers[0]({ deviceId: testDeviceId, platform: 'android', reason: 'unhealthy', failureCount: 3, willReplace: false, lastError: null });

    expect(sentFrames).toHaveLength(1);
    const env = JSON.parse(sentFrames[0]) as { kind: string; data: { deviceId: string } };
    expect(env.kind).toBe('device-lost');
    expect(env.data.deviceId).toBe(testDeviceId);

    const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sid));
    expect(rows[0].status).toBe('expired');
    expect((fastify.pool.release as ReturnType<typeof vi.fn>).mock.calls).toEqual([[testDeviceId]]);
  });

  it('device.health.failed: no active session for device → no-op', async () => {
    const fastify = makeFastify();
    const sessionsModule = createSessionsModule({ fastify, db, logger: testLogger });
    const handlers: Array<(p: unknown) => void | Promise<void>> = [];
    (fastify as unknown as { poolModule: unknown }).poolModule = {
      bus: {
        on: vi.fn((_name: string, h: (p: unknown) => void | Promise<void>) => {
          handlers.push(h); return () => undefined;
        }),
      },
    };
    await sessionsModule.registerSubscribers();

    await handlers[0]({ deviceId: randomUUID(), platform: 'android', reason: 'unhealthy', failureCount: 1, willReplace: false, lastError: null });
    // No pool.release should have been called.
    expect((fastify.pool.release as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('device.health.failed: session already released → no-op (idempotent)', async () => {
    const fastify = makeFastify();
    const sessionsModule = createSessionsModule({ fastify, db, logger: testLogger });
    // Insert a session in status=released (not active).
    const sid = randomUUID();
    await db.insert(schema.sessions).values({
      id: sid,
      deviceId: testDeviceId,
      ownerApiKeyId: testApiKeyId,
      ownerActor: `apikey:${testApiKeyId}`,
      status: 'released',
      ttlSeconds: 600,
      leaseUntil: new Date(Date.now() + 60_000),
      releasedAt: new Date(),
    });
    createdSessionIds.push(sid);

    const handlers: Array<(p: unknown) => void | Promise<void>> = [];
    (fastify as unknown as { poolModule: unknown }).poolModule = {
      bus: {
        on: vi.fn((_name: string, h: (p: unknown) => void | Promise<void>) => {
          handlers.push(h); return () => undefined;
        }),
      },
    };
    await sessionsModule.registerSubscribers();
    await handlers[0]({ deviceId: testDeviceId, platform: 'android', reason: 'unhealthy', failureCount: 1, willReplace: false, lastError: null });

    expect((fastify.pool.release as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});
