/**
 * Phase 22 / Plan 22-01 — Streaming events spec (MOD-03, EVENTS-03, TRACE-04, TRACE-08).
 *
 * Proves:
 *   1. STREAMING_EVENT_NAMES shape (EVENTS-03 dotted past-tense; 1 key).
 *   2. streamingRegistry shape (1 entry; aggregateType='streaming'; persisted:false).
 *   3. STREAMING_AGGREGATE_ID equals uuidv5('streaming', URL_NAMESPACE) — single-source-of-truth.
 *   4. wsFrameDroppedPayload accepts valid + rejects malformed.
 *   5. makeStreamingEmitters returns {frameDropped}.
 *   6. emit.frameDropped stamps envelope with ALS correlationId + aggregateType +
 *      aggregateId + v=1 (TRACE-04).
 *
 * No DB. Uses asyncLocalStorage plain-object store shape (Phase 20 canonical —
 * NOT legacy Map shape; grep guard forbids new-Map-with-entries pattern in this file).
 */
import { describe, it, expect } from 'vitest';
import { v5 as uuidv5 } from 'uuid';
import { asyncLocalStorage } from '@fastify/request-context';
import { randomUUID } from 'node:crypto';

import {
  STREAMING_EVENT_NAMES,
  STREAMING_AGGREGATE_ID,
  streamingRegistry,
  makeStreamingEmitters,
  wsFrameDroppedPayload,
} from '../events.js';
import { TypedBus } from '../../bus/bus.js';

const URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

describe('[Phase 22-01] STREAMING_EVENT_NAMES (EVENTS-03)', () => {
  it('has 1 dotted past-tense event name', () => {
    expect(STREAMING_EVENT_NAMES.FRAME_DROPPED).toBe('ws.frame.dropped');
    expect(Object.keys(STREAMING_EVENT_NAMES)).toHaveLength(1);
    for (const v of Object.values(STREAMING_EVENT_NAMES)) {
      expect(v).toMatch(/^[a-z]+(\.[a-z]+)+$/);
    }
  });
});

describe('[Phase 22-01] streamingRegistry (MOD-03 + TRACE-08)', () => {
  it('has 1 entry with aggregateType="streaming"', () => {
    const entries = Object.entries(streamingRegistry);
    expect(entries).toHaveLength(1);
    for (const [, entry] of entries) {
      expect(entry.aggregateType).toBe('streaming');
    }
  });

  it('persistence flags: ws.frame.dropped=false (TRACE-08 — programmer-error signal, structured log sufficient)', () => {
    expect(streamingRegistry['ws.frame.dropped'].persisted).toBe(false);
  });
});

describe('[Phase 22-01] STREAMING_AGGREGATE_ID v5 derivation', () => {
  it('matches uuidv5("streaming", URL_NAMESPACE) — single source of truth', () => {
    expect(STREAMING_AGGREGATE_ID).toBe(uuidv5('streaming', URL_NAMESPACE));
  });

  it('equals the precomputed literal fff0592e-b92c-5221-a40a-d10a141f0158', () => {
    expect(STREAMING_AGGREGATE_ID).toBe('fff0592e-b92c-5221-a40a-d10a141f0158');
  });
});

describe('[Phase 22-01] wsFrameDroppedPayload schema', () => {
  it('accepts valid sample with all fields', () => {
    const parsed = wsFrameDroppedPayload.safeParse({
      jobId: randomUUID(),
      eventType: 'log',
      reason: 'safeParse-failed',
      zodError: 'correlationId is required',
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts valid sample without optional zodError', () => {
    const parsed = wsFrameDroppedPayload.safeParse({
      jobId: randomUUID(),
      eventType: 'step',
      reason: 'unknown',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects invalid eventType enum value', () => {
    const parsed = wsFrameDroppedPayload.safeParse({
      jobId: randomUUID(),
      eventType: 'metrics', // not in enum
      reason: 'safeParse-failed',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects invalid reason enum value', () => {
    const parsed = wsFrameDroppedPayload.safeParse({
      jobId: randomUUID(),
      eventType: 'log',
      reason: 'timeout', // not in enum
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects missing required field (jobId)', () => {
    const parsed = wsFrameDroppedPayload.safeParse({
      eventType: 'log',
      reason: 'safeParse-failed',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('[Phase 22-01] makeStreamingEmitters + ALS envelope (TRACE-04)', () => {
  it('returns 1 typed helper', () => {
    const bus = new TypedBus(streamingRegistry);
    const emit = makeStreamingEmitters(bus);
    expect(typeof emit.frameDropped).toBe('function');
    expect(Object.keys(emit)).toHaveLength(1);
  });

  it('emit.frameDropped stamps envelope with ALS correlationId + aggregateType + aggregateId + v=1', async () => {
    const bus = new TypedBus(streamingRegistry);
    const captured: { envelope?: unknown } = {};
    const onEmit = (env: unknown) => {
      captured.envelope = env;
    };
    const emit = makeStreamingEmitters(bus, onEmit);

    const corrId = randomUUID();
    const jobId = randomUUID();

    // PLAIN-OBJECT ALS store shape per Phase 20 canonical — NOT legacy Map.
    await asyncLocalStorage.run(
      { correlationId: corrId, currentEventId: null, actor: 'events-spec' } as never,
      async () => {
        emit.frameDropped(jobId, {
          jobId,
          eventType: 'log',
          reason: 'safeParse-failed',
          zodError: 'correlationId missing from envelope candidate',
        });
      },
    );

    const env = captured.envelope as {
      type: string;
      v: number;
      correlationId: string;
      aggregateType: string;
      aggregateId: string;
    };
    expect(env.type).toBe('ws.frame.dropped');
    expect(env.v).toBe(1);
    expect(env.correlationId).toBe(corrId);
    expect(env.aggregateType).toBe('streaming');
    expect(env.aggregateId).toBe(jobId);
  });
});
