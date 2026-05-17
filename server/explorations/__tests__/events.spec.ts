/**
 * Phase 35 Plan 35-01 — explorations event surface tests.
 *
 * Asserts:
 *   - registry shape (7 entries, aggregateType='exploration')
 *   - TRACE-08 split (4 persisted + 3 transient)
 *   - EXPLORATIONS_AGGREGATE_ID re-derived at runtime matches literal
 *   - payload schemas accept valid samples + reject malformed
 *   - makeExplorationsEmitters returns 7 typed helpers
 *   - emit stamps envelope: type, v=1, correlationId from ALS, aggregateType,
 *     aggregateId=payload.runId
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { v5 as uuidv5 } from 'uuid';
import { asyncLocalStorage } from '@fastify/request-context';

import {
  EXPLORATION_EVENT_NAMES,
  EXPLORATIONS_AGGREGATE_TYPE,
  EXPLORATIONS_AGGREGATE_ID,
  explorationsRegistry,
  makeExplorationsEmitters,
  explorationStartedPayloadSchema,
  explorationScreenDiscoveredPayloadSchema,
  explorationTransitionPayloadSchema,
  explorationStuckPayloadSchema,
  explorationToolCallPayloadSchema,
  explorationFinishedPayloadSchema,
  explorationFailedPayloadSchema,
  type ExplorationsRegistry,
} from '../events.js';
import { TypedBus } from '../../bus/bus.js';
import type { Envelope } from '../../events/envelope.js';

const URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

describe('explorations/events.ts — name constants + aggregate id', () => {
  it('exports 7 dotted past-tense event names', () => {
    const values = Object.values(EXPLORATION_EVENT_NAMES);
    expect(values).toHaveLength(7);
    for (const name of values) {
      expect(name).toMatch(/^exploration\.[a-z.]+$/);
    }
  });

  it('aggregate type literal is "exploration"', () => {
    expect(EXPLORATIONS_AGGREGATE_TYPE).toBe('exploration');
  });

  it('EXPLORATIONS_AGGREGATE_ID re-derives to the same v5 UUID at runtime (single source of truth)', () => {
    const rederived = uuidv5('exploration', URL_NAMESPACE);
    expect(EXPLORATIONS_AGGREGATE_ID).toBe(rederived);
    expect(EXPLORATIONS_AGGREGATE_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe('explorations/events.ts — registry shape + TRACE-08 persistence policy', () => {
  it('registry has exactly 7 entries; all aggregateType="exploration"', () => {
    const entries = Object.entries(explorationsRegistry);
    expect(entries).toHaveLength(7);
    for (const [, def] of entries) {
      expect(def.aggregateType).toBe(EXPLORATIONS_AGGREGATE_TYPE);
    }
  });

  it('TRACE-08 split: 4 persisted (started/stuck/finished/failed), 3 transient (screen/transition/toolCall)', () => {
    const persisted = Object.entries(explorationsRegistry)
      .filter(([, def]) => def.persisted)
      .map(([name]) => name)
      .sort();
    const transient = Object.entries(explorationsRegistry)
      .filter(([, def]) => !def.persisted)
      .map(([name]) => name)
      .sort();

    expect(persisted).toEqual(
      [
        EXPLORATION_EVENT_NAMES.STARTED,
        EXPLORATION_EVENT_NAMES.STUCK,
        EXPLORATION_EVENT_NAMES.FINISHED,
        EXPLORATION_EVENT_NAMES.FAILED,
      ].sort(),
    );
    expect(transient).toEqual(
      [
        EXPLORATION_EVENT_NAMES.SCREEN_DISCOVERED,
        EXPLORATION_EVENT_NAMES.TRANSITION,
        EXPLORATION_EVENT_NAMES.TOOL_CALL,
      ].sort(),
    );
  });
});

describe('explorations/events.ts — payload schema validation', () => {
  it('explorationStartedPayloadSchema accepts a valid sample + rejects malformed', () => {
    const valid = {
      runId: randomUUID(),
      deviceId: randomUUID(),
      sessionId: randomUUID(),
      bundleId: 'com.example.app',
      platform: 'android' as const,
      startedBy: `apikey:${randomUUID()}`,
    };
    expect(() => explorationStartedPayloadSchema.parse(valid)).not.toThrow();
    expect(() =>
      explorationStartedPayloadSchema.parse({ ...valid, platform: 'windows' }),
    ).toThrow();
  });

  it('explorationScreenDiscoveredPayloadSchema accepts valid + rejects negative bfsDepth', () => {
    const valid = {
      runId: randomUUID(),
      screenId: 'home',
      title: 'Home',
      bfsDepth: 0,
      screenshotArtifactId: randomUUID(),
    };
    expect(() => explorationScreenDiscoveredPayloadSchema.parse(valid)).not.toThrow();
    expect(() =>
      explorationScreenDiscoveredPayloadSchema.parse({ ...valid, bfsDepth: -1 }),
    ).toThrow();
  });

  it('explorationTransitionPayloadSchema accepts valid + rejects missing isBackEdge', () => {
    const valid = {
      runId: randomUUID(),
      fromScreenId: 'home',
      toScreenId: 'shop',
      action: { type: 'tap', x: 100, y: 200 },
      isBackEdge: false,
    };
    expect(() => explorationTransitionPayloadSchema.parse(valid)).not.toThrow();
    const { isBackEdge: _omit, ...missing } = valid;
    expect(() => explorationTransitionPayloadSchema.parse(missing)).toThrow();
  });

  it('explorationStuckPayloadSchema accepts valid + rejects consecutive=0', () => {
    const valid = { runId: randomUUID(), screenId: 'home', consecutive: 3 };
    expect(() => explorationStuckPayloadSchema.parse(valid)).not.toThrow();
    expect(() => explorationStuckPayloadSchema.parse({ ...valid, consecutive: 0 })).toThrow();
  });

  it('explorationToolCallPayloadSchema accepts valid + rejects negative durationMs', () => {
    const valid = {
      runId: randomUUID(),
      name: 'tap',
      args: { x: 100 },
      durationMs: 42,
    };
    expect(() => explorationToolCallPayloadSchema.parse(valid)).not.toThrow();
    expect(() =>
      explorationToolCallPayloadSchema.parse({ ...valid, durationMs: -1 }),
    ).toThrow();
  });

  it('explorationFinishedPayloadSchema accepts valid + rejects unknown reason', () => {
    const valid = {
      runId: randomUUID(),
      reason: 'complete' as const,
      stats: {
        screensDiscovered: 12,
        transitionsTotal: 24,
        tapsTaken: 36,
        durationMs: 60_000,
      },
    };
    expect(() => explorationFinishedPayloadSchema.parse(valid)).not.toThrow();
    expect(() =>
      explorationFinishedPayloadSchema.parse({ ...valid, reason: 'unknown' }),
    ).toThrow();
  });

  it('explorationFailedPayloadSchema accepts valid + rejects empty reason', () => {
    const valid = { runId: randomUUID(), step: 'agent' as const, reason: 'context_overflow' };
    expect(() => explorationFailedPayloadSchema.parse(valid)).not.toThrow();
    expect(() => explorationFailedPayloadSchema.parse({ ...valid, reason: '' })).toThrow();
  });
});

describe('explorations/events.ts — makeExplorationsEmitters', () => {
  function buildBus() {
    return new TypedBus<ExplorationsRegistry>(explorationsRegistry);
  }

  it('returns object with 7 typed helpers (started/screenDiscovered/transition/stuck/toolCall/finished/failed)', () => {
    const bus = buildBus();
    const emit = makeExplorationsEmitters(bus);
    const expected = [
      'started',
      'screenDiscovered',
      'transition',
      'stuck',
      'toolCall',
      'finished',
      'failed',
    ];
    for (const name of expected) {
      expect(typeof (emit as unknown as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('emit.started stamps envelope (type, v=1, correlationId from ALS, aggregateType, aggregateId=runId)', () => {
    const bus = buildBus();
    const stamped: Envelope[] = [];
    const emit = makeExplorationsEmitters(bus, (env) => {
      stamped.push(env);
    });

    const correlationId = randomUUID();
    const runId = randomUUID();
    const payload = {
      runId,
      deviceId: randomUUID(),
      sessionId: randomUUID(),
      bundleId: 'com.example.app',
      platform: 'android' as const,
      startedBy: 'system' as const,
    };

    // ALS-stamp correlationId so the helper picks it up.
    asyncLocalStorage.run({ correlationId, actor: 'system' } as never, () => {
      emit.started(runId, payload);
    });

    expect(stamped).toHaveLength(1);
    const env = stamped[0];
    expect(env.type).toBe('exploration.started');
    expect(env.v).toBe(1);
    expect(env.correlationId).toBe(correlationId);
    expect(env.aggregateType).toBe('exploration');
    expect(env.aggregateId).toBe(runId);
    expect(env.actor).toBe('system');
    expect(env.payload).toMatchObject({ runId, platform: 'android' });
  });

  it('emit.finished stamps aggregateId=runId for a terminal event', () => {
    const bus = buildBus();
    const stamped: Envelope[] = [];
    const emit = makeExplorationsEmitters(bus, (env) => {
      stamped.push(env);
    });
    const runId = randomUUID();
    emit.finished(runId, {
      runId,
      reason: 'complete',
      stats: {
        screensDiscovered: 5,
        transitionsTotal: 8,
        tapsTaken: 12,
        durationMs: 30_000,
      },
    });
    expect(stamped).toHaveLength(1);
    expect(stamped[0].type).toBe('exploration.finished');
    expect(stamped[0].aggregateId).toBe(runId);
  });
});
