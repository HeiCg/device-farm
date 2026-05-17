/**
 * Tests for the PR-commenter event-bus subscriber wiring (Critical Issue #6).
 *
 * Validates that for every pipeline-run event emitted on the pipelines bus,
 * the commenter.upsert is called with the correct status — and that non-PR-bot
 * runs (azurePrIntegrationId = null) are silently skipped.
 *
 * Strategy: construct a real TypedBus<PipelinesRegistry> and a minimal fake DB
 * that returns controlled pipelineRuns rows. Wire the subscriber logic extracted
 * from plugin.ts into the bus, then emit events and assert commenter.upsert
 * call counts + arguments.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TypedBus } from '../../bus/bus.js';
import {
  pipelinesRegistry,
  makePipelinesEmitters,
  PIPELINE_EVENT_NAMES,
} from '../../pipelines/events.js';
import type { PrCommenter } from '../internal/pr-commenter.js';
import type { RunStatus } from '../internal/pr-commenter.js';

// Stable UUIDs used across tests (real UUIDs to satisfy envelopeSchema.aggregateId validation)
const RUN_UUID    = '11111111-1111-4111-8111-111111111111';
const RUN_UUID_2  = '22222222-2222-4222-8222-222222222222';
const RUN_UUID_3  = '33333333-3333-4333-8333-333333333333';
const RUN_UUID_X  = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PIPE_UUID   = '55555555-5555-4555-8555-555555555555';

const fakeLogger: any = {
  info: () => {},
  error: () => {},
  warn: () => {},
  child: () => fakeLogger,
};

// ---------------------------------------------------------------------------
// Helpers to build the subscriber logic (mirrors plugin.ts — keep in sync)
// ---------------------------------------------------------------------------

interface FakeRunRow {
  azurePrId: string | null;
  azurePrIntegrationId: string | null;
  sourceCommit: string | null;
  startedAt: Date | null;
  variables: Record<string, unknown> | null;
}

/**
 * Wire the commenter subscriber onto the bus using the same logic as plugin.ts.
 * Returns an object with the emit helpers so tests can fire events.
 */
