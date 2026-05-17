import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { SimulatorStreamService } from '../src/stream-service.js';

describe('SimulatorStreamService control channel', () => {
  it('invokes onFps when a set_fps text frame arrives', () => {
    const svc = new SimulatorStreamService();
    const onFps = vi.fn();
    const handlers = {
      onFps,
      onBitrate: vi.fn(),
      onScale: vi.fn(),
      onForceIdr: vi.fn(),
      onSnapshot: vi.fn(),
    };
    const fake = makeFakeSocket();
    svc.handleBrowserConnection(fake as any, 'UDID-123', handlers);
    fake.emit('message', JSON.stringify({ type: 'set_fps', fps: 30 }));
    expect(onFps).toHaveBeenCalledWith(30);
  });

  it('invokes onForceIdr on a force_idr text frame', () => {
    const svc = new SimulatorStreamService();
    const onForceIdr = vi.fn();
    const handlers = {
      onFps: vi.fn(), onBitrate: vi.fn(), onScale: vi.fn(),
      onForceIdr, onSnapshot: vi.fn(),
    };
    const fake = makeFakeSocket();
    svc.handleBrowserConnection(fake as any, 'UDID-456', handlers);
    fake.emit('message', JSON.stringify({ type: 'force_idr' }));
    expect(onForceIdr).toHaveBeenCalledOnce();
  });

  it('ignores gesture envelopes (Phase D wires them)', () => {
    const svc = new SimulatorStreamService();
    const handlers = {
      onFps: vi.fn(), onBitrate: vi.fn(), onScale: vi.fn(),
      onForceIdr: vi.fn(), onSnapshot: vi.fn(),
    };
    const fake = makeFakeSocket();
    svc.handleBrowserConnection(fake as any, 'UDID-789', handlers);
    fake.emit('message', JSON.stringify({
      type: 'tap', x: 100, y: 200, width: 438, height: 954,
    }));
    expect(handlers.onFps).not.toHaveBeenCalled();
  });
});

class FakeSocket extends EventEmitter {
  readyState = 1;
  send(_: any) {}
  close() {}
}
function makeFakeSocket(): FakeSocket {
  return new FakeSocket();
}
