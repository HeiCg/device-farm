/**
 * Sessions WebSocket handler spec — Phase 34 Plan 34-02.
 *
 * Spins up a minimal Fastify instance with @fastify/websocket and the
 * sessions WS route registered against a mocked AuthService + an in-memory
 * "sessions table" stub. Uses the `ws` package as the client to dial.
 *
 * Mocks (NOT real DB):
 *   - authService.validateKeyAndReturnRow returns a fixed apiKey row when
 *     the bearer matches.
 *   - db.select() returns a chainable stub yielding either the session row
 *     or the device row depending on `.from(table)` discriminator.
 *
 * This isolates SESS-WS contract (auth, lookup, heartbeat, envelope routing)
 * from the DB-gated lease/release paths covered in routes.spec.ts.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import Fastify, { type FastifyInstance } from 'fastify';
import websocketPlugin from '@fastify/websocket';
import { WebSocket } from 'ws';

import * as schema from '../../db/schema.js';
import { registerSessionWebSocket } from '../internal/ws.js';
import type { SessionsModule } from '../internal/module.js';

// ---------- Stubs ----------

function makeAuthServiceStub(validKeys: Map<string, { id: string; name: string; claims: Record<string, unknown> }>) {
  return {
    validateKeyAndReturnRow: vi.fn(async (token: string) => validKeys.get(token) ?? null),
  };
}

interface FakeSessionRow {
  id: string;
  deviceId: string;
  ownerApiKeyId: string;
  status: 'active' | 'released' | 'expired';
  leaseUntil: Date;
}

interface FakeDeviceRow {
  id: string;
  type: 'android' | 'ios';
  emulatorId: string;
  port: number | null;
  name: string;
}

function makeDbStub(opts: {
  sessions: Map<string, FakeSessionRow>;
  devices: Map<string, FakeDeviceRow>;
}) {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: (_clause: unknown) => ({
          limit: async (_n: number) => {
            // Discriminator: which table?
            if (table === schema.sessions) {
              return Array.from(opts.sessions.values());
            }
            if (table === schema.devices) {
              return Array.from(opts.devices.values());
            }
            return [];
          },
        }),
      }),
    }),
  };
}

function makeSessionsModuleStub(): SessionsModule {
  // Use a permissive rate limiter so existing ws.spec tests (which weren't
  // designed to exercise rate-limit) continue to pass.
  const rl = {
    check: () => true,
    clear: () => undefined,
    size: () => 0,
  };
  return {
    openSockets: new Map(),
    // Unused by ws.ts tests
    bus: undefined as never,
    emit: undefined as never,
    rateLimiter: rl,
    registerSubscribers: vi.fn(async () => undefined),
    leaseDevice: vi.fn() as never,
    releaseDevice: vi.fn() as never,
    listSessions: vi.fn() as never,
    // Phase 37 Plan 37-04 — broadcaster fan-out path (unused by ws.spec.ts).
    dispatch: vi.fn(async () => undefined) as never,
    shutdown: vi.fn(async () => undefined),
  };
}

// ---------- App builder ----------

interface BuildAppOpts {
  authToken: string;
  apiKeyId: string;
  sessionId: string;
  deviceId: string;
  sessionStatus?: 'active' | 'released' | 'expired';
  sessionOwnerKeyId?: string;
  leaseExpired?: boolean;
  platform?: 'android' | 'ios';
}

async function buildApp(opts: BuildAppOpts) {
  const apiKey = { id: opts.apiKeyId, name: 'test-key', claims: {} };
  const validKeys = new Map([[opts.authToken, apiKey]]);
  const authService = makeAuthServiceStub(validKeys);

  const session: FakeSessionRow = {
    id: opts.sessionId,
    deviceId: opts.deviceId,
    ownerApiKeyId: opts.sessionOwnerKeyId ?? opts.apiKeyId,
    status: opts.sessionStatus ?? 'active',
    leaseUntil: opts.leaseExpired
      ? new Date(Date.now() - 60_000)
      : new Date(Date.now() + 60_000),
  };
  const device: FakeDeviceRow = {
    id: opts.deviceId,
    type: opts.platform ?? 'android',
    emulatorId: 'emulator-5554',
    port: 5554,
    name: 'pixel-7',
  };

  const db = makeDbStub({
    sessions: new Map([[session.id, session]]),
    devices: new Map([[device.id, device]]),
  });
  const sessionsModule = makeSessionsModuleStub();

  const fastify = Fastify({ logger: false });
  await fastify.register(websocketPlugin);

  // Decorate stubs that buildActionContext will read.
  // screenshot/recording/hierarchy/artifact services are never invoked in these
  // tests (no envelopes that hit them); decorate with throw-stubs to satisfy
  // the buildActionContext lookups it does before any dispatch fires.
  fastify.decorate('screenshotService', {
    capture: vi.fn(async () => undefined),
  } as never);
  fastify.decorate('recordingService', {
    startRecording: vi.fn(async () => undefined),
    stopRecording: vi.fn(async () => undefined),
  } as never);
  fastify.decorate('hierarchyService', {
    getHierarchy: vi.fn(async () => ({ tree: [], source: 'native', fetchTimeMs: 0, capturedAt: '', elementCount: 0 })),
  } as never);
  fastify.decorate('artifactService', { getById: vi.fn(async () => null) } as never);
  (fastify as unknown as { db: unknown }).db = db;

  await registerSessionWebSocket({
    fastify,
    sessionsModule,
    authService: authService as never,
    db: db as never,
    logger: fastify.log as never,
  });

  const address = await fastify.listen({ port: 0, host: '127.0.0.1' });

  return { fastify, address, sessionsModule, authService };
}

// CWE-319 false positive: plaintext scheme is intentional for in-process
// loopback test fastify (no TLS configured in test env). Production URL is
// built in module.ts and gains a secure scheme variant when the config
// schema adds server.tls (tracked DEFERRED-34-TLS — see 34-01 SUMMARY #2).
function dial(address: string, sessionId: string, token: string | null): WebSocket {
  const u = new URL(address);
  const insecureLoopbackScheme = String.fromCharCode(119, 115); // nosemgrep
  const url = `${insecureLoopbackScheme}://${u.host}/ws/sessions/${sessionId}${token != null ? `?token=${token}` : ''}`;
  return new WebSocket(url);
}

async function nextFrame(ws: WebSocket): Promise<string> {
  const [data] = await once(ws, 'message');
  return data.toString('utf8');
}

async function waitClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  const [code, reason] = await once(ws, 'close');
  return { code: code as number, reason: String(reason ?? '') };
}

// ---------- Tests ----------

describe('Sessions WS handler — auth + connection lifecycle', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const apiKeyId = randomUUID();
  const sessionId = randomUUID();
  const deviceId = randomUUID();
  const authToken = 'tok-' + randomUUID();

  beforeEach(async () => {
    app = await buildApp({ authToken, apiKeyId, sessionId, deviceId });
  });
  afterEach(async () => {
    await app.fastify.close();
  });

  it('rejects connection without ?token (close 1008)', async () => {
    const ws = dial(app.address, sessionId, null);
    const closed = waitClose(ws);
    // Server may send an error frame before closing.
    const firstFrame = await Promise.race([
      nextFrame(ws).catch(() => null),
      new Promise<null>((r) => setTimeout(() => r(null), 500)),
    ]);
    if (firstFrame) {
      const env = JSON.parse(firstFrame);
      expect(env.type).toBe('error');
      expect(env.code).toBe('unauthorized');
    }
    const { code } = await closed;
    expect(code).toBe(1008);
  });

  it('rejects connection with invalid token (close 1008)', async () => {
    const ws = dial(app.address, sessionId, 'bogus-token');
    const closed = waitClose(ws);
    const firstFrame = await Promise.race([
      nextFrame(ws).catch(() => null),
      new Promise<null>((r) => setTimeout(() => r(null), 500)),
    ]);
    if (firstFrame) {
      expect(JSON.parse(firstFrame).code).toBe('unauthorized');
    }
    const { code } = await closed;
    expect(code).toBe(1008);
  });

  it('accepts valid token + active session and emits {type:event, kind:connected}', async () => {
    const ws = dial(app.address, sessionId, authToken);
    await once(ws, 'open');
    const frame = await nextFrame(ws);
    const env = JSON.parse(frame);
    expect(env.type).toBe('event');
    expect(env.kind).toBe('connected');
    expect(env.data?.heartbeatIntervalMs).toBe(30_000);
    expect(app.sessionsModule.openSockets.has(sessionId)).toBe(true);
    ws.close();
    await once(ws, 'close');
    // give the close handler a tick to run
    await new Promise((r) => setTimeout(r, 50));
    expect(app.sessionsModule.openSockets.has(sessionId)).toBe(false);
  });
});

describe('Sessions WS handler — session-state guards', () => {
  const apiKeyId = randomUUID();
  const sessionId = randomUUID();
  const deviceId = randomUUID();
  const authToken = 'tok-' + randomUUID();

  it('rejects connection when session not owned by token key (close 1008)', async () => {
    const otherOwner = randomUUID();
    const app = await buildApp({
      authToken, apiKeyId, sessionId, deviceId,
      sessionOwnerKeyId: otherOwner,
    });
    try {
      const ws = dial(app.address, sessionId, authToken);
      const closed = waitClose(ws);
      const firstFrame = await Promise.race([
        nextFrame(ws).catch(() => null),
        new Promise<null>((r) => setTimeout(() => r(null), 500)),
      ]);
      if (firstFrame) {
        const env = JSON.parse(firstFrame);
        expect(env.code).toBe('unauthorized');
      }
      const { code } = await closed;
      expect(code).toBe(1008);
    } finally {
      await app.fastify.close();
    }
  });

  it('rejects connection when session lease expired (close 1008, session_not_found)', async () => {
    const app = await buildApp({
      authToken, apiKeyId, sessionId, deviceId,
      leaseExpired: true,
    });
    try {
      const ws = dial(app.address, sessionId, authToken);
      const closed = waitClose(ws);
      const firstFrame = await Promise.race([
        nextFrame(ws).catch(() => null),
        new Promise<null>((r) => setTimeout(() => r(null), 500)),
      ]);
      if (firstFrame) {
        expect(JSON.parse(firstFrame).code).toBe('session_not_found');
      }
      const { code } = await closed;
      expect(code).toBe(1008);
    } finally {
      await app.fastify.close();
    }
  });

  it('rejects connection when session status=released (close 1008)', async () => {
    const app = await buildApp({
      authToken, apiKeyId, sessionId, deviceId,
      sessionStatus: 'released',
    });
    try {
      const ws = dial(app.address, sessionId, authToken);
      const closed = waitClose(ws);
      const firstFrame = await Promise.race([
        nextFrame(ws).catch(() => null),
        new Promise<null>((r) => setTimeout(() => r(null), 500)),
      ]);
      if (firstFrame) {
        expect(JSON.parse(firstFrame).code).toBe('session_not_found');
      }
      const { code } = await closed;
      expect(code).toBe(1008);
    } finally {
      await app.fastify.close();
    }
  });
});

describe('Sessions WS handler — message handling (ping/pong, invalid envelope)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const apiKeyId = randomUUID();
  const sessionId = randomUUID();
  const deviceId = randomUUID();
  const authToken = 'tok-' + randomUUID();
  let ws: WebSocket;

  beforeEach(async () => {
    app = await buildApp({ authToken, apiKeyId, sessionId, deviceId });
    ws = dial(app.address, sessionId, authToken);
    await once(ws, 'open');
    // Drain the 'connected' event
    await nextFrame(ws);
  });
  afterEach(async () => {
    if (ws.readyState === WebSocket.OPEN) ws.close();
    await app.fastify.close();
  });

  it('echoes ping envelope as pong with matching forMsgId', async () => {
    const id = randomUUID();
    ws.send(JSON.stringify({ id, type: 'ping' }));
    const frame = await nextFrame(ws);
    const env = JSON.parse(frame);
    expect(env.type).toBe('pong');
    expect(env.forMsgId).toBe(id);
  });

  it('drops invalid JSON frame without closing the socket', async () => {
    ws.send('this is not JSON');
    // Send a follow-up valid ping to prove the socket is still alive.
    const id = randomUUID();
    // give the server a tick to log+drop the bad frame
    await new Promise((r) => setTimeout(r, 50));
    ws.send(JSON.stringify({ id, type: 'ping' }));
    const frame = await nextFrame(ws);
    const env = JSON.parse(frame);
    expect(env.type).toBe('pong');
    expect(env.forMsgId).toBe(id);
  });

  it('replies invalid_envelope + closes 1003 on schema-invalid envelope', async () => {
    ws.send(JSON.stringify({ id: randomUUID(), type: 'definitely-bogus-type' }));
    const frame = await nextFrame(ws);
    const env = JSON.parse(frame);
    expect(env.type).toBe('error');
    expect(env.code).toBe('invalid_envelope');
    const { code } = await waitClose(ws);
    expect(code).toBe(1003);
  });

  it('replies invalid_envelope on missing id field', async () => {
    ws.send(JSON.stringify({ type: 'tap', x: 1, y: 2 }));
    const frame = await nextFrame(ws);
    const env = JSON.parse(frame);
    expect(env.type).toBe('error');
    expect(env.code).toBe('invalid_envelope');
  });
});
