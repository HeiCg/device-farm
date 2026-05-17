/**
 * Verifies that gesture envelopes received on the browser WebSocket
 * are forwarded through the injected InputService, and that
 * non-gesture envelopes (control / unknown) are NOT routed there.
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { SimulatorStreamService } from '../src/stream-service.js';
import type { InputService } from '../src/input-service.js';

class FakeSocket extends EventEmitter {
  readyState = 1;
  send(_: unknown) {}
  close() {}
}

function makeInputs(): InputService {
  return {
    tap: vi.fn().mockResolvedValue(undefined),
    swipe: vi.fn().mockResolvedValue(undefined),
    pressKey: vi.fn().mockResolvedValue(undefined),
    releaseKey: vi.fn().mockResolvedValue(undefined),
    typeText: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    stopAll: vi.fn().mockResolvedValue(undefined),
  } as unknown as InputService;
}

function makeHandlers() {
  return {
    onFps: vi.fn(),
    onBitrate: vi.fn(),
    onScale: vi.fn(),
    onForceIdr: vi.fn(),
    onSnapshot: vi.fn(),
  };
}

describe('SimulatorStreamService gesture routing', () => {
  it('routes a tap envelope through InputService.send with the device udid', async () => {
    const inputs = makeInputs();
    const svc = new SimulatorStreamService({ inputs });
    const ws = new FakeSocket();
    svc.handleBrowserConnection(ws as any, 'UDID-G1', makeHandlers());

    const env = { type: 'tap', x: 12, y: 34, width: 390, height: 844 };
    ws.emit('message', JSON.stringify(env));

    // microtask drain
    await new Promise((r) => setImmediate(r));

    expect(inputs.send).toHaveBeenCalledTimes(1);
    expect(inputs.send).toHaveBeenCalledWith('UDID-G1', env);
  });

  it('routes a swipe envelope through InputService.send', async () => {
    const inputs = makeInputs();
    const svc = new SimulatorStreamService({ inputs });
    const ws = new FakeSocket();
    svc.handleBrowserConnection(ws as any, 'UDID-G2', makeHandlers());

    const env = {
      type: 'swipe',
      startX: 0, startY: 0, endX: 100, endY: 100,
      width: 390, height: 844, duration: 250,
    };
    ws.emit('message', JSON.stringify(env));
    await new Promise((r) => setImmediate(r));

    expect(inputs.send).toHaveBeenCalledWith('UDID-G2', env);
  });

  it('does NOT route a control envelope through InputService.send', async () => {
    const inputs = makeInputs();
    const svc = new SimulatorStreamService({ inputs });
    const ws = new FakeSocket();
    const handlers = makeHandlers();
    svc.handleBrowserConnection(ws as any, 'UDID-G3', handlers);

    ws.emit('message', JSON.stringify({ type: 'set_fps', fps: 30 }));
    await new Promise((r) => setImmediate(r));

    expect(handlers.onFps).toHaveBeenCalledWith(30);
    expect(inputs.send).not.toHaveBeenCalled();
  });

  it('drops gesture envelopes (no throw) when no InputService is configured', async () => {
    // Spy console.warn so the drop is observable but doesn't dirty the log.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const svc = new SimulatorStreamService();
    const ws = new FakeSocket();
    svc.handleBrowserConnection(ws as any, 'UDID-G4', makeHandlers());

    expect(() => {
      ws.emit('message', JSON.stringify({
        type: 'tap', x: 1, y: 2, width: 10, height: 10,
      }));
    }).not.toThrow();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
