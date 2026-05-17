/**
 * Phase 35 Plan 35-03 — ExplorationsBroadcaster + WS envelope + subscribers spec.
 *
 * Non-DB unit tests (no Fastify boot, no Postgres). Proves:
 *   1. wsExplorationFrameSchema strict-parses each of 6 valid variants.
 *   2. Discriminator + correlationId nullability enforced.
 *   3. Broadcaster: publish → buffer → fan-out.
 *   4. Ring buffer caps at exactly 200 (not 199, not 201).
 *   5. Multi-subscriber broadcast: 1 publish → N receives.
 *   6. Malformed frame: safeParse fail → drop + warn + no crash.
 *   7. unsubscribe after terminal + 0 subscribers → cleanup.
 *   8. Heartbeat: fake timers advance 30s → ping fired.
 *   9. correlationId propagation: bus envelope correlationId → WS frame.
 *  10. Subscribers: 6 bus events → 6 broadcaster frames (1:1 mapping).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { asyncLocalStorage } from '@fastify/request-context';
import type { Logger } from 'pino';

import {
  wsExplorationFrameSchema,
  type WsExplorationFrame,
} from '../ws-schemas.js';
import {
  ExplorationsBroadcaster,
  RING_BUFFER_SIZE,
  HEARTBEAT_INTERVAL_MS,
} from '../internal/broadcaster.js';
import { registerExplorationSubscribers } from '../internal/subscribers.js';
import { TypedBus } from '../../bus/bus.js';
import {
  explorationsRegistry,
  makeExplorationsEmitters,
  EXPLORATIONS_AGGREGATE_ID,
} from '../events.js';
import type { Envelope } from '../../events/envelope.js';

// ---------- Stub WebSocket ----------

class StubSocket {
  sent: string[] = [];
  pingCount = 0;
  readyState = 1; // OPEN
  send(data: string): void {
    this.sent.push(data);
  }
  ping(): void {
    this.pingCount++;
  }
  close(): void {
    this.readyState = 3; // CLOSED
  }
  on(): void {
    /* no-op */
  }
}

// ---------- Stub logger ----------

