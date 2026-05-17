/**
 * Phase 35 Plan 35-01 — explorations Drizzle helpers (store layer) spec.
 *
 * DB-gated via TEST_DATABASE_URL / DATABASE_URL — skips when neither is set.
 * Asserts:
 *   - insertExplorationRow inserts + returns Zod-valid row with defaults
 *   - getExploration returns null for unknown id
 *   - getScreens ordered by bfsDepth then visitedAt
 *   - getTransitions ordered by bfsOrder
 *   - cancelExploration only mutates status='running' rows
 *   - Cascade delete: deleting an exploration removes child screens + transitions
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../../db/schema.js';
import type { Database } from '../../db/index.js';
import * as repo from '../internal/repo.js';

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

describeDb('Phase 35 — explorations repo (DB-gated)', () => {
  let client: ReturnType<typeof postgres>;
  let db: Database;

  let testDeviceId: string;
  let testApiKeyId: string;
  let testSessionId: string;
  let testJobId: string;
  let testArtifactId: string;
  let testScreenshotArtifactId: string;
  let createdExplorationIds: string[] = [];

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
    testSessionId = randomUUID();
    testJobId = randomUUID();
    testArtifactId = randomUUID();
    testScreenshotArtifactId = randomUUID();
    createdExplorationIds = [];

    await db.insert(schema.devices).values({
      id: testDeviceId,
      type: 'android',
      name: 'explorations-test-device',
      status: 'idle',
      emulatorId: 'emulator-5560',
      port: 5560,
    });
    await db.insert(schema.apiKeys).values({
      id: testApiKeyId,
      keyHash: `hash-explrepo-${testApiKeyId}`,
      keySalt: 'salt-explrepo',
      keyPrefix: 'df_explr_',
      name: 'explorations-repo-key',
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
    // artifacts.jobId is NOT NULL — seed a parent job row first.
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
    await db.insert(schema.artifacts).values({
      id: testScreenshotArtifactId,
      jobId: testJobId,
      type: 'screenshot',
      filePath: '/tmp/home.png',
      fileName: 'home.png',
      mimeType: 'image/png',
      fileSizeBytes: 2048,
    });
  });

  afterEach(async () => {
    if (createdExplorationIds.length > 0) {
      await db
        .delete(schema.explorations)
        .where(inArray(schema.explorations.id, createdExplorationIds));
    }
    await db.delete(schema.sessions).where(eq(schema.sessions.id, testSessionId));
    // artifacts cascade-delete with the parent job; explicit delete first
    // anyway to keep ordering deterministic if cascade rules change.
    await db.delete(schema.artifacts).where(eq(schema.artifacts.id, testArtifactId));
    await db
      .delete(schema.artifacts)
      .where(eq(schema.artifacts.id, testScreenshotArtifactId));
    await db.delete(schema.jobs).where(eq(schema.jobs.id, testJobId));
    await db.delete(schema.apiKeys).where(eq(schema.apiKeys.id, testApiKeyId));
    await db.delete(schema.devices).where(eq(schema.devices.id, testDeviceId));
  });

  function baseFields(): Parameters<typeof repo.insertExplorationRow>[1] {
    return {
      deviceId: testDeviceId,
      sessionId: testSessionId,
      appArtifactId: testArtifactId,
      bundleId: 'com.example.app',
      platform: 'android',
      budgetTaps: 200,
      budgetScreens: 60,
      budgetSeconds: 1800,
      config: { model: 'claude-sonnet-4-5' },
      ownerApiKeyId: testApiKeyId,
      ownerActor: `apikey:${testApiKeyId}`,
    };
  }

  it('insertExplorationRow inserts + returns Zod-valid row with status=queued + createdAt populated', async () => {
    const row = await repo.insertExplorationRow({ db }, baseFields());
    createdExplorationIds.push(row.id);

    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.status).toBe('queued');
    expect(row.platform).toBe('android');
    expect(row.budgetTaps).toBe(200);
    expect(row.budgetScreens).toBe(60);
    expect(row.budgetSeconds).toBe(1800);
    expect(row.ownerApiKeyId).toBe(testApiKeyId);
    expect(row.ownerActor).toBe(`apikey:${testApiKeyId}`);
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.startedAt).toBeNull();
    expect(row.finishedAt).toBeNull();
  });

  it('getExploration returns null for unknown id', async () => {
    const res = await repo.getExploration({ db }, randomUUID());
    expect(res).toBeNull();
  });

  it('getExploration returns the inserted row', async () => {
    const row = await repo.insertExplorationRow({ db }, baseFields());
    createdExplorationIds.push(row.id);

    const fetched = await repo.getExploration({ db }, row.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(row.id);
    expect(fetched?.bundleId).toBe('com.example.app');
  });

  it('getScreens returns empty array for a run with no screens', async () => {
    const row = await repo.insertExplorationRow({ db }, baseFields());
    createdExplorationIds.push(row.id);

    const screens = await repo.getScreens({ db }, row.id);
    expect(screens).toEqual([]);
  });

  it('getScreens returns rows ordered by bfsDepth then visitedAt', async () => {
    const row = await repo.insertExplorationRow({ db }, baseFields());
    createdExplorationIds.push(row.id);

    const t0 = new Date(Date.now() - 5000);
    const t1 = new Date(Date.now() - 4000);
    const t2 = new Date(Date.now() - 3000);

    await db.insert(schema.explorationScreens).values([
      {
        runId: row.id,
        screenId: 'home',
        title: 'Home',
        screenshotArtifactId: testScreenshotArtifactId,
        elements: [],
        bfsDepth: 0,
        visitedAt: t0,
      },
      {
        runId: row.id,
        screenId: 'settings',
        title: 'Settings',
        screenshotArtifactId: testScreenshotArtifactId,
        elements: [],
        bfsDepth: 2,
        visitedAt: t2,
      },
      {
        runId: row.id,
        screenId: 'shop',
        title: 'Shop',
        screenshotArtifactId: testScreenshotArtifactId,
        elements: [],
        bfsDepth: 1,
        visitedAt: t1,
      },
    ]);

    const screens = await repo.getScreens({ db }, row.id);
    expect(screens.map((s) => s.screenId)).toEqual(['home', 'shop', 'settings']);
  });

  it('getTransitions returns rows ordered by bfsOrder', async () => {
    const row = await repo.insertExplorationRow({ db }, baseFields());
    createdExplorationIds.push(row.id);

    await db.insert(schema.explorationTransitions).values([
      {
        runId: row.id,
        fromScreenId: 'home',
        toScreenId: 'settings',
        action: { type: 'tap', x: 100, y: 200 },
        actionHash: 'hash-c',
        isBackEdge: false,
        bfsOrder: 3,
      },
      {
        runId: row.id,
        fromScreenId: 'home',
        toScreenId: 'shop',
        action: { type: 'tap', x: 50, y: 100 },
        actionHash: 'hash-a',
        isBackEdge: false,
        bfsOrder: 1,
      },
      {
        runId: row.id,
        fromScreenId: 'shop',
        toScreenId: 'home',
        action: { type: 'back' },
        actionHash: 'hash-b',
        isBackEdge: true,
        bfsOrder: 2,
      },
    ]);

    const transitions = await repo.getTransitions({ db }, row.id);
    expect(transitions.map((t) => t.actionHash)).toEqual(['hash-a', 'hash-b', 'hash-c']);
    expect(transitions[1].isBackEdge).toBe(true);
  });

  it('cancelExploration only mutates status=running rows', async () => {
    // queued — should NOT cancel.
    const queued = await repo.insertExplorationRow({ db }, baseFields());
    createdExplorationIds.push(queued.id);
    expect(await repo.cancelExploration({ db }, queued.id)).toBe(false);

    // Move to running, then cancel — should succeed.
    await db
      .update(schema.explorations)
      .set({ status: 'running', startedAt: new Date() })
      .where(eq(schema.explorations.id, queued.id));
    expect(await repo.cancelExploration({ db }, queued.id)).toBe(true);

    const after = await repo.getExploration({ db }, queued.id);
    expect(after?.status).toBe('cancelled');
    expect(after?.finishedAt).not.toBeNull();

    // Second cancel attempt on already-cancelled — should return false.
    expect(await repo.cancelExploration({ db }, queued.id)).toBe(false);
  });

  it('cancelExploration returns false for unknown id', async () => {
    expect(await repo.cancelExploration({ db }, randomUUID())).toBe(false);
  });

  it('cascade delete: deleting an exploration removes child screens + transitions', async () => {
    const row = await repo.insertExplorationRow({ db }, baseFields());
    // Don't push — we delete manually below.

    await db.insert(schema.explorationScreens).values([
      {
        runId: row.id,
        screenId: 'home',
        title: 'Home',
        screenshotArtifactId: testScreenshotArtifactId,
        elements: [],
        bfsDepth: 0,
      },
      {
        runId: row.id,
        screenId: 'shop',
        title: 'Shop',
        screenshotArtifactId: testScreenshotArtifactId,
        elements: [],
        bfsDepth: 1,
      },
    ]);
    await db.insert(schema.explorationTransitions).values([
      {
        runId: row.id,
        fromScreenId: 'home',
        toScreenId: 'shop',
        action: { type: 'tap' },
        actionHash: 'h1',
        isBackEdge: false,
        bfsOrder: 1,
      },
      {
        runId: row.id,
        fromScreenId: 'shop',
        toScreenId: 'home',
        action: { type: 'back' },
        actionHash: 'h2',
        isBackEdge: true,
        bfsOrder: 2,
      },
      {
        runId: row.id,
        fromScreenId: 'home',
        toScreenId: 'shop',
        action: { type: 'tap', x: 10, y: 20 },
        actionHash: 'h3',
        isBackEdge: false,
        bfsOrder: 3,
      },
    ]);

    // Pre-check.
    expect((await repo.getScreens({ db }, row.id)).length).toBe(2);
    expect((await repo.getTransitions({ db }, row.id)).length).toBe(3);

    await db.delete(schema.explorations).where(eq(schema.explorations.id, row.id));

    // FK ON DELETE CASCADE wipes children.
    expect((await repo.getScreens({ db }, row.id)).length).toBe(0);
    expect((await repo.getTransitions({ db }, row.id)).length).toBe(0);
  });
});
