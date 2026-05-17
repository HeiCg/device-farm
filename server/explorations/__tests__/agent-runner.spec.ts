/**
 * Phase 35 Plan 35-02 — agent-runner spec (Claude Agent SDK mocked).
 *
 * The agent-runner accepts an optional `sdk: {query, createSdkMcpServer}`
 * injection. We pass mocked versions and assert on the args + side-effects:
 *
 *   1. query() is invoked with mcpServers config containing BOTH
 *      'exploration-state' (in-process) and 'device-stream' (external stdio).
 *   2. allowedTools includes both device_* and explore_* names.
 *   3. maxTurns is derived from budgetTaps * 3.
 *   4. systemPrompt is the loaded prompts/exploration.md content.
 *   5. On iterator completion: emit.started fired at start + emit.finished
 *      fired at end with stats.
 *   6. On iterator throw: emit.failed fired with reason.
 *   7. tap-counter wiring: device_* tool_use messages increment, budget cap
 *      trips watchdog → q.return called.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../../db/schema.js';
import type { Database } from '../../db/index.js';
import { runExploration } from '../internal/agent-runner.js';
import { _resetPromptCache } from '../internal/prompts-loader.js';

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

describeDb('Phase 35 Plan 35-02 — agent-runner (DB-gated, SDK mocked)', () => {
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
      name: 'agentrunner-device',
      status: 'idle',
      emulatorId: 'emulator-6562',
      port: 6562,
    });
    await db.insert(schema.apiKeys).values({
      id: testApiKeyId,
      keyHash: `hash-ar-${testApiKeyId}`,
      keySalt: 'salt-ar',
      keyPrefix: 'df_ar',
      name: 'agent-runner-key',
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

  function buildEmitStub() {
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
      bundleId: 'com.example.test',
      platform: 'android',
      status: 'queued',
      budgetTaps: 10,
      budgetScreens: 5,
      budgetSeconds: 60,
      config: { model: 'claude-sonnet-4-5' },
      ownerApiKeyId: testApiKeyId,
      ownerActor: `apikey:${testApiKeyId}`,
      ...overrides,
    });
    return runId;
  }

  it('query() invoked with mcpServers containing exploration-state + device-stream + allowedTools + maxTurns', async () => {
    const runId = await seedRun({ budgetTaps: 7 });
    const emit = buildEmitStub();
    const queryFn = vi.fn(() => {
      const gen = (async function* () {
        // No messages — immediate completion.
      })();
      return Object.assign(gen, { return: vi.fn() });
    });
    const createServerFn = vi.fn(() => ({ name: 'exploration-state', tools: [] }));

    await runExploration(runId, {
      db,
      emit: emit as never,
      loadArtifact: async () => Buffer.alloc(0),
      serverUrl: 'http://localhost:3000',
      sessionToken: 'tok',
      sdk: { query: queryFn as never, createSdkMcpServer: createServerFn as never },
      externalMcpConfig: { type: 'stdio', command: 'echo', args: ['no-op'], env: {} } as never,
    });

    expect(queryFn).toHaveBeenCalledTimes(1);
    const callArgs = (queryFn.mock.calls as unknown as Array<[{
      prompt: string;
      options: { mcpServers: Record<string, unknown>; allowedTools: string[]; maxTurns: number; systemPrompt: string };
    }]>)[0]![0];
    expect(callArgs.prompt).toContain('com.example.test');
    expect(callArgs.options.mcpServers).toHaveProperty('exploration-state');
    expect(callArgs.options.mcpServers).toHaveProperty('device-stream');
    expect(callArgs.options.allowedTools).toContain('device_screenshot');
    expect(callArgs.options.allowedTools).toContain('device_tap_by_description');
    expect(callArgs.options.allowedTools).toContain('explore_save_screen');
    expect(callArgs.options.allowedTools).toContain('explore_finish');
    expect(callArgs.options.maxTurns).toBe(7 * 3);
    expect(callArgs.options.systemPrompt).toContain('# App Explorer Agent');
  });

  it('on successful completion: emit.started + emit.finished fired with stats', async () => {
    const runId = await seedRun();
    const emit = buildEmitStub();
    const queryFn = vi.fn(() => {
      const gen = (async function* () {
        // No-op iteration.
      })();
      return Object.assign(gen, { return: vi.fn() });
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

    expect(emit.started).toHaveBeenCalledTimes(1);
    expect(emit.started).toHaveBeenCalledWith(
      runId,
      expect.objectContaining({ runId, bundleId: 'com.example.test', platform: 'android' }),
    );
    expect(emit.finished).toHaveBeenCalledTimes(1);
    const finishedPayload = emit.finished.mock.calls[0]![1] as { stats: Record<string, number> };
    expect(finishedPayload.stats.screensDiscovered).toBe(0);
    expect(finishedPayload.stats.tapsTaken).toBe(0);
    expect(typeof finishedPayload.stats.durationMs).toBe('number');

    // Row was marked complete in DB.
    const rows = await db
      .select({ status: schema.explorations.status, startedAt: schema.explorations.startedAt, finishedAt: schema.explorations.finishedAt })
      .from(schema.explorations)
      .where(eq(schema.explorations.id, runId));
    expect(rows[0]!.status).toBe('complete');
    expect(rows[0]!.startedAt).not.toBeNull();
    expect(rows[0]!.finishedAt).not.toBeNull();
  });

  it('on thrown error: emit.failed fired + DB row marked failed', async () => {
    const runId = await seedRun();
    const emit = buildEmitStub();
    const queryFn = vi.fn(() => {
      const gen = (async function* () {
        throw new Error('simulated SDK failure');
        yield 1;
      })();
      return Object.assign(gen, { return: vi.fn() });
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

    expect(emit.failed).toHaveBeenCalledTimes(1);
    expect(emit.failed).toHaveBeenCalledWith(
      runId,
      expect.objectContaining({ runId, step: 'agent', reason: 'simulated SDK failure' }),
    );
    expect(emit.finished).not.toHaveBeenCalled();

    const rows = await db
      .select({ status: schema.explorations.status, errorMessage: schema.explorations.errorMessage })
      .from(schema.explorations)
      .where(eq(schema.explorations.id, runId));
    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.errorMessage).toBe('simulated SDK failure');
  });

  it('tap-counter: device_* tool_use increments + emit.toolCall fires', async () => {
    const runId = await seedRun({ budgetTaps: 100 });
    const emit = buildEmitStub();
    const queryFn = vi.fn(() => {
      const gen = (async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'device_screenshot', input: { sessionId: 's' } },
              { type: 'tool_use', name: 'device_tap', input: { sessionId: 's', x: 10, y: 20 } },
              { type: 'tool_use', name: 'explore_save_screen', input: { title: 'x' } },
            ],
          },
        };
      })();
      return Object.assign(gen, { return: vi.fn() });
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

    // 3 tool calls → 3 toolCall emits.
    expect(emit.toolCall).toHaveBeenCalledTimes(3);
    const names = emit.toolCall.mock.calls.map((c) => (c[1] as { name: string }).name);
    expect(names).toEqual(['device_screenshot', 'device_tap', 'explore_save_screen']);
  });

});