function wireSubscriber(
  bus: TypedBus<typeof pipelinesRegistry>,
  commenter: PrCommenter,
  getRunRow: (runId: string) => FakeRunRow | null,
) {
  async function loadPrRunContext(runId: string) {
    const row = getRunRow(runId);
    if (!row) return null;
    if (!row.azurePrIntegrationId || !row.azurePrId) return null;

    const vars = (row.variables ?? {}) as Record<string, unknown>;
    const repoId    = typeof vars.__azureRepoId    === 'string' ? vars.__azureRepoId    : '';
    const projectId = typeof vars.__azureProjectId === 'string' ? vars.__azureProjectId : '';
    const suites    = Array.isArray(vars.__azureSuites)
      ? (vars.__azureSuites as unknown[]).filter((s): s is string => typeof s === 'string')
      : [];

    if (!repoId) return null;

    return {
      prId:      Number(row.azurePrId),
      repoId,
      projectId,
      suites,
      commit:    row.sourceCommit ?? '',
      startedAt: row.startedAt ?? new Date(),
    };
  }

  async function upsertComment(runId: string, status: RunStatus) {
    const ctx = await loadPrRunContext(runId);
    if (!ctx) return;
    await commenter.upsert({ ...ctx, runId, status });
  }

  bus.on(PIPELINE_EVENT_NAMES.RUN_STARTED, (payload) => {
    void upsertComment(payload.runId, 'running');
  });

  bus.on(PIPELINE_EVENT_NAMES.RUN_COMPLETED, (payload) => {
    const status: RunStatus = payload.status === 'passed' ? 'passed'
      : payload.status === 'cancelled' ? 'cancelled'
      : 'failed';
    void upsertComment(payload.runId, status);
  });

  bus.on(PIPELINE_EVENT_NAMES.RUN_FAILED, (payload) => {
    const status: RunStatus = payload.reason === 'cancelled' ? 'cancelled' : 'failed';
    void upsertComment(payload.runId, status);
  });
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makePrRow(overrides: Partial<FakeRunRow> = {}): FakeRunRow {
  return {
    azurePrId: '42',
    azurePrIntegrationId: 'integration-1',
    sourceCommit: 'abc1234567890',
    startedAt: new Date('2026-01-01T00:00:00Z'),
    variables: {
      __azureRepoId:    'repo-uuid',
      __azureProjectId: 'proj-uuid',
      __azureSuites:    ['A', 'B'],
    },
    ...overrides,
  };
}

function makeNonPrRow(): FakeRunRow {
  return {
    azurePrId: null,
    azurePrIntegrationId: null,
    sourceCommit: 'abc',
    startedAt: new Date(),
    variables: {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PR-commenter bus subscriber wiring', () => {
  let bus: TypedBus<typeof pipelinesRegistry>;
  let emit: ReturnType<typeof makePipelinesEmitters>;
  let upsertSpy: ReturnType<typeof vi.fn>;
  let commenter: PrCommenter;

  beforeEach(() => {
    bus = new TypedBus(pipelinesRegistry);
    emit = makePipelinesEmitters(bus);
    upsertSpy = vi.fn().mockResolvedValue(undefined);
    commenter = { upsert: upsertSpy };
  });

  it('calls commenter.upsert with status=running on pipeline.run.started', async () => {
    const row = makePrRow();
    wireSubscriber(bus, commenter, () => row);

    emit.runStarted(RUN_UUID, { runId: RUN_UUID, pipelineId: PIPE_UUID, triggerType: 'azure-pr' });

    // Subscriber is async (void) — flush microtasks
    await new Promise((r) => setTimeout(r, 10));

    expect(upsertSpy).toHaveBeenCalledOnce();
    expect(upsertSpy).toHaveBeenCalledWith(expect.objectContaining({
      status: 'running',
      runId: RUN_UUID,
      prId: 42,
      repoId: 'repo-uuid',
      projectId: 'proj-uuid',
      suites: ['A', 'B'],
    }));
  });

  it('calls commenter.upsert with status=passed on pipeline.run.completed (status=passed)', async () => {
    const row = makePrRow();
    wireSubscriber(bus, commenter, () => row);

    emit.runCompleted(RUN_UUID, { runId: RUN_UUID, pipelineId: PIPE_UUID, status: 'passed', durationMs: 1000 });
    await new Promise((r) => setTimeout(r, 10));

    expect(upsertSpy).toHaveBeenCalledOnce();
    expect(upsertSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'passed', runId: RUN_UUID }));
  });

  it('calls commenter.upsert with status=failed on pipeline.run.completed (status=failed)', async () => {
    const row = makePrRow();
    wireSubscriber(bus, commenter, () => row);

    emit.runCompleted(RUN_UUID, { runId: RUN_UUID, pipelineId: PIPE_UUID, status: 'failed', durationMs: 500 });
    await new Promise((r) => setTimeout(r, 10));

    expect(upsertSpy).toHaveBeenCalledOnce();
    expect(upsertSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', runId: RUN_UUID }));
  });

  it('calls commenter.upsert with status=cancelled on pipeline.run.completed (status=cancelled)', async () => {
    const row = makePrRow();
    wireSubscriber(bus, commenter, () => row);

    emit.runCompleted(RUN_UUID, { runId: RUN_UUID, pipelineId: PIPE_UUID, status: 'cancelled', durationMs: 0 });
    await new Promise((r) => setTimeout(r, 10));

    expect(upsertSpy).toHaveBeenCalledOnce();
    expect(upsertSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
  });

  it('calls commenter.upsert with status=failed on pipeline.run.failed', async () => {
    const row = makePrRow();
    wireSubscriber(bus, commenter, () => row);

    emit.runFailed(RUN_UUID, { runId: RUN_UUID, pipelineId: PIPE_UUID, reason: 'stage 2 failed', failedStageIndex: 1 });
    await new Promise((r) => setTimeout(r, 10));

    expect(upsertSpy).toHaveBeenCalledOnce();
    expect(upsertSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });

  it('calls commenter.upsert with status=cancelled on pipeline.run.failed when reason=cancelled', async () => {
    const row = makePrRow();
    wireSubscriber(bus, commenter, () => row);

    emit.runFailed(RUN_UUID, { runId: RUN_UUID, pipelineId: PIPE_UUID, reason: 'cancelled', failedStageIndex: null });
    await new Promise((r) => setTimeout(r, 10));

    expect(upsertSpy).toHaveBeenCalledOnce();
    expect(upsertSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
  });

  it('skips commenter.upsert when azurePrIntegrationId is null (non-PR-bot run)', async () => {
    wireSubscriber(bus, commenter, () => makeNonPrRow());

    emit.runStarted(RUN_UUID_2, { runId: RUN_UUID_2, pipelineId: PIPE_UUID, triggerType: 'api' });
    await new Promise((r) => setTimeout(r, 10));

    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it('skips commenter.upsert when __azureRepoId is missing from variables', async () => {
    const row = makePrRow({ variables: { __azureProjectId: 'proj', __azureSuites: ['A'] } });
    wireSubscriber(bus, commenter, () => row);

    emit.runStarted(RUN_UUID_3, { runId: RUN_UUID_3, pipelineId: PIPE_UUID, triggerType: 'azure-pr' });
    await new Promise((r) => setTimeout(r, 10));

    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it('skips commenter.upsert when run row is not found in DB', async () => {
    wireSubscriber(bus, commenter, () => null);

    emit.runStarted(RUN_UUID_X, { runId: RUN_UUID_X, pipelineId: PIPE_UUID, triggerType: 'azure-pr' });
    await new Promise((r) => setTimeout(r, 10));

    expect(upsertSpy).not.toHaveBeenCalled();
  });
});
