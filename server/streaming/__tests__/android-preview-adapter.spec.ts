import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AndroidPreviewAdapter } from '../internal/adapters/android-preview-adapter.js';

function createMockScrcpyService(existingOnPacket?: (packet: any) => void) {
  const session: any = { onPacket: existingOnPacket };
  let recordingCallback: ((packet: any) => void) | undefined;

  return {
    service: {
      getSession: vi.fn((serial: string) => session),
      setRecordingCallback: vi.fn((serial: string, cb: any) => {
        recordingCallback = cb;
        session.onPacket = cb;
      }),
      isStreaming: vi.fn(() => true),
      stopStream: vi.fn(),
    },
    session,
    getRecordingCallback: () => recordingCallback,
  };
}

describe('AndroidPreviewAdapter', () => {
  it('start() calls setRecordingCallback with serial and a function', async () => {
    const mock = createMockScrcpyService();
    const adapter = new AndroidPreviewAdapter(mock.service as any, 'emulator-5554');
    adapter.onFrame(() => {});
    await adapter.start('emulator-5554');

    expect(mock.service.setRecordingCallback).toHaveBeenCalledWith(
      'emulator-5554',
      expect.any(Function),
    );
  });

  it('when callback receives data packet, onFrame handler gets Buffer.from(packet.data)', async () => {
    const mock = createMockScrcpyService();
    const adapter = new AndroidPreviewAdapter(mock.service as any, 'emulator-5554');
    const frames: Buffer[] = [];
    adapter.onFrame((frame) => frames.push(frame));
    await adapter.start('emulator-5554');

    const cb = mock.getRecordingCallback()!;
    const packetData = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x65]);
    cb({ type: 'data', data: packetData });

    expect(frames).toHaveLength(1);
    expect(Buffer.isBuffer(frames[0])).toBe(true);
    expect(frames[0]).toEqual(Buffer.from(packetData));
  });

  it('when callback receives configuration packet, onFrame handler also gets it', async () => {
    const mock = createMockScrcpyService();
    const adapter = new AndroidPreviewAdapter(mock.service as any, 'emulator-5554');
    const frames: Buffer[] = [];
    adapter.onFrame((frame) => frames.push(frame));
    await adapter.start('emulator-5554');

    const cb = mock.getRecordingCallback()!;
    const spsData = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x67]);
    cb({ type: 'configuration', data: spsData });

    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual(Buffer.from(spsData));
  });

  it('stop() calls setRecordingCallback(serial, undefined) to remove callback', async () => {
    const mock = createMockScrcpyService();
    const adapter = new AndroidPreviewAdapter(mock.service as any, 'emulator-5554');
    adapter.onFrame(() => {});
    await adapter.start('emulator-5554');
    await adapter.stop();

    expect(mock.service.setRecordingCallback).toHaveBeenLastCalledWith(
      'emulator-5554',
      undefined,
    );
  });

  it('stop() does NOT call stopStream', async () => {
    const mock = createMockScrcpyService();
    const adapter = new AndroidPreviewAdapter(mock.service as any, 'emulator-5554');
    adapter.onFrame(() => {});
    await adapter.start('emulator-5554');
    await adapter.stop();

    expect(mock.service.stopStream).not.toHaveBeenCalled();
  });

  it('callback chaining preserves existing onPacket callback', async () => {
    const existingCalls: any[] = [];
    const existingCallback = (packet: any) => existingCalls.push(packet);
    const mock = createMockScrcpyService(existingCallback);
    const adapter = new AndroidPreviewAdapter(mock.service as any, 'emulator-5554');
    const frames: Buffer[] = [];
    adapter.onFrame((frame) => frames.push(frame));
    await adapter.start('emulator-5554');

    const cb = mock.getRecordingCallback()!;
    const packetData = new Uint8Array([0x01, 0x02]);
    cb({ type: 'data', data: packetData });

    // Both the existing callback and the preview handler should be called
    expect(existingCalls).toHaveLength(1);
    expect(existingCalls[0]).toEqual({ type: 'data', data: packetData });
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual(Buffer.from(packetData));
  });

  it('stop() restores original onPacket callback when one existed', async () => {
    const existingCallback = vi.fn();
    const mock = createMockScrcpyService(existingCallback);
    const adapter = new AndroidPreviewAdapter(mock.service as any, 'emulator-5554');
    adapter.onFrame(() => {});
    await adapter.start('emulator-5554');
    await adapter.stop();

    // Should restore the original callback, not undefined
    expect(mock.service.setRecordingCallback).toHaveBeenLastCalledWith(
      'emulator-5554',
      existingCallback,
    );
  });
});
