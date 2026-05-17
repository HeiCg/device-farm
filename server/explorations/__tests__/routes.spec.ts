/**
 * Phase 35 Plan 35-01 — explorations REST routes integration spec.
 *
 * DB-gated via TEST_DATABASE_URL / DATABASE_URL — skips when neither is set.
 * Covers (~12 tests):
 *   1. POST happy path → 201 + Zod-valid startResponseSchema, row inserted (status=queued)
 *   2. POST missing appArtifactId → 400
 *   3. POST invalid platform → 400
 *   4. POST budgetTaps out of range → 400
 *   5. POST unauthenticated → 401
 *   6. POST 503 when no idle device
 *   7. GET happy path (empty graph) → 200 + screens=[] + transitions=[]
 *   8. GET with seeded screens + transitions → ordered output
 *   9. GET 404 for unknown id
 *  10. DELETE cancels running → 204
 *  11. DELETE 404 for unknown id
 *  12. DELETE 404 for queued (only running is cancellable)
 *  13. boss.send was called with singletonKey:runId (sentinel mock)
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import Fastify from 'fastify';
import fp from 'fastify-plugin';
import {
  fastifyZodOpenApiPlugin,
  validatorCompiler,
  serializerCompiler,
} from 'fastify-zod-openapi';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../../db/schema.js';
import type { Database } from '../../db/index.js';

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

describeDb('Phase 35 — explorations plugin + REST routes (DB-gated)', () => {
  let client: ReturnType<typeof postgres>;
  let db: Database;
  let testDeviceId: string;
  let testApiKeyId: string;
  let testJobId: string;
  let testArtifactId: string;
  let testSessionId: string;
  let createdExplorationIds: string[] = [];
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
    testJobId = randomUUID();
    testArtifactId = randomUUID();
    testSessionId = randomUUID();
    createdExplorationIds = [];
    createdEventIds = [];

    await db.insert(schema.devices).values({
      id: testDeviceId,
      type: 'android',
      name: 'explorations-route-device',
      status: 'idle',
      emulatorId: 'emulator-5562',
      port: 5562,
    });
    await db.insert(schema.apiKeys).values({
      id: testApiKeyId,
      keyHash: `hash-explrt-${testApiKeyId}`,
      keySalt: 'salt-explrt',
      keyPrefix: 'df_explrt',
      name: 'explorations-route-key',
      claims: {},
    });
    await db.insert(schema.sessions).values({
      id: testSessionId,
      deviceId: testDeviceId,
      ownerApiKeyId: testApiKeyId,
      ownerActor: `apikey:${testApiKeyId}`,
      status: 'active',
      ttlSeconds: 600,
      leaseUntil: new Date(Date.now() + 600_000),
      metadata: null,
    });
    await db.insert(schema.jobs).values({
      id: testJobId,
      platform: 'android',
      deviceId: testDeviceId,
      status: 'queued',
    });
    await db.insert(schema.artifacts).values({
      id: testArtifactId,
      jobId: testJobId,
      type: 'log',
      filePath: '/tmp/test.apk',
      fileName: 'app.apk',
      mimeType: 'application/vnd.android.package-archive',
      fileSizeBytes: 1024,
    });
  });

  afterEach(async () => {
    if (createdEventIds.length > 0) {
      await db.delete(schema.events).where(inArray(schema.events.id, createdEventIds));
    }
    // Wipe ALL events for this device's runs (persistEnvelope may fire async).
    await db.delete(schema.events).where(eq(schema.events.aggregateType, 'exploration'));
    if (createdExplorationIds.length > 0) {
      await db
        .delete(schema.explorations)
        .where(inArray(schema.explorations.id, createdExplorationIds));
    }
    await db.delete(schema.artifacts).where(eq(schema.artifacts.id, testArtifactId));
    await db.delete(schema.jobs).where(eq(schema.jobs.id, testJobId));
    await db.delete(schema.sessions).where(eq(schema.sessions.id, testSessionId));
    await db.delete(schema.apiKeys).where(eq(schema.apiKeys.id, testApiKeyId));
    await db.delete(schema.devices).where(eq(schema.devices.id, testDeviceId));
  });

  /**
   * Build a minimal Fastify app with the explorations plugin + stubbed
   * substrate (config, db, pool, authService, boss). Does NOT register
   * sessionsModule — exercises the fallback pool allocation path.
   */
  async function buildTestApp(
    opts: {
      withDevice?: boolean;
      validBearer?: boolean;
    } = {},
  ) {
    const withDevice = opts.withDevice ?? true;
    const validBearer = opts.validBearer ?? true;

    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(fastifyZodOpenApiPlugin);

    // Sentinel pool stub.
    const poolDevice = withDevice
      ? { id: testDeviceId, name: 'explorations-route-device' }
      : null;
    const pool = {
      allocate: vi.fn(async (_platform: 'android' | 'ios') =>
        poolDevice ? { id: poolDevice.id, name: poolDevice.name } : null,
      ),
      release: vi.fn(async () => undefined),
    };

    // boss sentinel — record send() calls so we can assert singletonKey.
    const boss = {
      send: vi.fn(async (_name: string, _data: unknown, _opts?: { singletonKey?: string }) =>
        randomUUID(),
      ),
    };

    // Sessions module stub — Phase 34 sessions lease shape. Returns the
    // pre-seeded testSessionId so the FK on explorations.session_id resolves.
    const sessionsModule = {
      leaseDevice: vi.fn(
        async (
          input: { platform: 'android' | 'ios'; ttlSeconds: number },
          _actor: string,
          _bearer: string,
        ) => {
          if (!poolDevice) {
            const err = new Error('no_device_available') as Error & {
              statusCode: number;
              code: string;
            };
            err.statusCode = 503;
            err.code = 'no_device_available';
            throw err;
          }
          return {
            sessionId: testSessionId,
            deviceId: poolDevice.id,
            deviceName: poolDevice.name,
            platform: input.platform,
            wsUrl: `ws://localhost:3000/ws/sessions/${testSessionId}`,
            leaseUntil: new Date(Date.now() + input.ttlSeconds * 1000).toISOString(),
            ttlSeconds: input.ttlSeconds,
          };
        },
      ),
    };

    await app.register(
      fp(
        async (instance) => {
          instance.decorate(
            'config',
            { server: { port: 3000, host: '0.0.0.0' }, auth: { enabled: true } } as never,
          );
          instance.decorate('db', db as never);
          instance.decorate('pool', pool as never);
          instance.decorate('boss', boss as never);
          instance.decorate('sessionsModule', sessionsModule as never);
          instance.decorate('authService', {
            validateKeyAndReturnRow: async (key: string) => {
              if (validBearer && key === `bearer-${testApiKeyId}`) {
                return { id: testApiKeyId, name: 'explorations-route-key', claims: {} };
              }
              return null;
            },
          } as never);
        },
        {
          name: 'fake-substrate',
          // Provide fake decorators that mirror the deps the explorations plugin expects.
          // The explorations plugin declares deps [config, db, event-bus, queue, auth].
          // We do NOT register the real event-bus / queue / auth plugins (they have their
          // own dep chains). To satisfy fastify-plugin's dep check, expose the SAME
          // plugin-name strings via additional registered plugins below.
        },
      ),
    );
    // Register lightweight stand-in plugins so the explorations plugin's
    // dependencies array resolves.
    await app.register(
      fp(async () => undefined, { name: 'config' }),
    );
    await app.register(
      fp(async () => undefined, { name: 'db' }),
    );
    await app.register(
      fp(async () => undefined, { name: 'event-bus' }),
    );
    await app.register(
      fp(async () => undefined, { name: 'queue' }),
    );
    await app.register(
      fp(async () => undefined, { name: 'auth' }),
    );

    const { default: explorationsPlugin } = await import('../plugin.js');
    await app.register(explorationsPlugin);
    await app.ready();
    return { app, pool, boss };
  }

  // ---------- POST happy + sad paths ----------

  it('POST /api/explorations returns 201 + Zod-valid response; row inserted (status=queued); boss.send singletonKey=runId', async () => {
    const { app, boss } = await buildTestApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/explorations',
        headers: { authorization: `Bearer bearer-${testApiKeyId}` },
        payload: {
          appArtifactId: testArtifactId,
          platform: 'android',
          bundleId: 'com.example.app',
          budgetTaps: 100,
          budgetScreens: 30,
          budgetSeconds: 600,
          model: 'claude-sonnet-4-5',
        },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body) as {
        runId: string;
        sessionId: string;
        deviceId: string;
        agentLogStreamUrl: string;
        estimatedDurationMin: number;
      };
      expect(body.runId).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.deviceId).toBe(testDeviceId);
      expect(body.agentLogStreamUrl).toContain(`/api/explorations/${body.runId}/events`);
      expect(body.estimatedDurationMin).toBeGreaterThan(0);

      // Row inserted with status='queued'.
      const rows = await db
        .select()
        .from(schema.explorations)
        .where(eq(schema.explorations.id, body.runId));
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('queued');
      expect(rows[0].deviceId).toBe(testDeviceId);
      expect(rows[0].ownerApiKeyId).toBe(testApiKeyId);
      expect(rows[0].ownerActor).toBe(`apikey:${testApiKeyId}`);
      createdExplorationIds.push(body.runId);

      // boss.send called once with singletonKey=runId.
      expect(boss.send).toHaveBeenCalledTimes(1);
      const sendArgs = boss.send.mock.calls[0];
      expect(sendArgs[0]).toBe('exploration.run');
      expect(sendArgs[1]).toEqual({ runId: body.runId });
      expect(sendArgs[2]).toEqual({ singletonKey: body.runId });
    } finally {
      await app.close();
    }
  });

  it('POST /api/explorations 400 — missing appArtifactId', async () => {
    const { app } = await buildTestApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/explorations',
        headers: { authorization: `Bearer bearer-${testApiKeyId}` },
        payload: {
          platform: 'android',
          bundleId: 'com.example.app',
        },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('POST /api/explorations 400 — invalid platform', async () => {
    const { app } = await buildTestApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/explorations',
        headers: { authorization: `Bearer bearer-${testApiKeyId}` },
        payload: {
          appArtifactId: testArtifactId,
          platform: 'windows',
          bundleId: 'com.example.app',
        },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('POST /api/explorations 400 — budgetTaps out of range', async () => {
    const { app } = await buildTestApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/explorations',
        headers: { authorization: `Bearer bearer-${testApiKeyId}` },
        payload: {
          appArtifactId: testArtifactId,
          platform: 'android',
          bundleId: 'com.example.app',
          budgetTaps: 5, // min is 10
        },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('POST /api/explorations 401 — missing bearer token', async () => {
    const { app } = await buildTestApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/explorations',
        payload: {
          appArtifactId: testArtifactId,
          platform: 'android',
          bundleId: 'com.example.app',
        },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('POST /api/explorations 503 — pool has no idle device of requested platform', async () => {
    const { app } = await buildTestApp({ withDevice: false });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/explorations',
        headers: { authorization: `Bearer bearer-${testApiKeyId}` },
        payload: {
          appArtifactId: testArtifactId,
          platform: 'android',
          bundleId: 'com.example.app',
        },
      });
      expect(res.statusCode).toBe(503);
    } finally {
      await app.close();
    }
  });

  // ---------- GET happy + sad paths ----------

  it('GET /api/explorations/:id returns full graph (empty screens + transitions)', async () => {
    const { app } = await buildTestApp();
    try {
      const create = await app.inject({
        method: 'POST',
        url: '/api/explorations',
        headers: { authorization: `Bearer bearer-${testApiKeyId}` },
        payload: {
          appArtifactId: testArtifactId,
          platform: 'android',
          bundleId: 'com.example.app',
        },
      });
      const body = JSON.parse(create.body) as { runId: string };
      createdExplorationIds.push(body.runId);

      const getRes = await app.inject({
        method: 'GET',
        url: `/api/explorations/${body.runId}`,
        headers: { authorization: `Bearer bearer-${testApiKeyId}` },
      });
      expect(getRes.statusCode).toBe(200);
      const graph = JSON.parse(getRes.body) as {
        exploration: { id: string; status: string };
        screens: unknown[];
        transitions: unknown[];
      };
      expect(graph.exploration.id).toBe(body.runId);
      expect(graph.exploration.status).toBe('queued');
      expect(graph.screens).toEqual([]);
      expect(graph.transitions).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('GET /api/explorations/:id returns seeded screens + transitions in BFS order', async () => {
    const { app } = await buildTestApp();
    try {
      const create = await app.inject({
        method: 'POST',
        url: '/api/explorations',
        headers: { authorization: `Bearer bearer-${testApiKeyId}` },
        payload: {
          appArtifactId: testArtifactId,
          platform: 'android',
          bundleId: 'com.example.app',
        },
      });
      const body = JSON.parse(create.body) as { runId: string };
      createdExplorationIds.push(body.runId);

      // Seed 2 screens + 2 transitions.
      await db.insert(schema.explorationScreens).values([
        {
          runId: body.runId,
          screenId: 'home',
          title: 'Home',
          screenshotArtifactId: testArtifactId, // reuse — any artifact works
          elements: [],
          bfsDepth: 0,
        },
        {
          runId: body.runId,
          screenId: 'shop',
          title: 'Shop',
          screenshotArtifactId: testArtifactId,
          elements: [],
          bfsDepth: 1,
        },
      ]);
      await db.insert(schema.explorationTransitions).values([
        {
          runId: body.runId,
          fromScreenId: 'home',
          toScreenId: 'shop',
          action: { type: 'tap' },
          actionHash: 'h1',
          isBackEdge: false,
          bfsOrder: 1,
        },
        {
          runId: body.runId,
          fromScreenId: 'shop',
          toScreenId: 'home',
          action: { type: 'back' },
          actionHash: 'h2',
          isBackEdge: true,
          bfsOrder: 2,
        },
      ]);

      const getRes = await app.inject({
        method: 'GET',
        url: `/api/explorations/${body.runId}`,
        headers: { authorization: `Bearer bearer-${testApiKeyId}` },
      });
      expect(getRes.statusCode).toBe(200);
      const graph = JSON.parse(getRes.body) as {
        screens: Array<{ screenId: string; bfsDepth: number }>;
        transitions: Array<{ actionHash: string; bfsOrder: number; isBackEdge: boolean }>;
      };
      expect(graph.screens.map((s) => s.screenId)).toEqual(['home', 'shop']);
      expect(graph.transitions.map((t) => t.actionHash)).toEqual(['h1', 'h2']);
      expect(graph.transitions[1].isBackEdge).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('GET /api/explorations/:id returns 404 for unknown id', async () => {
    const { app } = await buildTestApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/explorations/${randomUUID()}`,
        headers: { authorization: `Bearer bearer-${testApiKeyId}` },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  // ---------- DELETE happy + sad paths ----------

  it('DELETE /api/explorations/:id cancels running run → 204', async () => {
    const { app } = await buildTestApp();
    try {
      const create = await app.inject({
        method: 'POST',
        url: '/api/explorations',
        headers: { authorization: `Bearer bearer-${testApiKeyId}` },
        payload: {
          appArtifactId: testArtifactId,
          platform: 'android',
          bundleId: 'com.example.app',
        },
      });
      const body = JSON.parse(create.body) as { runId: string };
      createdExplorationIds.push(body.runId);

      // Bring to running so DELETE will cancel.
      await db
        .update(schema.explorations)
        .set({ status: 'running', startedAt: new Date() })
        .where(eq(schema.explorations.id, body.runId));

      const delRes = await app.inject({
        method: 'DELETE',
        url: `/api/explorations/${body.runId}`,
        headers: { authorization: `Bearer bearer-${testApiKeyId}` },
      });
      expect(delRes.statusCode).toBe(204);

      const after = await db
        .select()
        .from(schema.explorations)
        .where(eq(schema.explorations.id, body.runId));
      expect(after[0].status).toBe('cancelled');
      expect(after[0].finishedAt).not.toBeNull();
    } finally {
      await app.close();
    }
  });

  it('DELETE /api/explorations/:id returns 404 for unknown id', async () => {
    const { app } = await buildTestApp();
    try {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/explorations/${randomUUID()}`,
        headers: { authorization: `Bearer bearer-${testApiKeyId}` },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('DELETE /api/explorations/:id returns 404 for queued (only running is cancellable)', async () => {
    const { app } = await buildTestApp();
    try {
      const create = await app.inject({
        method: 'POST',
        url: '/api/explorations',
        headers: { authorization: `Bearer bearer-${testApiKeyId}` },
        payload: {
          appArtifactId: testArtifactId,
          platform: 'android',
          bundleId: 'com.example.app',
        },
      });
      const body = JSON.parse(create.body) as { runId: string };
      createdExplorationIds.push(body.runId);

      const delRes = await app.inject({
        method: 'DELETE',
        url: `/api/explorations/${body.runId}`,
        headers: { authorization: `Bearer bearer-${testApiKeyId}` },
      });
      expect(delRes.statusCode).toBe(404);

      // Status still queued.
      const after = await db
        .select()
        .from(schema.explorations)
        .where(eq(schema.explorations.id, body.runId));
      expect(after[0].status).toBe('queued');
    } finally {
      await app.close();
    }
  });
});
