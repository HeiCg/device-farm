/**
 * Phase 35 Plan 35-02 — server-side budget enforcement spec.
 *
 * Verifies three budget caps:
 *   1. budgetTaps  — tapCounter intercept (>budgetTaps trips watchdog → q.return).
 *   2. budgetScreens — explore_save_screen returns {error:'budget_exceeded'}.
 *   3. budgetSeconds — watchdog setTimeout fires + emit.finished with budget reason.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../../db/schema.js';
import type { Database } from '../../db/index.js';
import { runExploration } from '../internal/agent-runner.js';
import { buildExplorationTools } from '../internal/agent-tools.js';
import { StuckDetector } from '../internal/stuck-detector.js';
import { Watchdog } from '../internal/watchdog.js';
import { _resetPromptCache } from '../internal/prompts-loader.js';

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

describe('Phase 35 Plan 35-02 — budget caps (in-memory units)', () => {
  describe('budgetScreens cap (in-memory)', () => {
    it('explore_save_screen returns budget_exceeded when count >= budgetScreens', async () => {
      let countCalls = 0;
      const db = {
        select: vi.fn((cols?: Record<string, unknown>) => ({
          from: (_tbl: unknown) => ({
            where: (_pred: unknown) => {
              if (cols && 'count' in cols) {
                countCalls++;
                return Promise.resolve([{ count: 60 }]); // hits the cap
              }
              return { limit: (_n: number) => Promise.resolve([]) };
            },
          }),
        })),
        insert: vi.fn(),
        update: vi.fn(),
        execute: vi.fn(),
      };
      const emit = {
        started: vi.fn(),
        screenDiscovered: vi.fn(),
        transition: vi.fn(),
        stuck: vi.fn(),
        toolCall: vi.fn(),
        finished: vi.fn(),
        failed: vi.fn(),
      };
      const tools = buildExplorationTools('run-budget-screens', {
        db: db as never,
        emit: emit as never,
        stuckDetector: new StuckDetector(),
        bfsOrderCounter: { value: 0 },
        budgetScreens: 60,
        loadArtifact: async () => Buffer.alloc(0),
      });
      const t = tools.find((t) => t.name === 'explore_save_screen')!;
      const res = await (t.handler as (a: unknown, e: unknown) => Promise<unknown>)(
        {
          title: 'Anything',
          elements: [],
          screenshot_artifact_id: '11111111-1111-1111-1111-111111111111',
        },
        {},
      );
      const sc = (res as { structuredContent: { error?: string; screenCount?: number; budgetScreens?: number } })
        .structuredContent;
      expect(sc.error).toBe('budget_exceeded');
      expect(sc.screenCount).toBe(60);
      expect(sc.budgetScreens).toBe(60);
      expect(emit.screenDiscovered).not.toHaveBeenCalled();
      // No insert happened (budget gate is the first thing).
      expect(db.insert).not.toHaveBeenCalled();
    });
  });

  describe('budgetSeconds (watchdog)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('watchdog setTimeout fires after budgetSeconds → onTrigger("time")', () => {
      const trigger = vi.fn();
      const w = new Watchdog({ runId: 'r', budgetSeconds: 10, onTrigger: trigger });
      vi.advanceTimersByTime(9_999);
      expect(trigger).not.toHaveBeenCalled();
      vi.advanceTimersByTime(2);
      expect(trigger).toHaveBeenCalledWith('time');
      expect(w.exitReason()).toBe('time');
      w.dispose();
    });

    it('shouldStop() returns true after natural fire', () => {
      const trigger = vi.fn();
      const w = new Watchdog({ runId: 'r', budgetSeconds: 5, onTrigger: trigger });
      expect(w.shouldStop()).toBe(false);
      vi.advanceTimersByTime(5_001);
      expect(w.shouldStop()).toBe(true);
      w.dispose();
    });
  });
});

describeDb('Phase 35 Plan 35-02 — budget caps (DB-gated)', () => {
  let client: ReturnType<typeof postgres>;
  let db: Database;
  let testDeviceId: string;
  let testApiKeyId: string;
  let testJobId: string;
  let testArtifactId: string;
  let testSessionId: string;
  let createdExplorationIds: string[] = [];

  beforeEach(async () => {
    _resetPromptCache();
    client = postgres(DB_URL!, { max: 4 });
    db = drizzle(client, { schema }) as unknown as Database;

    testDeviceId = randomUUID();
    testApiKeyId = randomUUID();
    testJobId = randomUUID();
    testArtifactId = randomUUID();
    testSessionId = randomUUID();
    createdExplorationIds = [];

    await db.insert(schema.devices).values({
      id: testDeviceId,
      type: 'android',
      name: 'budget-device',
      status: 'idle',
      emulatorId: 'emulator-6592',
      port: 6592,
    });
    await db.insert(schema.apiKeys).values({
      id: testApiKeyId,
      keyHash: `hash-b-${testApiKeyId}`,
      keySalt: 's',
      keyPrefix: 'df_b',
      name: 'budget',
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
    if (createdExplorationIds.length > 0) {
      await db
        .delete(schema.explorations)
        .where(inArray(schema.explorations.id, createdExplorationIds));
    }
    await db.delete(schema.events).where(eq(schema.events.aggregateType, 'exploration'));
    await db.delete(schema.artifacts).where(eq(schema.artifacts.id, testArtifactId));
    await db.delete(schema.jobs).where(eq(schema.jobs.id, testJobId));
    await db.delete(schema.sessions).where(eq(schema.sessions.id, testSessionId));
    await db.delete(schema.apiKeys).where(eq(schema.apiKeys.id, testApiKeyId));
    await db.delete(schema.devices).where(eq(schema.devices.id, testDeviceId));
    await client.end();
  });

  function buildEmit() {
    return {
      started: vi.fn(),
      screenDiscovered: vi.fn(),
      transition: vi.fn(),
      stuck: vi.fn(),
      toolCall: vi.fn(),
      finished: vi.fn(),
      failed: vi.fn(),
    };
  }

  async function seedRun(overrides: Partial<typeof schema.explorations.$inferInsert> = {}) {
    const runId = randomUUID();
    createdExplorationIds.push(runId);
    await db.insert(schema.explorations).values({
      id: runId,
      deviceId: testDeviceId,
      sessionId: testSessionId,
      appArtifactId: testArtifactId,
      bundleId: 'com.budget.test',
      platform: 'android',
      status: 'queued',
      budgetTaps: 3,
      budgetScreens: 5,
      budgetSeconds: 60,
      config: { model: 'claude-sonnet-4-5' },
      ownerApiKeyId: testApiKeyId,
      ownerActor: `apikey:${testApiKeyId}`,
      ...overrides,
    });
    return runId;
  }

  it('budgetTaps trip: device_* tool_use beyond budgetTaps → watchdog.tripBudget → q.return called', async () => {
    const runId = await seedRun({ budgetTaps: 2 });
    const emit = buildEmit();

    // The mock generator yields 4 device_screenshot tool-uses across 2 turns.
    // The 3rd tap (> budgetTaps=2) should trip the watchdog → q.return() called.
    // returnFn returns a proper iterator-protocol DONE result so the for-await
    // loop exits cleanly instead of throwing "Iterator result undefined".
    const returnFn = vi.fn(async () => ({ value: undefined, done: true }));
    const queryFn = vi.fn(() => {
      const gen = (async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'device_screenshot', input: {} },
              { type: 'tool_use', name: 'device_screenshot', input: {} },
              { type: 'tool_use', name: 'device_screenshot', input: {} },
            ],
          },
        };
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', name: 'device_screenshot', input: {} }],
          },
        };
      })();
      return Object.assign(gen, { return: returnFn });
    });
    const createServerFn = vi.fn(() => ({ name: 'exploration-state', tools: [] }));

    await runExploration(runId, {
      db,
      emit: emit as never,
      loadArtifact: async () => Buffer.alloc(0),
      serverUrl: 'http://localhost:3000',
      sessionToken: 'tok',
      sdk: { query: queryFn as never, createSdkMcpServer: createServerFn as never },
      externalMcpConfig: { type: 'stdio', command: 'echo', args: [], env: {} } as never,
    });

    // q.return should have been called by the watchdog tripBudget hook.
    expect(returnFn).toHaveBeenCalled();
    // emit.finished fired with reason='budget'.
    expect(emit.finished).toHaveBeenCalledTimes(1);
    const finishedPayload = emit.finished.mock.calls[0]![1] as { reason: string; stats: { tapsTaken: number } };
    expect(finishedPayload.reason).toBe('budget');
    // tapsTaken counted at least budgetTaps+1.
    expect(finishedPayload.stats.tapsTaken).toBeGreaterThanOrEqual(3);
    // DB row status='failed' (budget terminal).
    const rows = await db
      .select({ status: schema.explorations.status })
      .from(schema.explorations)
      .where(eq(schema.explorations.id, runId));
    expect(rows[0]!.status).toBe('failed');
  });
});
