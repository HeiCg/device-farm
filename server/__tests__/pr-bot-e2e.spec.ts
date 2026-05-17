/**
 * PR-bot end-to-end integration spec (Task 20).
 *
 * Scope: full request → auth → webhook-handler → pr-run-service chain.
 * Unlike existing unit tests (routes.spec.ts, webhook-handler.spec.ts,
 * pr-run-service.spec.ts) which stub one level below, this spec wires
 * ALL azure internal modules together:
 *
 *   HTTP POST /api/azure/pr-events
 *     → BasicAuth check (registerAzureRoutes)
 *     → createWebhookHandler.handle()
 *     → createPrRunService.triggerRun()
 *     → upsertPipeline / cancelRunsByPrId / createRun (mock boundary)
 *
 * Azure REST calls (createThread) go through a fetchImpl mock injected into
 * createAzureClient — no globalThis.fetch override needed (client supports
 * the fetchImpl option: see azure-client.ts line 28).
 *
 * The test does NOT boot the full Fastify plugin chain (config, db, pool,
 * pipelines) because that chain requires a live PostgreSQL connection and
 * Android toolchain. Scaffolding for the full chain is tracked as a
 * follow-up when DB/pool mocking patterns mature (DEFERRED-20-A).
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAzureRoutes } from '../azure/routes.js';
import { createWebhookHandler } from '../azure/internal/webhook-handler.js';
import { createPrRunService } from '../azure/internal/pr-run-service.js';
import { createAzureClient } from '../azure/internal/azure-client.js';
import { createPrCommenter } from '../azure/internal/pr-commenter.js';

// ─── Fake logger (same pattern as routes.spec.ts + webhook-handler.spec.ts) ─

const fakeLogger: any = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: function () { return this; },
};

// ─── Azure REST call recorder ─────────────────────────────────────────────────

interface RecordedCall {
  kind: 'createThread' | 'updateComment';
  body: string;
  prId: string;
}
const azureCalls: RecordedCall[] = [];

/**
 * Mock fetchImpl injected into createAzureClient.
 * Intercepts createThread (POST .../threads) and updateComment (PATCH .../comments/...).
 */
function mockFetch(url: string, init?: RequestInit): Promise<Response> {
  const u = String(url);
  if (u.includes('/threads') && init?.method === 'POST') {
    const payload = JSON.parse(init.body as string);
    azureCalls.push({
      kind: 'createThread',
      body: payload.comments[0].content,
      prId: u.match(/pullrequests\/(\d+)\/threads/)?.[1] ?? '',
    });
    return Promise.resolve(
      new Response(JSON.stringify({ id: 1001, comments: [{ id: 2001 }] }), { status: 200 }),
    );
  }
  if (u.includes('/comments/') && init?.method === 'PATCH') {
    const payload = JSON.parse(init.body as string);
    const prId = u.match(/pullrequests\/(\d+)\/threads/)?.[1] ?? '';
    azureCalls.push({ kind: 'updateComment', body: payload.content, prId });
    return Promise.resolve(new Response('{}', { status: 200 }));
  }
  return Promise.resolve(new Response('{"error":"unexpected call"}', { status: 400 }));
}

// ─── PR service mocks ─────────────────────────────────────────────────────────

const upsertPipeline = vi.fn().mockResolvedValue({ id: 'pipe-uuid-1' });
const cancelRunsByPrId = vi.fn().mockResolvedValue(0);
const createRun = vi.fn().mockResolvedValue({ runId: 'run-uuid-1' });

// ─── Integration config (mirrors what config.yaml would provide) ──────────────

const INTEGRATION = {
  id: 'trampo',
  repo_url: 'https://dev.azure.com/o/p/_git/r',
  target_branch: 'main',
};

const BASIC_AUTH = { username: 'u', password: 'p' };

// ─── Well-formed webhook payload ──────────────────────────────────────────────