function makeLogger(): Logger {
  return {
    child: () => makeLogger(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    level: 'info',
  } as unknown as Logger;
}

// ---------- Test data factories ----------

function validScreenDiscoveredFrame(overrides: Partial<WsExplorationFrame> = {}): WsExplorationFrame {
  return {
    v: 1,
    type: 'screen-discovered',
    ts: new Date().toISOString(),
    correlationId: randomUUID(),
    data: {
      runId: randomUUID(),
      screenId: 'home',
      title: 'Home Screen',
      bfsDepth: 0,
      screenshotArtifactId: randomUUID(),
    },
    ...overrides,
  } as WsExplorationFrame;
}

function validTransitionFrame(): WsExplorationFrame {
  return {
    v: 1,
    type: 'transition',
    ts: new Date().toISOString(),
    correlationId: randomUUID(),
    data: {
      runId: randomUUID(),
      fromScreenId: 'home',
      toScreenId: 'settings',
      action: { tool: 'device_tap', args: { x: 100, y: 200 } },
      isBackEdge: false,
    },
  };
}

function validToolCallFrame(): WsExplorationFrame {
  return {
    v: 1,
    type: 'tool-call',
    ts: new Date().toISOString(),
    correlationId: randomUUID(),
    data: {
      runId: randomUUID(),
      name: 'device_screenshot',
      args: { sessionId: 'sess-1' },
      durationMs: 42,
    },
  };
}

function validStuckFrame(): WsExplorationFrame {
  return {
    v: 1,
    type: 'stuck',
    ts: new Date().toISOString(),
    correlationId: randomUUID(),
    data: { runId: randomUUID(), screenId: 'home', consecutive: 3 },
  };
}

function validFinishedFrame(): WsExplorationFrame {
  return {
    v: 1,
    type: 'finished',
    ts: new Date().toISOString(),
    correlationId: randomUUID(),
    data: {
      runId: randomUUID(),
      reason: 'complete',
      stats: { screensDiscovered: 5, transitionsTotal: 7, tapsTaken: 12, durationMs: 30_000 },
    },
  };
}

function validErrorFrame(): WsExplorationFrame {
  return {
    v: 1,
    type: 'error',
    ts: new Date().toISOString(),
    correlationId: randomUUID(),
    data: { runId: randomUUID(), message: '[lease] device pool exhausted' },
  };
}

// ---------- Schema tests ----------

describe('[35-03] wsExplorationFrameSchema discriminated union', () => {
  it('parses screen-discovered variant', () => {
    const result = wsExplorationFrameSchema.safeParse(validScreenDiscoveredFrame());
    expect(result.success).toBe(true);
  });

  it('parses transition variant', () => {
    const result = wsExplorationFrameSchema.safeParse(validTransitionFrame());
    expect(result.success).toBe(true);
  });

  it('parses tool-call variant', () => {
    const result = wsExplorationFrameSchema.safeParse(validToolCallFrame());
    expect(result.success).toBe(true);
  });

  it('parses stuck variant', () => {
    const result = wsExplorationFrameSchema.safeParse(validStuckFrame());
    expect(result.success).toBe(true);
  });

  it('parses finished variant with all 5 reason enum values', () => {
    for (const reason of ['complete', 'budget', 'stuck', 'login_required', 'cancelled'] as const) {
      const frame = validFinishedFrame();
      (frame as { data: { reason: string } }).data.reason = reason;
      const result = wsExplorationFrameSchema.safeParse(frame);
      expect(result.success, `reason=${reason} should parse`).toBe(true);
    }
  });

  it('parses error variant', () => {
    const result = wsExplorationFrameSchema.safeParse(validErrorFrame());
    expect(result.success).toBe(true);
  });

  it('rejects unknown discriminator value', () => {
    const bad = { ...validScreenDiscoveredFrame(), type: 'unknown-variant' };
    const result = wsExplorationFrameSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('accepts null correlationId (system-fiber producers)', () => {
    const frame = validScreenDiscoveredFrame({ correlationId: null });
    const result = wsExplorationFrameSchema.safeParse(frame);
    expect(result.success).toBe(true);
  });

  it('rejects undefined correlationId (must be present as null or uuid)', () => {
    const frame = validScreenDiscoveredFrame() as Record<string, unknown>;
    delete frame.correlationId;
    const result = wsExplorationFrameSchema.safeParse(frame);
    expect(result.success).toBe(false);
  });

  it('rejects non-uuid correlationId', () => {
    const frame = validScreenDiscoveredFrame({ correlationId: 'not-a-uuid' as unknown as string });
    const result = wsExplorationFrameSchema.safeParse(frame);
    expect(result.success).toBe(false);
  });

  it('rejects wrong v literal', () => {
    const bad = { ...validScreenDiscoveredFrame(), v: 2 };
    const result = wsExplorationFrameSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects missing data field', () => {
    const bad = validScreenDiscoveredFrame() as Record<string, unknown>;
    delete bad.data;
    const result = wsExplorationFrameSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

// ---------- Broadcaster tests ----------

describe('[35-03] ExplorationsBroadcaster — publish + buffer + fan-out', () => {
  let logger: Logger;
  let broadcaster: ExplorationsBroadcaster;

  beforeEach(() => {
    logger = makeLogger();
    broadcaster = new ExplorationsBroadcaster(logger);
  });

  afterEach(() => {
    broadcaster.shutdown();
  });

  it('publish: adds frame to history; late subscribe replays', () => {
    const runId = randomUUID();
    const frame = validScreenDiscoveredFrame();
    broadcaster.publish(runId, frame);
    expect(broadcaster.getHistorySize(runId)).toBe(1);

    const ws = new StubSocket();
    broadcaster.subscribe(runId, ws as never);
    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0]).type).toBe('screen-discovered');
  });

  it('ring buffer caps at exactly 200 (publish 250, subscribe receives 200)', () => {
    const runId = randomUUID();
    for (let i = 0; i < 250; i++) {
      const frame = validScreenDiscoveredFrame();
      (frame as { data: { screenId: string } }).data.screenId = `screen-${i}`;
      broadcaster.publish(runId, frame);
    }
    expect(broadcaster.getHistorySize(runId)).toBe(RING_BUFFER_SIZE);

    const ws = new StubSocket();
    broadcaster.subscribe(runId, ws as never);
    expect(ws.sent).toHaveLength(RING_BUFFER_SIZE);
    // First buffered should be screen-50 (250 - 200 = first kept index).
    expect(JSON.parse(ws.sent[0]).data.screenId).toBe('screen-50');
    expect(JSON.parse(ws.sent[ws.sent.length - 1]).data.screenId).toBe('screen-249');
  });

  it('multi-subscriber: 1 publish → all subscribers receive', () => {
    const runId = randomUUID();
    const a = new StubSocket();
    const b = new StubSocket();
    const c = new StubSocket();
    broadcaster.subscribe(runId, a as never);
    broadcaster.subscribe(runId, b as never);
    broadcaster.subscribe(runId, c as never);

    broadcaster.publish(runId, validScreenDiscoveredFrame());

    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(1);
    expect(c.sent).toHaveLength(1);
  });

  it('malformed frame: dropped + warn-logged, no throw', () => {
    const runId = randomUUID();
    const ws = new StubSocket();
    broadcaster.subscribe(runId, ws as never);

    const badFrame = { type: 'invalid', v: 1, ts: new Date().toISOString() } as unknown as WsExplorationFrame;
    expect(() => broadcaster.publish(runId, badFrame)).not.toThrow();
    expect(ws.sent).toHaveLength(0);
    expect(broadcaster.getHistorySize(runId)).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId }),
      expect.stringContaining('malformed frame dropped'),
    );
  });

  it('unsubscribe after terminal + 0 subscribers triggers cleanup', () => {
    const runId = randomUUID();
    const ws = new StubSocket();
    broadcaster.subscribe(runId, ws as never);
    broadcaster.publish(runId, validFinishedFrame());
    expect(broadcaster.getRunCount()).toBe(1);

    broadcaster.unsubscribe(runId, ws as never);
    expect(broadcaster.getRunCount()).toBe(0);
  });

  it('unsubscribe before terminal: keeps run state alive for reconnect', () => {
    const runId = randomUUID();
    const ws = new StubSocket();
    broadcaster.subscribe(runId, ws as never);
    broadcaster.publish(runId, validScreenDiscoveredFrame());
    broadcaster.unsubscribe(runId, ws as never);
    // Non-terminal: state preserved.
    expect(broadcaster.getRunCount()).toBe(1);
    expect(broadcaster.getHistorySize(runId)).toBe(1);
  });

  it('heartbeat fires ping on advance 30s (fake timers)', () => {
    vi.useFakeTimers();
    try {
      const localLogger = makeLogger();
      const localBroadcaster = new ExplorationsBroadcaster(localLogger);
      const runId = randomUUID();
      const ws = new StubSocket();
      localBroadcaster.subscribe(runId, ws as never);

      expect(ws.pingCount).toBe(0);
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS + 1);
      expect(ws.pingCount).toBe(1);

      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
      expect(ws.pingCount).toBe(2);

      localBroadcaster.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cleanup: removes run state + closes any remaining sockets', () => {
    const runId = randomUUID();
    const ws = new StubSocket();
    broadcaster.subscribe(runId, ws as never);
    expect(broadcaster.getRunCount()).toBe(1);

    broadcaster.cleanup(runId);
    expect(broadcaster.getRunCount()).toBe(0);
    expect(ws.readyState).toBe(3); // CLOSED
  });
});

// ---------- Subscriber tests ----------

describe('[35-03] registerExplorationSubscribers — bus → broadcaster wiring', () => {
  let logger: Logger;
  let broadcaster: ExplorationsBroadcaster;
  let bus: TypedBus<typeof explorationsRegistry>;
  let emit: ReturnType<typeof makeExplorationsEmitters>;
  let unsubscribe: () => void;

  beforeEach(() => {
    logger = makeLogger();
    broadcaster = new ExplorationsBroadcaster(logger);
    bus = new TypedBus(explorationsRegistry);
    const ee = (bus as unknown as { ee: { emit: (n: string, e: Envelope) => void } }).ee;
    emit = makeExplorationsEmitters(bus, (env: Envelope) => {
      // Mirror persistEnvelope side-channel for envelope subscribers.
      ee.emit(`${env.type}.envelope`, env);
    });
    unsubscribe = registerExplorationSubscribers({ bus, broadcaster });
  });

  afterEach(() => {
    unsubscribe();
    broadcaster.shutdown();
  });

  it('emit.screenDiscovered → screen-discovered frame on broadcaster', () => {
    const runId = randomUUID();
    const ws = new StubSocket();
    broadcaster.subscribe(runId, ws as never);

    emit.screenDiscovered(runId, {
      runId,
      screenId: 'home',
      title: 'Home',
      bfsDepth: 0,
      screenshotArtifactId: randomUUID(),
    });

    expect(ws.sent).toHaveLength(1);
    const frame = JSON.parse(ws.sent[0]);
    expect(frame.type).toBe('screen-discovered');
    expect(frame.data.screenId).toBe('home');
    expect(frame.v).toBe(1);
  });

  it('emit.transition → transition frame', () => {
    const runId = randomUUID();
    const ws = new StubSocket();
    broadcaster.subscribe(runId, ws as never);

    emit.transition(runId, {
      runId,
      fromScreenId: 'home',
      toScreenId: 'settings',
      action: { tool: 'device_tap', args: { x: 50, y: 75 } },
      isBackEdge: false,
    });

    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0]).type).toBe('transition');
  });

  it('emit.toolCall → tool-call frame', () => {
    const runId = randomUUID();
    const ws = new StubSocket();
    broadcaster.subscribe(runId, ws as never);

    emit.toolCall(runId, {
      runId,
      name: 'device_screenshot',
      args: {},
      durationMs: 10,
    });

    expect(JSON.parse(ws.sent[0]).type).toBe('tool-call');
  });

  it('emit.stuck → stuck frame', () => {
    const runId = randomUUID();
    const ws = new StubSocket();
    broadcaster.subscribe(runId, ws as never);

    emit.stuck(runId, { runId, screenId: 'home', consecutive: 3 });

    expect(JSON.parse(ws.sent[0]).type).toBe('stuck');
  });

  it('emit.finished → finished frame; subscriber receives terminal frame', () => {
    const runId = randomUUID();
    const ws = new StubSocket();
    broadcaster.subscribe(runId, ws as never);

    emit.finished(runId, {
      runId,
      reason: 'complete',
      stats: { screensDiscovered: 3, transitionsTotal: 4, tapsTaken: 7, durationMs: 12_345 },
    });

    expect(JSON.parse(ws.sent[0]).type).toBe('finished');
  });

  it('emit.failed → error frame with [step] message format', () => {
    const runId = randomUUID();
    const ws = new StubSocket();
    broadcaster.subscribe(runId, ws as never);

    emit.failed(runId, { runId, step: 'lease', reason: 'pool exhausted' });

    const frame = JSON.parse(ws.sent[0]);
    expect(frame.type).toBe('error');
    expect(frame.data.message).toBe('[lease] pool exhausted');
  });

  it('emit.started does NOT fan out as a WS frame (REST-only event)', () => {
    const runId = randomUUID();
    const ws = new StubSocket();
    broadcaster.subscribe(runId, ws as never);

    emit.started(runId, {
      runId,
      deviceId: randomUUID(),
      sessionId: randomUUID(),
      bundleId: 'com.example',
      platform: 'android',
      startedBy: 'system',
    });

    expect(ws.sent).toHaveLength(0);
  });

  it('correlationId from ALS propagates into WS frame', () => {
    const runId = randomUUID();
    const ws = new StubSocket();
    broadcaster.subscribe(runId, ws as never);

    const cid = randomUUID();
    asyncLocalStorage.run({ correlationId: cid, actor: 'system' } as never, () => {
      emit.screenDiscovered(runId, {
        runId,
        screenId: 'home',
        title: 'Home',
        bfsDepth: 0,
        screenshotArtifactId: randomUUID(),
      });
    });

    expect(ws.sent).toHaveLength(1);
    const frame = JSON.parse(ws.sent[0]);
    expect(frame.correlationId).toBe(cid);
  });

  it('unregister detaches all listeners (no further fan-out)', () => {
    const runId = randomUUID();
    const ws = new StubSocket();
    broadcaster.subscribe(runId, ws as never);

    unsubscribe();

    emit.screenDiscovered(runId, {
      runId,
      screenId: 'home',
      title: 'Home',
      bfsDepth: 0,
      screenshotArtifactId: randomUUID(),
    });

    expect(ws.sent).toHaveLength(0);
  });
});

// ---------- Aggregate-id sanity ----------

describe('[35-03] aggregate id sanity', () => {
  it('EXPLORATIONS_AGGREGATE_ID is a stable v5 UUID', () => {
    expect(EXPLORATIONS_AGGREGATE_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
