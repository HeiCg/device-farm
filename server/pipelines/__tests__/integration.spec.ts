/**
 * Phase 25 Plan 25-05 — DEFERRED-25-H (Pitfall 7 cost-balloon fallback).
 *
 * The body below was authored against the LEGACY synchronous `executeRun`
 * semantics (PipelineService held a local Promise chain that resolved when
 * every stage finished). Phase 25 Plan 25-03 deleted that Promise chain and
 * Plan 25-04 proved the new bus-driven flow via subscriber.spec.ts +
 * correlation.spec.ts (DB-gated, vi.waitFor against pipeline.run.completed).
 *
 * Under the new flow, `service.triggerRun(...)` returns the runId immediately
 * and stage advancement is driven by the `job.completed` bus subscriber. The
 * mock-DB harness below cannot exercise that path (no real pg-boss + no real
 * jobs module), so the original assertions on `setTimeout(..., 3000)` →
 * broadcaster events would deadlock or assert on never-fired emissions.
 *
 * PATH B (skip-with-TODO) selected per Plan 25-05 Task 5.2 alternatives —
 * Phase 30 Test Migration Cleanup owns the rewrite to a tests-as-spec
 * harness that mirrors subscriber.spec.ts shape (DB-gated `vi.waitFor`
 * against bus events). See `.planning/phases/25-pipelines-module/deferred-items.md`
 * DEFERRED-25-H for the closure plan.
 *
 * MOD-04 (.test → .spec rename) is HONORED — file structure preserved,
 * only the it() bodies are wrapped in it.skip. Keeps `find … -name '*.test.ts'`
 * at 0 for the pipelines module.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineService } from '../internal/service.js';
import { PipelineBroadcaster } from '../internal/broadcaster.js';

function createLogger() {
  return {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as any;
}

/**
 * In-memory mock DB that stores records and returns them.
 * Good enough for integration testing without a real PostgreSQL.
 */
function createMockDb() {
  let nextSelectResult: any[] = [];

  return {
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation((row: any) => ({
        returning: vi.fn().mockImplementation(async () => {
          const id = `id-${Math.random().toString(36).slice(2, 10)}`;
          const record = { id, ...row };
          return [record];
        }),
      })),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    })),
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockImplementation(async () => nextSelectResult),
        orderBy: vi.fn().mockImplementation(() => ({
          limit: vi.fn().mockResolvedValue([]),
        })),
      })),
    })),
    delete: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockResolvedValue([]),
    })),
    _setNextSelect(rows: any[]) {
      nextSelectResult = rows;
    },
  } as any;
}

const TEST_YAML = `
name: "integration-test"
variables:
  GREETING: hello
stages:
  - name: setup
    script: echo "{{GREETING}} world"
    timeout: 10
  - name: verify
    script: echo "all good"
  - name: teardown
    script: echo "cleaning up"
    when: always
`;

describe('Pipeline Integration', () => {
  let db: ReturnType<typeof createMockDb>;
  let broadcaster: PipelineBroadcaster;
  let service: PipelineService;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    broadcaster = new PipelineBroadcaster();
    service = new PipelineService(db, createLogger(), broadcaster);
  });

  // TODO(DEFERRED-25-H — Phase 30): rewrite against bus-driven flow + DB-gated harness.
  it.skip('executes a multi-stage pipeline and emits broadcast events', async () => {
    const emitSpy = vi.spyOn(broadcaster, 'emit');

    // Create pipeline
    const pipeline = await service.createPipeline(TEST_YAML);
    expect(pipeline.name).toBe('integration-test');

    // Set up mock DB to return the pipeline when queried
    db._setNextSelect([{
      id: pipeline.id,
      name: 'integration-test',
      yamlContent: TEST_YAML,
    }]);

    // Trigger run
    const runId = await service.triggerRun(pipeline.id, 'manual', { GREETING: 'hola' });
    expect(runId).toBeDefined();

    // Wait for async execution to complete (scripts are fast)
    await new Promise(r => setTimeout(r, 3000));

    // Verify broadcast events
    const events = emitSpy.mock.calls.map(c => c[1]);
    const eventTypes = events.map(e => e.type);

    // Should have stage_start and stage_end for each of the 3 stages
    expect(eventTypes.filter(t => t === 'stage_start')).toHaveLength(3);
    expect(eventTypes.filter(t => t === 'stage_end')).toHaveLength(3);

    // Should have run_end
    expect(eventTypes).toContain('run_end');

    // run_end should have status 'passed'
    const runEnd = events.find(e => e.type === 'run_end');
    expect(runEnd?.data.status).toBe('passed');

    // Should have stage_log events with variable interpolation
    const logEvents = events.filter(e => e.type === 'stage_log');
    const logLines = logEvents.map(e => e.data.line);
    expect(logLines.some(l => (l as string).includes('hola'))).toBe(true);

    // DB should have been called to insert stage runs
    expect(db.insert).toHaveBeenCalled();
    expect(db.update).toHaveBeenCalled();
  }, 10_000);

  // TODO(DEFERRED-25-H — Phase 30): rewrite against bus-driven flow + DB-gated harness.
  it.skip('handles failing stages and still runs when:always stages', async () => {
    const failYaml = `
name: "fail-test"
stages:
  - name: will-fail
    script: exit 1
    timeout: 5
  - name: should-skip
    script: echo "skipped"
    when: success
  - name: always-runs
    script: echo "cleanup"
    when: always
`;

    const emitSpy = vi.spyOn(broadcaster, 'emit');

    const pipeline = await service.createPipeline(failYaml);
    db._setNextSelect([{
      id: pipeline.id,
      name: 'fail-test',
      yamlContent: failYaml,
    }]);

    const runId = await service.triggerRun(pipeline.id, 'manual', {});
    await new Promise(r => setTimeout(r, 3000));

    const events = emitSpy.mock.calls.map(c => c[1]);

    // run_end should be 'failed'
    const runEnd = events.find(e => e.type === 'run_end');
    expect(runEnd?.data.status).toBe('failed');

    // 'should-skip' stage should be skipped (stage_end with status 'skipped')
    const stageEnds = events.filter(e => e.type === 'stage_end');
    const skippedStage = stageEnds.find(e => e.data.stage === 'should-skip');
    expect(skippedStage?.data.status).toBe('skipped');

    // 'always-runs' should have executed (stage_end with status 'passed')
    const alwaysStage = stageEnds.find(e => e.data.stage === 'always-runs');
    expect(alwaysStage?.data.status).toBe('passed');
  }, 10_000);
});
