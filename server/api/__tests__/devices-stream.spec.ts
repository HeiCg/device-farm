/**
 * Phase 36 / Plan 36-02 — Devices WS stream tests (DISC-WS).
 *
 * Tests the broadcaster-style helper that subscribes to bus events and
 * forwards them to a WebSocket as wsEnvelopeSchema frames. Uses a stub
 * socket + a stub typed bus so the test doesn't need a Fastify boot.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { wsEnvelopeSchema } from '../../streaming/index.js';
import { attachDevicesStreamSubscribers } from '../devices-stream.js';
import type { DiscoveredDevice } from '../../pool/index.js';

class StubSocket {
  sent: string[] = [];
  readyState = 1; // OPEN
  closeCount = 0;
  send(data: string): void { this.sent.push(data); }
  close(): void { this.closeCount += 1; }
  on(_event: string, _handler: (...args: unknown[]) => void): void { /* noop */ }
}

class StubBus {
  emitter = new EventEmitter();
  on(name: string, handler: (raw: unknown) => void): () => void {
    this.emitter.on(name, handler);
    return () => this.emitter.off(name, handler);
  }
  fire(name: string, payload: unknown): void { this.emitter.emit(name, payload); }
}

function sample(): DiscoveredDevice {
  return {
    id: 'R5CR1234567',
    name: 'Pixel 9',
    platform: 'android',
    state: 'booted',
    deviceType: 'Physical',
    osVersion: '14',
    model: 'Pixel 9',
  };
}

let bus: StubBus;
let socket: StubSocket;
let snapshot: DiscoveredDevice[];

beforeEach(() => {
  bus = new StubBus();
  socket = new StubSocket();
  snapshot = [];
});

function attach() {
  return attachDevicesStreamSubscribers({
    socket: socket as unknown as Parameters<typeof attachDevicesStreamSubscribers>[0]['socket'],
    bus: bus as unknown as Parameters<typeof attachDevicesStreamSubscribers>[0]['bus'],
    snapshot: () => snapshot,
  });
}

describe('[Phase 36-02] devices-stream WS subscribers', () => {
  it('replays current discoverySnapshot as synthetic added frames on connect', () => {
    snapshot = [sample()];
    const unsub = attach();
    expect(socket.sent).toHaveLength(1);
    const frame = JSON.parse(socket.sent[0]!);
    expect(frame.type).toBe('device.discovered.added');
    expect(frame.payload.device.id).toBe('R5CR1234567');
    unsub();
  });

  it('forwards device.discovered.added bus event as envelope', () => {
    const unsub = attach();
    bus.fire('device.discovered.added', { device: sample() });
    expect(socket.sent).toHaveLength(1);
    const frame = JSON.parse(socket.sent[0]!);
    expect(frame.type).toBe('device.discovered.added');
    expect(frame.payload.device.platform).toBe('android');
    unsub();
  });

  it('forwards device.discovered.removed event', () => {
    const unsub = attach();
    bus.fire('device.discovered.removed', { device: sample() });
    expect(socket.sent[0]).toContain('device.discovered.removed');
    unsub();
  });

  it('forwards device.discovered.changed event', () => {
    const unsub = attach();
    bus.fire('device.discovered.changed', { device: sample() });
    expect(socket.sent[0]).toContain('device.discovered.changed');
    unsub();
  });

  it('every emitted frame validates against wsEnvelopeSchema', () => {
    snapshot = [sample()];
    const unsub = attach();
    bus.fire('device.discovered.added', { device: sample() });
    bus.fire('device.discovered.removed', { device: sample() });
    bus.fire('device.discovered.changed', { device: sample() });
    for (const raw of socket.sent) {
      const parsed = wsEnvelopeSchema.safeParse(JSON.parse(raw));
      expect(parsed.success).toBe(true);
    }
    unsub();
  });

  it('unsubscribe stops further bus events from being delivered', () => {
    const unsub = attach();
    unsub();
    bus.fire('device.discovered.added', { device: sample() });
    expect(socket.sent).toHaveLength(0);
  });

  it('skips sends when socket is not OPEN', () => {
    socket.readyState = 3; // CLOSED
    const unsub = attach();
    // No replay
    expect(socket.sent).toHaveLength(0);
    bus.fire('device.discovered.added', { device: sample() });
    expect(socket.sent).toHaveLength(0);
    unsub();
  });
});
