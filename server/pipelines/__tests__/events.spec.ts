/**
 * Phase 25 / Plan 25-01 — pipelines events registry + emit helpers spec (MOD-03).
 *
 * Proves:
 *   - PIPELINE_EVENT_NAMES shape (EVENTS-03 past-tense dotted)
 *   - pipelinesRegistry has 5 entries with correct aggregateType assignments
 *     (4×'pipeline-run', 1×'pipeline-schedule')
 *   - TRACE-08 persistence flags: 2 persisted (run.completed/run.failed),
 *     3 transient (run.started/stage.advanced/schedule.upserted)
 *   - PIPELINE_RUN_AGGREGATE_ID matches uuidv5('pipeline-run', URL_NS) at test time
 *     (single-source-of-truth check — catches stale literal drift)
 *   - 5 payload schemas accept valid + reject malformed samples
 *   - makePipelinesEmitters returns 5 typed helpers
 *   - emit.runStarted stamps envelope with ALS correlationId + aggregateType +
 *     aggregateId=runId
 *   - emit.scheduleUpserted stamps aggregateType='pipeline-schedule' +
 *     aggregateId=scheduleId (distinct aggregate from runs)
 *
 * NO DB required — uses TypedBus directly + in-memory onEmit capture.
 * Uses CANONICAL plain-object ALS store shape per Phase 20+ convention.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { v5 as uuidv5 } from 'uuid';
import { asyncLocalStorage } from '@fastify/request-context';

import { TypedBus } from '../../bus/bus.js';
import type { Envelope } from '../../events/envelope.js';
import {
  PIPELINE_EVENT_NAMES,
  PIPELINE_RUN_AGGREGATE_ID,
  PIPELINE_RUN_AGGREGATE_TYPE,
  PIPELINE_SCHEDULE_AGGREGATE_TYPE,
  pipelinesRegistry,
  makePipelinesEmitters,
  pipelineRunStartedPayload,
  pipelineStageAdvancedPayload,
  pipelineRunCompletedPayload,
  pipelineRunFailedPayload,
  pipelineScheduleUpsertedPayload,
} from '../events.js';

const URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

describe('Phase 25 — pipelines events (EVENTS-03 shape)', () => {
  it('PIPELINE_EVENT_NAMES has 5 dot-separated past-tense names with no duplicates', () => {
    const values = Object.values(PIPELINE_EVENT_NAMES);
    expect(values.length).toBe(5);
    expect(new Set(values).size).toBe(5);
    expect(values).toEqual([
      'pipeline.run.started',
      'pipeline.stage.advanced',
      'pipeline.run.completed',
      'pipeline.run.failed',
      'pipeline.schedule.upserted',
    ]);
    for (const name of values) {
      expect(name).toMatch(/^[a-z][a-z0-9._-]*\.[a-z][a-z0-9._-]*$/);
    }
  });

  it('pipelinesRegistry has 5 entries — 4 pipeline-run + 1 pipeline-schedule aggregateType', () => {
    const entries = Object.entries(pipelinesRegistry);
    expect(entries).toHaveLength(5);
    expect(pipelinesRegistry['pipeline.run.started'].aggregateType).toBe(PIPELINE_RUN_AGGREGATE_TYPE);
    expect(pipelinesRegistry['pipeline.stage.advanced'].aggregateType).toBe(PIPELINE_RUN_AGGREGATE_TYPE);
    expect(pipelinesRegistry['pipeline.run.completed'].aggregateType).toBe(PIPELINE_RUN_AGGREGATE_TYPE);
    expect(pipelinesRegistry['pipeline.run.failed'].aggregateType).toBe(PIPELINE_RUN_AGGREGATE_TYPE);
    expect(pipelinesRegistry['pipeline.schedule.upserted'].aggregateType).toBe(PIPELINE_SCHEDULE_AGGREGATE_TYPE);
  });

  it('[TRACE-08] terminal run events are persisted; transitional/schedule events are NOT', () => {
    expect(pipelinesRegistry['pipeline.run.completed'].persisted).toBe(true);
    expect(pipelinesRegistry['pipeline.run.failed'].persisted).toBe(true);
    expect(pipelinesRegistry['pipeline.run.started'].persisted).toBe(false);
    expect(pipelinesRegistry['pipeline.stage.advanced'].persisted).toBe(false);
    expect(pipelinesRegistry['pipeline.schedule.upserted'].persisted).toBe(false);
  });

  it('PIPELINE_RUN_AGGREGATE_ID matches uuidv5("pipeline-run", URL_NS) at test time', () => {
    const expected = uuidv5('pipeline-run', URL_NAMESPACE);
    expect(PIPELINE_RUN_AGGREGATE_ID).toBe(expected);
    // Must be a v5 UUID
    expect(PIPELINE_RUN_AGGREGATE_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('5 payload schemas accept valid + reject malformed samples', () => {
    const runId = randomUUID();
    const pipelineId = randomUUID();
    const scheduleId = randomUUID();

    // run.started
    expect(pipelineRunStartedPayload.safeParse({ runId, pipelineId, triggerType: 'api' }).success).toBe(true);
    expect(pipelineRunStartedPayload.safeParse({ runId, pipelineId, triggerType: 'schedule' }).success).toBe(true);
    expect(pipelineRunStartedPayload.safeParse({ runId, pipelineId, triggerType: 'manual' }).success).toBe(true);
    expect(pipelineRunStartedPayload.safeParse({ runId, pipelineId, triggerType: 'bogus' }).success).toBe(false);
    expect(pipelineRunStartedPayload.safeParse({ pipelineId, triggerType: 'api' }).success).toBe(false);

    // stage.advanced
    expect(pipelineStageAdvancedPayload.safeParse({ runId, stageIndex: 0, stageName: 's1', status: 'passed' }).success).toBe(true);
    expect(pipelineStageAdvancedPayload.safeParse({ runId, stageIndex: -1, stageName: 's1', status: 'passed' }).success).toBe(false);
    expect(pipelineStageAdvancedPayload.safeParse({ runId, stageIndex: 0, stageName: 's1', status: 'pending' }).success).toBe(false);

    // run.completed
    expect(pipelineRunCompletedPayload.safeParse({ runId, pipelineId, status: 'passed', durationMs: 1234 }).success).toBe(true);
    expect(pipelineRunCompletedPayload.safeParse({ runId, pipelineId, status: 'failed', durationMs: 0 }).success).toBe(true);
    expect(pipelineRunCompletedPayload.safeParse({ runId, pipelineId, status: 'cancelled', durationMs: 5 }).success).toBe(true);
    expect(pipelineRunCompletedPayload.safeParse({ runId, pipelineId, status: 'passed', durationMs: -1 }).success).toBe(false);
    expect(pipelineRunCompletedPayload.safeParse({ runId, pipelineId, status: 'bogus', durationMs: 0 }).success).toBe(false);

    // run.failed
    expect(pipelineRunFailedPayload.safeParse({ runId, pipelineId, reason: 'broken', failedStageIndex: 1 }).success).toBe(true);
    expect(pipelineRunFailedPayload.safeParse({ runId, pipelineId, reason: 'broken', failedStageIndex: null }).success).toBe(true);
    expect(pipelineRunFailedPayload.safeParse({ runId, pipelineId, reason: 'broken', failedStageIndex: -1 }).success).toBe(false);
    expect(pipelineRunFailedPayload.safeParse({ runId, pipelineId, reason: 42, failedStageIndex: null }).success).toBe(false);

    // schedule.upserted
    expect(pipelineScheduleUpsertedPayload.safeParse({ scheduleId, pipelineId, cron: '0 2 * * *' }).success).toBe(true);
    expect(pipelineScheduleUpsertedPayload.safeParse({ pipelineId, cron: '0 2 * * *' }).success).toBe(false);
  });

  it('makePipelinesEmitters returns exactly 5 typed helpers', () => {
    const bus = new TypedBus(pipelinesRegistry);
    const emit = makePipelinesEmitters(bus);
    expect(Object.keys(emit)).toEqual([
      'runStarted',
      'stageAdvanced',
      'runCompleted',
      'runFailed',
      'scheduleUpserted',
    ]);
    expect(typeof emit.runStarted).toBe('function');
    expect(typeof emit.stageAdvanced).toBe('function');
    expect(typeof emit.runCompleted).toBe('function');
    expect(typeof emit.runFailed).toBe('function');
    expect(typeof emit.scheduleUpserted).toBe('function');
  });

  it('emit.runStarted stamps envelope with ALS correlationId + aggregateType=pipeline-run + aggregateId=runId', async () => {
    const bus = new TypedBus(pipelinesRegistry);
    const captured: Envelope[] = [];
    const emit = makePipelinesEmitters(bus, (env) => captured.push(env));

    const cid = randomUUID();
    const runId = randomUUID();
    const pipelineId = randomUUID();

    await asyncLocalStorage.run(
      { correlationId: cid, currentEventId: null, actor: 'test' } as never,
      async () => {
        const envelope = emit.runStarted(runId, { runId, pipelineId, triggerType: 'api' });
        expect(envelope.correlationId).toBe(cid);
        expect(envelope.type).toBe('pipeline.run.started');
        expect(envelope.aggregateType).toBe('pipeline-run');
        expect(envelope.aggregateId).toBe(runId);
        expect(envelope.v).toBe(1);
      },
    );

    expect(captured).toHaveLength(1);
    expect(captured[0].correlationId).toBe(cid);
  });

  it('emit.scheduleUpserted stamps aggregateType=pipeline-schedule + aggregateId=scheduleId (distinct aggregate)', async () => {
    const bus = new TypedBus(pipelinesRegistry);
    const captured: Envelope[] = [];
    const emit = makePipelinesEmitters(bus, (env) => captured.push(env));

    const cid = randomUUID();
    const scheduleId = randomUUID();
    const pipelineId = randomUUID();

    await asyncLocalStorage.run(
      { correlationId: cid, currentEventId: null, actor: 'scheduler' } as never,
      async () => {
        const envelope = emit.scheduleUpserted(scheduleId, {
          scheduleId,
          pipelineId,
          cron: '0 2 * * *',
        });
        expect(envelope.aggregateType).toBe('pipeline-schedule');
        expect(envelope.aggregateId).toBe(scheduleId);
        expect(envelope.type).toBe('pipeline.schedule.upserted');
      },
    );

    expect(captured).toHaveLength(1);
  });
});
