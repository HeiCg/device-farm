import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DevicePreviewManager, type DeviceStreamAdapter, type AdapterFactory } from '../internal/device-preview.js';
import type pino from 'pino';

function createMockLogger(): pino.Logger {
  return {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as pino.Logger;
}

function createMockAdapter(): DeviceStreamAdapter & {
  _frameHandler: ((frame: Buffer) => void) | null;
  _emitFrame: (frame: Buffer) => void;
} {
  let frameHandler: ((frame: Buffer) => void) | null = null;
  return {
    _frameHandler: null,
    start: vi.fn().mockResolvedValue(undefined),
    onFrame(handler: (frame: Buffer) => void) {
      frameHandler = handler;
      this._frameHandler = handler;
    },
    stop: vi.fn().mockResolvedValue(undefined),
    _emitFrame(frame: Buffer) {
      frameHandler?.(frame);
    },
  };
}

describe('DevicePreviewManager', () => {
  let logger: pino.Logger;
  let mockAdapter: ReturnType<typeof createMockAdapter>;
  let adapterFactory: AdapterFactory;
  let manager: DevicePreviewManager;

  beforeEach(() => {
    logger = createMockLogger();
    mockAdapter = createMockAdapter();
    adapterFactory = vi.fn().mockReturnValue(mockAdapter) as unknown as AdapterFactory;
    manager = new DevicePreviewManager(logger, adapterFactory);
  });

  it('startPreview() creates adapter and starts it', async () => {
    await manager.startPreview('emulator-5554', 'android');

    expect(adapterFactory).toHaveBeenCalledWith('emulator-5554', 'android');
    expect(mockAdapter.start).toHaveBeenCalledWith('emulator-5554');
  });

  it('subscribe() receives frames when adapter emits', async () => {
    await manager.startPreview('emulator-5554', 'android');

    const handler = vi.fn();
    manager.subscribe('emulator-5554', handler);

    const frame = Buffer.from('fake-frame-data');
    mockAdapter._emitFrame(frame);

    expect(handler).toHaveBeenCalledWith(frame);
  });

  it('multiple subscribers all receive same frame', async () => {
    await manager.startPreview('emulator-5554', 'android');

    const handler1 = vi.fn();
    const handler2 = vi.fn();
    manager.subscribe('emulator-5554', handler1);
    manager.subscribe('emulator-5554', handler2);

    const frame = Buffer.from('shared-frame');
    mockAdapter._emitFrame(frame);

    expect(handler1).toHaveBeenCalledWith(frame);
    expect(handler2).toHaveBeenCalledWith(frame);
  });

  it('unsubscribe removes the handler', async () => {
    await manager.startPreview('emulator-5554', 'android');

    const handler = vi.fn();
    const unsubscribe = manager.subscribe('emulator-5554', handler);

    unsubscribe();

    const frame = Buffer.from('after-unsub');
    mockAdapter._emitFrame(frame);

    expect(handler).not.toHaveBeenCalled();
  });

  it('subscribe on unknown deviceId returns no-op unsubscribe', () => {
    const handler = vi.fn();
    const unsubscribe = manager.subscribe('unknown-device', handler);

    // Should not throw, returns a function
    expect(typeof unsubscribe).toBe('function');
    unsubscribe(); // no-op, should not throw
  });

  it('stopPreview() stops adapter and cleans up subscribers', async () => {
    await manager.startPreview('emulator-5554', 'android');

    const handler = vi.fn();
    manager.subscribe('emulator-5554', handler);

    await manager.stopPreview('emulator-5554');

    expect(mockAdapter.stop).toHaveBeenCalled();

    // After stop, getFrameStream returns null
    expect(manager.getFrameStream('emulator-5554')).toBeNull();
  });

  it('getFrameStream() returns adapter for active device', async () => {
    await manager.startPreview('emulator-5554', 'android');

    const stream = manager.getFrameStream('emulator-5554');
    expect(stream).toBe(mockAdapter);
  });

  it('getFrameStream() returns null for unknown device', () => {
    expect(manager.getFrameStream('unknown')).toBeNull();
  });

  it('startPreview() throws if already streaming for same device', async () => {
    await manager.startPreview('emulator-5554', 'android');

    await expect(
      manager.startPreview('emulator-5554', 'android'),
    ).rejects.toThrow(/already streaming/i);
  });

  it('stopPreview() on unknown device is a no-op', async () => {
    // Should not throw
    await manager.stopPreview('unknown-device');
  });
});