const WEBHOOK_BODY = {
  eventType: 'git.pullrequest.created',
  resource: {
    pullRequestId: 99,
    status: 'active',
    isDraft: false,
    sourceRefName: 'refs/heads/feat/e2e-test',
    targetRefName: 'refs/heads/main',
    lastMergeSourceCommit: { commitId: 'aaa1111bbb2222' },
    description: [
      '```device-script',
      'url: https://app.example/dl/app.apk',
      'account: name_1',
      'platform: android',
      'suite: Smoke',
      '```',
    ].join('\n'),
    repository: {
      url: 'https://dev.azure.com/o/p/_git/r',
      id: 'repo-uuid-abc',
      project: { id: 'proj-uuid-def', name: 'p' },
    },
  },
};

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('PR-bot end-to-end (module integration)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.clearAllMocks();
    azureCalls.length = 0;

    // Build the azure client with the fetch mock (no globalThis.fetch override needed).
    const client = createAzureClient({
      pat: 'test-pat',
      logger: fakeLogger,
      fetchImpl: mockFetch as any,
    });

    // Build the commenter — in-memory comment ref store.
    const commentRefStore = new Map<string, { threadId: string; commentId: string }>();
    const commenter = createPrCommenter({
      client,
      lookupCommentRef: async (prId) => commentRefStore.get(prId) ?? null,
      saveCommentRef: async (prId, ref) => { commentRefStore.set(prId, ref); },
      baseUrl: 'http://localhost:3000',
      logger: fakeLogger,
    });

    // Build the pr-run service wired to mock boundaries.
    const prRunService = createPrRunService({
      config: { pat: 'test-pat' },
      upsertPipeline,
      cancelRunsByPrId,
      createRun,
      logger: fakeLogger,
    });

    // Build the webhook handler.
    const handler = createWebhookHandler({
      integrations: [INTEGRATION],
      triggerRun: (req) => prRunService.triggerRun(req),
      postParseError: async ({ organization, project, repoId, projectId, prId, issues }) => {
        const body = `### Device Farm — ⚠️\n\nCould not parse \`device-script\` block:\n\n\`\`\`json\n${JSON.stringify(issues, null, 2)}\n\`\`\``;
        await client.createThread(organization, project, repoId, prId, body);
      },
      logger: fakeLogger,
    });

    // Register the routes on a minimal Fastify instance.
    app = Fastify({ logger: false });
    registerAzureRoutes(app, {
      basicAuth: BASIC_AUTH,
      handler,
      logger: fakeLogger,
    });

    await app.ready();
    void commenter; // commenter is wired — not called in this test (no run completion event)
  });

  afterAll(async () => {
    await app?.close();
    vi.clearAllMocks();
    azureCalls.length = 0;
  });

  // ── Auth guard tests (inherited from routes level, re-verified at module level) ──

  it('returns 401 when Authorization header is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/azure/pr-events',
      payload: WEBHOOK_BODY,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when Basic credentials are wrong', async () => {
    const auth = 'Basic ' + Buffer.from('u:wrong').toString('base64');
    const res = await app.inject({
      method: 'POST',
      url: '/api/azure/pr-events',
      headers: { authorization: auth },
      payload: WEBHOOK_BODY,
    });
    expect(res.statusCode).toBe(401);
  });

  // ── Happy path: full HTTP → handler → prRunService chain ──────────────────

  it('dispatches a pipeline run for a well-formed PR webhook (full chain)', async () => {
    vi.clearAllMocks();
    azureCalls.length = 0;
    upsertPipeline.mockResolvedValue({ id: 'pipe-uuid-1' });
    cancelRunsByPrId.mockResolvedValue(0);
    createRun.mockResolvedValue({ runId: 'run-uuid-1' });

    const auth = 'Basic ' + Buffer.from('u:p').toString('base64');
    const res = await app.inject({
      method: 'POST',
      url: '/api/azure/pr-events',
      headers: { authorization: auth },
      payload: WEBHOOK_BODY,
    });

    expect(res.statusCode).toBe(200);
    const outcome = res.json<{ kind: string; runId: string }>();
    expect(outcome.kind).toBe('dispatched');
    expect(outcome.runId).toBe('run-uuid-1');

    // pr-run service was called at the correct boundaries:
    expect(upsertPipeline).toHaveBeenCalledOnce();
    expect(upsertPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'pr-trampo-99' }),
    );
    expect(cancelRunsByPrId).toHaveBeenCalledOnce();
    expect(cancelRunsByPrId).toHaveBeenCalledWith('99', 'cancelled: new push to PR');
    expect(createRun).toHaveBeenCalledOnce();
    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineId: 'pipe-uuid-1',
        prId: '99',
        triggerType: 'azure-pr',
        integrationId: 'trampo',
        sourceBranch: 'feat/e2e-test',
        sourceCommit: 'aaa1111bbb2222',
      }),
    );
  });

  // ── Skipped events (handler logic, verified at module level) ──────────────

  it('returns 200/skipped for draft PRs without calling prRunService', async () => {
    vi.clearAllMocks();
    const auth = 'Basic ' + Buffer.from('u:p').toString('base64');
    const draftBody = {
      ...WEBHOOK_BODY,
      resource: { ...WEBHOOK_BODY.resource, isDraft: true },
    };
    const res = await app.inject({
      method: 'POST',
      url: '/api/azure/pr-events',
      headers: { authorization: auth },
      payload: draftBody,
    });
    expect(res.statusCode).toBe(200);
    const outcome = res.json<{ kind: string; reason: string }>();
    expect(outcome.kind).toBe('skipped');
    expect(outcome.reason).toMatch(/draft/i);
    expect(createRun).not.toHaveBeenCalled();
  });

  it('returns 200/skipped for PRs targeting an unregistered branch', async () => {
    vi.clearAllMocks();
    const auth = 'Basic ' + Buffer.from('u:p').toString('base64');
    const wrongBranchBody = {
      ...WEBHOOK_BODY,
      resource: {
        ...WEBHOOK_BODY.resource,
        targetRefName: 'refs/heads/develop',
      },
    };
    const res = await app.inject({
      method: 'POST',
      url: '/api/azure/pr-events',
      headers: { authorization: auth },
      payload: wrongBranchBody,
    });
    expect(res.statusCode).toBe(200);
    const outcome = res.json<{ kind: string; reason: string }>();
    expect(outcome.kind).toBe('skipped');
    expect(createRun).not.toHaveBeenCalled();
  });

  // ── Parse error path: fetch mock records the Azure createThread call ──────

  it('calls Azure createThread (via fetch mock) when device-script block is malformed', async () => {
    vi.clearAllMocks();
    azureCalls.length = 0;

    const auth = 'Basic ' + Buffer.from('u:p').toString('base64');
    const malformedBody = {
      ...WEBHOOK_BODY,
      resource: {
        ...WEBHOOK_BODY.resource,
        description: '```device-script\nurl: not-a-url\naccount: a\nplatform: android\nsuite: A\n```',
      },
    };
    const res = await app.inject({
      method: 'POST',
      url: '/api/azure/pr-events',
      headers: { authorization: auth },
      payload: malformedBody,
    });

    expect(res.statusCode).toBe(200);
    const outcome = res.json<{ kind: string }>();
    expect(outcome.kind).toBe('parse-error');

    // The azure client's createThread was called through the fetch mock.
    expect(azureCalls).toHaveLength(1);
    expect(azureCalls[0].kind).toBe('createThread');
    expect(azureCalls[0].prId).toBe('99');
    expect(azureCalls[0].body).toContain('device-script');
    expect(createRun).not.toHaveBeenCalled();
  });

  // ── Concurrency dedup: duplicate trigger collapses to one run ─────────────

  it('collapses concurrent duplicate PR triggers into a single run (in-flight dedup)', async () => {
    vi.clearAllMocks();
    upsertPipeline.mockResolvedValue({ id: 'pipe-dedup' });
    cancelRunsByPrId.mockResolvedValue(0);
    // Delay createRun slightly to exercise the in-flight guard.
    createRun.mockImplementation(
      () => new Promise<{ runId: string }>(r => setTimeout(() => r({ runId: 'run-dedup' }), 10)),
    );

    const auth = 'Basic ' + Buffer.from('u:p').toString('base64');
    const [res1, res2] = await Promise.all([
      app.inject({
        method: 'POST', url: '/api/azure/pr-events',
        headers: { authorization: auth }, payload: WEBHOOK_BODY,
      }),
      app.inject({
        method: 'POST', url: '/api/azure/pr-events',
        headers: { authorization: auth }, payload: WEBHOOK_BODY,
      }),
    ]);

    // Both requests should succeed.
    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    expect(res1.json<{ kind: string; runId: string }>().kind).toBe('dispatched');
    expect(res2.json<{ kind: string; runId: string }>().kind).toBe('dispatched');

    // createRun called exactly once (in-flight dedup fired).
    expect(createRun).toHaveBeenCalledOnce();
  });
});
