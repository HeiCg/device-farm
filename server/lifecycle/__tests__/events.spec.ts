/**
 * Phase 18 / Plan 18-01 — events.ts spec (MOD-03 + TRACE-04 + TRACE-08).
 *
 * Proves:
 *   - lifecycleRegistry has exactly 4 entries, all persisted:true, aggregateType:'lifecycle'.
 *   - makeLifecycleEmitters returns 4 typed helpers; each stamps a valid Envelope.
 *   - createEventHelpers reads correlationId from ALS (Map-shape store — same shape
 *     the pg-boss worker fiber hits after plan 15-05's queue.work ALS restore).
 *   - Payload schemas parse valid input and reject invalid.
 *
 * No database required — pure unit spec.
 */
import { describe, it, expect } from 'vitest';
import { asyncLocalStorage } from '@fastify/request-context';
import { randomUUID } from 'node:crypto';

import {
  lifecycleRegistry,
  makeLifecycleEmitters,
  LIFECYCLE_EVENT_NAMES,
  LIFECYCLE_AGGREGATE_ID,
  compressionCompletedPayload,
  taskFailedPayload,
} from '../events.js';
import { TypedBus } from '../../bus/bus.js';
import type { Envelope } from '../../events/envelope.js';

describe('lifecycle events (Phase 18-01)', () => {
  describe('lifecycleRegistry [MOD-03, TRACE-08]', () => {
    it('has all 4 event entries', () => {
      const names = Object.keys(lifecycleRegistry);
      expect(names).toContain(LIFECYCLE_EVENT_NAMES.COMPRESSION_COMPLETED);
      expect(names).toContain(LIFECYCLE_EVENT_NAMES.RETENTION_COMPLETED);
      expect(names).toContain(LIFECYCLE_EVENT_NAMES.DISK_CHECKED);
      expect(names).toContain(LIFECYCLE_EVENT_NAMES.TASK_FAILED);
      expect(names).toHaveLength(4);
    });

    it('marks ALL 4 events as persisted (terminal operational telemetry per TRACE-08)', () => {
      expect(lifecycleRegistry[LIFECYCLE_EVENT_NAMES.COMPRESSION_COMPLETED].persisted).toBe(true);
      expect(lifecycleRegistry[LIFECYCLE_EVENT_NAMES.RETENTION_COMPLETED].persisted).toBe(true);
      expect(lifecycleRegistry[LIFECYCLE_EVENT_NAMES.DISK_CHECKED].persisted).toBe(true);
      expect(lifecycleRegistry[LIFECYCLE_EVENT_NAMES.TASK_FAILED].persisted).toBe(true);
    });

    it('all 4 entries have aggregateType: lifecycle', () => {
      for (const name of Object.values(LIFECYCLE_EVENT_NAMES)) {
        expect(lifecycleRegistry[name].aggregateType).toBe('lifecycle');
      }
    });
  });

  describe('makeLifecycleEmitters [MOD-03]', () => {
    it('returns {compressionCompleted, retentionCompleted, diskChecked, taskFailed}', () => {
      const bus = new TypedBus(lifecycleRegistry);
      const emit = makeLifecycleEmitters(bus);
      expect(typeof emit.compressionCompleted).toBe('function');
      expect(typeof emit.retentionCompleted).toBe('function');
      expect(typeof emit.diskChecked).toBe('function');
      expect(typeof emit.taskFailed).toBe('function');
    });

    it('emit.compressionCompleted stamps envelope with aggregateType=lifecycle, type=lifecycle.compression.completed, v=1', () => {
      const bus = new TypedBus(lifecycleRegistry);
      const captured: Envelope[] = [];
      const emit = makeLifecycleEmitters(bus, (env) => captured.push(env));

      emit.compressionCompleted(LIFECYCLE_AGGREGATE_ID, {
        compressed: 3,
        savedBytes: 123456,
        durationMs: 2500,
      });

      expect(captured).toHaveLength(1);
      const env = captured[0];
      expect(env.type).toBe('lifecycle.compression.completed');
      expect(env.aggregateType).toBe('lifecycle');
      expect(env.v).toBe(1);
      expect(env.aggregateId).toBe(LIFECYCLE_AGGREGATE_ID);
      expect(env.actor).toBeTruthy();
      expect(typeof env.correlationId).toBe('string');
      expect(env.correlationId.length).toBeGreaterThan(0);
    });
  });

  describe('createEventHelpers ALS integration [TRACE-04]', () => {
    it('reads correlationId from AsyncLocalStorage when present (Map-shape store)', () => {
      // Map-shape ALS store — matches the pg-boss worker fiber shape (plan 15-05
      // queue.work stores OBJECT but readAls in server/bus/helpers.ts is
      // shape-agnostic; canonical test pattern at
      // server/events/__tests__/emit-helpers.spec.ts:32 uses Map).
      const bus = new TypedBus(lifecycleRegistry);
      const captured: Envelope[] = [];
      const emit = makeLifecycleEmitters(bus, (env) => captured.push(env));
      const correlationId = randomUUID();

      asyncLocalStorage.run(new Map([['correlationId', correlationId]]) as never, () => {
        emit.diskChecked(LIFECYCLE_AGGREGATE_ID, {
          currentUsageBytes: 10,
          maxBytes: 100,
          deleted: 0,
          freedBytes: 0,
          durationMs: 50,
        });
      });

      expect(captured).toHaveLength(1);
      expect(captured[0].correlationId).toBe(correlationId);
    });
  });

  describe('lifecycle payload schemas [SPEC-03]', () => {
    it('compressionCompletedPayload accepts valid input', () => {
      const result = compressionCompletedPayload.safeParse({
        compressed: 3,
        savedBytes: 123456,
        durationMs: 2500,
      });
      expect(result.success).toBe(true);
    });

    it('taskFailedPayload rejects invalid task enum', () => {
      const result = taskFailedPayload.safeParse({
        task: 'bogus',
        error: 'x',
        durationMs: 0,
      });
      expect(result.success).toBe(false);
    });

    it('taskFailedPayload accepts all 3 legal task values', () => {
      for (const task of ['compression', 'retention', 'disk-pressure'] as const) {
        const result = taskFailedPayload.safeParse({ task, error: 'e', durationMs: 10 });
        expect(result.success).toBe(true);
      }
    });
  });
});
