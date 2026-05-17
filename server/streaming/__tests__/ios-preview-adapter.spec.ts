import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { IosPreviewAdapter } from '../internal/adapters/ios-preview-adapter.js';

function createMockCaptureService(capturing = false) {
  const emitter = new EventEmitter();
  const service = Object.assign(emitter, {
    isCapturing: vi.fn(() => capturing),
    startCapture: vi.fn(async () => true),
    stopCapture: vi.fn(async () => {}),
    setFrameCallback: vi.fn(),
    cleanup: vi.fn(async () => {}),
  });
  return service;
}

describe('IosPreviewAdapter', () => {
  it('start() registers a listener on frameData event', async () => {
    const service = createMockCaptureService(true);
    const adapter = new IosPreviewAdapter(service as any, 'ABCD-1234');
    adapter.onFrame(() => {});
    await adapter.start('ABCD-1234');

    expect(service.listenerCount('frameData')).toBe(1);
  });

  it('when frameData fires with matching deviceId, onFrame gets decoded JPEG Buffer', async () => {
    const service = createMockCaptureService(true);
    const adapter = new IosPreviewAdapter(service as any, 'ABCD-1234');
    const frames: Buffer[] = [];
    adapter.onFrame((frame) => frames.push(frame));
    await adapter.start('ABCD-1234');

    const jpegBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64');
    service.emit('frameData', 'ABCD-1234', jpegBase64, 390, 844);

    expect(frames).toHaveLength(1);
    expect(Buffer.isBuffer(frames[0])).toBe(true);
    expect(frames[0]).toEqual(Buffer.from(jpegBase64, 'base64'));
  });

  it('when frameData fires with different deviceId, onFrame is NOT called', async () => {
    const service = createMockCaptureService(true);
    const adapter = new IosPreviewAdapter(service as any, 'ABCD-1234');
    const frames: Buffer[] = [];
    adapter.onFrame((frame) => frames.push(frame));
    await adapter.start('ABCD-1234');

    service.emit('frameData', 'OTHER-DEVICE', 'base64data', 390, 844);

    expect(frames).toHaveLength(0);
  });

  it('stop() removes the frame listener', async () => {
    const service = createMockCaptureService(true);
    const adapter = new IosPreviewAdapter(service as any, 'ABCD-1234');
    adapter.onFrame(() => {});
    await adapter.start('ABCD-1234');
    await adapter.stop();

    expect(service.listenerCount('frameData')).toBe(0);
  });

  it('if not already capturing, start() calls startCapture', async () => {
    const service = createMockCaptureService(false); // not capturing
    const adapter = new IosPreviewAdapter(service as any, 'ABCD-1234');
    adapter.onFrame(() => {});
    await adapter.start('ABCD-1234');

    expect(service.startCapture).toHaveBeenCalledWith('ABCD-1234');
  });

  it('if already capturing, start() does NOT call startCapture', async () => {
    const service = createMockCaptureService(true); // already capturing
    const adapter = new IosPreviewAdapter(service as any, 'ABCD-1234');
    adapter.onFrame(() => {});
    await adapter.start('ABCD-1234');

    expect(service.startCapture).not.toHaveBeenCalled();
  });
});
