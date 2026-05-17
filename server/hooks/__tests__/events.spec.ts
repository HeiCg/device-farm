/**
 * Phase 16 / Plan 16-04 — events.ts spec (MOD-03 + SPEC-03).
 *
 * Proves:
 *   - hookDefinitionSchema applies defaults correctly (SPEC-03: z.infer preserves output type).
 *   - hooksRegistry persisted flags match TRACE-08 policy.
 *   - makeHookEmitters returns 4 typed helpers; each stamps a valid Envelope with aggregateType 'hook'.
 *   - createEventHelpers reads correlationId from ALS — verified by running emit inside an AsyncLocalStorage.run.
 */
import { describe, it, expect } from 'vitest';
import { asyncLocalStorage } from '@fastify/request-context';
import { randomUUID } from 'node:crypto';

import { hookDefinitionSchema } from '../schemas.js';
import { hooksRegistry, makeHookEmitters, HOOK_EVENT_NAMES } from '../events.js';
import { TypedBus } from '../../bus/bus.js';
import type { Envelope } from '../../events/envelope.js';

describe('hooks events (Phase 16-04)', () => {
  describe('hookDefinitionSchema [SPEC-03]', () => {
    it('applies Zod defaults when optional fields are omitted', () => {
      const parsed = hookDefinitionSchema.parse({
        name: 'h',
        event: 'device.booted',
        command: 'echo OK',
      });
      expect(parsed.platform).toBe('all');
      expect(parsed.timeoutMs).toBe(30_000);
      expect(parsed.failOnError).toBe(false);
      expect(parsed.enabled).toBe(true);
    });

    it('rejects invalid event values', () => {
      const result = hookDefinitionSchema.safeParse({
        name: 'h', event: 'not-an-event', command: 'echo',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('hooksRegistry [MOD-03, TRACE-08]', () => {
    it('has all 4 event entries', () => {
      const names = Object.keys(hooksRegistry);
      expect(names).toContain(HOOK_EVENT_NAMES.SCHEDULED);
      expect(names).toContain(HOOK_EVENT_NAMES.COMPLETED);
      expect(names).toContain(HOOK_EVENT_NAMES.FAILED);
      expect(names).toContain(HOOK_EVENT_NAMES.FAILED_RETRY_EXHAUSTED);
      expect(names).toHaveLength(4);
    });

    it('marks only terminal events as persisted (completed + retryExhausted)', () => {
      expect(hooksRegistry[HOOK_EVENT_NAMES.SCHEDULED].persisted).toBe(false);
      expect(hooksRegistry[HOOK_EVENT_NAMES.COMPLETED].persisted).toBe(true);
      expect(hooksRegistry[HOOK_EVENT_NAMES.FAILED].persisted).toBe(false);
      expect(hooksRegistry[HOOK_EVENT_NAMES.FAILED_RETRY_EXHAUSTED].persisted).toBe(true);
    });

    it('all 4 entries have aggregateType: hook', () => {
      for (const name of Object.values(HOOK_EVENT_NAMES)) {
        expect(hooksRegistry[name].aggregateType).toBe('hook');
      }
    });
  });

  describe('makeHookEmitters [MOD-03]', () => {
    it('returns {scheduled, completed, failed, retryExhausted}', () => {
      const bus = new TypedBus(hooksRegistry);
      const emit = makeHookEmitters(bus);
      expect(typeof emit.scheduled).toBe('function');
      expect(typeof emit.completed).toBe('function');
      expect(typeof emit.failed).toBe('function');
      expect(typeof emit.retryExhausted).toBe('function');
    });

    it('emit.completed stamps envelope with aggregateType=hook, type=hook.completed, v=1', () => {
      const bus = new TypedBus(hooksRegistry);
      const captured: Envelope[] = [];
      const emit = makeHookEmitters(bus, (env) => captured.push(env));
      const aggregateId = randomUUID();

      emit.completed(aggregateId, {
        hookName: 'h', event: 'device.booted',
        deviceId: null, jobId: null,
        exitCode: 0, durationMs: 42, stderrTail: '',
      });

      expect(captured).toHaveLength(1);
      const env = captured[0];
      expect(env.type).toBe('hook.completed');
      expect(env.aggregateType).toBe('hook');
      expect(env.v).toBe(1);
      expect(env.aggregateId).toBe(aggregateId);
      expect(env.actor).toBeTruthy();
      expect(env.correlationId).toBeTruthy();
    });
  });

  describe('createEventHelpers ALS integration [TRACE-04]', () => {
    it('reads correlationId from AsyncLocalStorage when present', () => {
      // Canonical ALS test pattern — matches server/events/__tests__/emit-helpers.spec.ts:32.
      // Uses Map store shape (not plain object) because the queue wrapper (plan 15-05) restores
      // ALS on pg-boss worker fibers with Map shape; using Map here exercises the same code path
      // in readAls (server/bus/helpers.ts:66-77) that production queue workers rely on.
      //
      // NOTE: `asyncLocalStorage` IS a named export of `@fastify/request-context` — verified at
      // server/bus/plugin.ts:48, server/bus/helpers.ts:33, server/correlation/index.ts:9 (re-export),
      // server/queue/plugin.ts:27, server/telemetry/plugin.ts:19, and the canonical test spec at
      // server/events/__tests__/emit-helpers.spec.ts:14. The import statement below MUST match
      // those existing import sites verbatim.
      const bus = new TypedBus(hooksRegistry);
      const captured: Envelope[] = [];
      const emit = makeHookEmitters(bus, (env) => captured.push(env));
      const aggregateId = randomUUID();
      const correlationId = randomUUID();

      asyncLocalStorage.run(new Map([['correlationId', correlationId]]), () => {
        emit.scheduled(aggregateId, {
          hookName: 'h', event: 'device.booted',
          deviceId: null, jobId: null,
        });
      });

      expect(captured).toHaveLength(1);
      expect(captured[0].correlationId).toBe(correlationId);
    });
  });
});
