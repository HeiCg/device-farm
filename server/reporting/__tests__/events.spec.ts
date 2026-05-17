/**
 * Phase 19 / Plan 19-01 — events.ts spec (MOD-03 + TRACE-04 + TRACE-08).
 *
 * Proves:
 *   - reportingRegistry has exactly 4 entries; delivered + failedRetryExhausted
 *     are persisted:true; scheduled + failed are persisted:false; all aggregateType='reporting'.
 *   - makeReportingEmitters returns 4 typed helpers; each stamps a valid Envelope.
 *   - createEventHelpers reads correlationId from ALS (Map-shape store — same shape
 *     the pg-boss worker fiber hits after plan 15-05's queue.work ALS restore).
 *   - Payload schemas parse valid input and reject invalid URL.
 *
 * No database required — pure unit spec.
 */
import { describe, it, expect } from 'vitest';
import { asyncLocalStorage } from '@fastify/request-context';
import { randomUUID } from 'node:crypto';

import {
  reportingRegistry,
  makeReportingEmitters,
  REPORTING_EVENT_NAMES,
  REPORTING_AGGREGATE_ID,
  webhookScheduledPayload,
  webhookFailedRetryExhaustedPayload,
} from '../events.js';
import { TypedBus } from '../../bus/bus.js';
import type { Envelope } from '../../events/envelope.js';

describe('reporting events (Phase 19-01)', () => {
  describe('reportingRegistry [MOD-03, TRACE-08]', () => {
    it('has all 4 event entries', () => {
      const names = Object.keys(reportingRegistry);
      expect(names).toContain(REPORTING_EVENT_NAMES.SCHEDULED);
      expect(names).toContain(REPORTING_EVENT_NAMES.DELIVERED);
      expect(names).toContain(REPORTING_EVENT_NAMES.FAILED);
      expect(names).toContain(REPORTING_EVENT_NAMES.FAILED_RETRY_EXHAUSTED);
      expect(names).toHaveLength(4);
    });

    it('marks TERMINAL events as persisted:true (delivered + failed.retryExhausted)', () => {
      expect(reportingRegistry[REPORTING_EVENT_NAMES.DELIVERED].persisted).toBe(true);
      expect(reportingRegistry[REPORTING_EVENT_NAMES.FAILED_RETRY_EXHAUSTED].persisted).toBe(true);
    });

    it('marks TRANSIENT events as persisted:false (scheduled + failed)', () => {
      expect(reportingRegistry[REPORTING_EVENT_NAMES.SCHEDULED].persisted).toBe(false);
      expect(reportingRegistry[REPORTING_EVENT_NAMES.FAILED].persisted).toBe(false);
    });

    it('all 4 entries have aggregateType: reporting', () => {
      for (const name of Object.values(REPORTING_EVENT_NAMES)) {
        expect(reportingRegistry[name].aggregateType).toBe('reporting');
      }
    });
  });

  describe('makeReportingEmitters [MOD-03]', () => {
    it('returns {scheduled, delivered, failed, failedRetryExhausted}', () => {
      const bus = new TypedBus(reportingRegistry);
      const emit = makeReportingEmitters(bus);
      expect(typeof emit.scheduled).toBe('function');
      expect(typeof emit.delivered).toBe('function');
      expect(typeof emit.failed).toBe('function');
      expect(typeof emit.failedRetryExhausted).toBe('function');
    });

    it('emit.failedRetryExhausted stamps envelope with type=webhook.failed.retryExhausted, aggregateType=reporting, v=1', () => {
      const bus = new TypedBus(reportingRegistry);
      const captured: Envelope[] = [];
      const emit = makeReportingEmitters(bus, (env) => captured.push(env));

      emit.failedRetryExhausted(REPORTING_AGGREGATE_ID, {
        url: 'https://example.com/hook',
        event: 'job.completed',
        jobId: 'abc-123',
        attempts: 6,
        lastStatusCode: 500,
        lastError: 'boom',
        payloadSnapshot: { foo: 'bar' },
      });

      expect(captured).toHaveLength(1);
      const env = captured[0];
      expect(env.type).toBe('webhook.failed.retryExhausted');
      expect(env.aggregateType).toBe('reporting');
      expect(env.v).toBe(1);
      expect(env.aggregateId).toBe(REPORTING_AGGREGATE_ID);
      expect(typeof env.correlationId).toBe('string');
      expect(env.correlationId.length).toBeGreaterThan(0);
    });
  });

  describe('createEventHelpers ALS integration [TRACE-04]', () => {
    it('reads correlationId from AsyncLocalStorage when present (Map-shape store)', () => {
      // Map-shape ALS store — matches the pg-boss worker fiber shape that
      // readAls() in server/bus/helpers.ts handles generically. This is the
      // canonical test pattern (see server/lifecycle/__tests__/events.spec.ts:97
      // and server/events/__tests__/emit-helpers.spec.ts:32).
      const bus = new TypedBus(reportingRegistry);
      const captured: Envelope[] = [];
      const emit = makeReportingEmitters(bus, (env) => captured.push(env));
      const correlationId = randomUUID();

      asyncLocalStorage.run(new Map([['correlationId', correlationId]]) as never, () => {
        emit.scheduled(REPORTING_AGGREGATE_ID, {
          url: 'https://example.com/hook',
          event: 'job.completed',
          jobId: 'abc-123',
        });
      });

      expect(captured).toHaveLength(1);
      expect(captured[0].correlationId).toBe(correlationId);
    });
  });

  describe('reporting payload schemas [SPEC-03]', () => {
    it('webhookScheduledPayload accepts valid input', () => {
      const result = webhookScheduledPayload.safeParse({
        url: 'https://example.com/hook',
        event: 'job.completed',
        jobId: 'abc-123',
      });
      expect(result.success).toBe(true);
    });

    it('webhookFailedRetryExhaustedPayload accepts full terminal payload (EVENTS-07)', () => {
      const result = webhookFailedRetryExhaustedPayload.safeParse({
        url: 'https://example.com/hook',
        event: 'job.completed',
        jobId: null,
        attempts: 6,
        lastStatusCode: null,
        lastError: 'retry exhausted',
        payloadSnapshot: { foo: 'bar', nested: { x: 1 } },
      });
      expect(result.success).toBe(true);
    });

    it('webhookScheduledPayload rejects non-URL', () => {
      const result = webhookScheduledPayload.safeParse({
        url: 'not-a-url',
        event: 'job.completed',
        jobId: null,
      });
      expect(result.success).toBe(false);
    });
  });
});
