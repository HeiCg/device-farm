/**
 * AndroidStreamingService selection rule + device-service tap/key routing
 * (Phase 33 / T-33.6 + T-33.7 / Wave 4).
 *
 * Selection rule (matches 33-RESEARCH.md §TS service swap):
 *   1. device.kind !== 'emulator'        -> scrcpy
 *   2. device.grpcPort == null           -> scrcpy
 *   3. DEVICE_STREAM_ANDROID_GRPC === '0' -> scrcpy
 *   4. otherwise try GrpcEmuClient.spawn; on rejection log.warn + fall back to scrcpy
 *
 * Touch/key routing:
 *   - tap(serial,...) -> session.client.sendTouchAtPixel when session.kind==='grpc'
 *   - pressKey(serial,...) -> session.client.sendKey when session.kind==='grpc'
 *   - typeText ALWAYS routes to ADB (proto subset has no sendText)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock GrpcEmuClient at module level so the service code-path under test
// resolves to a spy.
// ---------------------------------------------------------------------------

const spawnSpy = vi.fn();
vi.mock('../src/grpc-emu-client', () => {
  return {
    GrpcEmuClient: {
      spawn: (...args: unknown[]) => spawnSpy(...args),
    },
  };
});

// Mock scrcpy-service so we don't try to reach a real adb device.
const scrcpyStart = vi.fn().mockResolvedValue(undefined);
const scrcpyStop = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/scrcpy-service', () => {
  return {
    ScrcpyService: class {},
    scrcpyService: {
      startStream: scrcpyStart,
      stopStream: scrcpyStop,
      isStreaming: vi.fn(),
      getSession: vi.fn(),
    },
  };
});

beforeEach(() => {
  spawnSpy.mockReset();
  scrcpyStart.mockReset().mockResolvedValue(undefined);
  scrcpyStop.mockReset().mockResolvedValue(undefined);
  delete process.env.DEVICE_STREAM_ANDROID_GRPC;
});

afterEach(() => {
  delete process.env.DEVICE_STREAM_ANDROID_GRPC;
});

// ---------------------------------------------------------------------------
// 1) Selection rule (AND-GRPC-TS)
// ---------------------------------------------------------------------------

describe('AndroidStreamingService selection rule (AND-GRPC-TS)', () => {
  it('uses scrcpy when DEVICE_STREAM_ANDROID_GRPC=0', async () => {
    process.env.DEVICE_STREAM_ANDROID_GRPC = '0';
    const { AndroidStreamingService } = await import('../src/service');
    const svc = new AndroidStreamingService();

    await svc.start({ serial: 'emu-1', kind: 'emulator', grpcPort: 8554 }, {} as any, null);

    expect(spawnSpy).not.toHaveBeenCalled();
    expect(scrcpyStart).toHaveBeenCalledTimes(1);
    expect(svc.getSession('emu-1')?.kind).toBe('scrcpy');
  });

  it('uses scrcpy when device.kind=physical', async () => {
    const { AndroidStreamingService } = await import('../src/service');
    const svc = new AndroidStreamingService();

    await svc.start({ serial: 'phys-1', kind: 'physical', grpcPort: 8554 }, {} as any, null);

    expect(spawnSpy).not.toHaveBeenCalled();
    expect(svc.getSession('phys-1')?.kind).toBe('scrcpy');
  });

  it('uses scrcpy when grpcPort is null', async () => {
    const { AndroidStreamingService } = await import('../src/service');
    const svc = new AndroidStreamingService();

    await svc.start({ serial: 'emu-2', kind: 'emulator', grpcPort: null }, {} as any, null);

    expect(spawnSpy).not.toHaveBeenCalled();
    expect(svc.getSession('emu-2')?.kind).toBe('scrcpy');
  });

  it('falls back to scrcpy when GrpcEmuClient.spawn rejects (binary missing)', async () => {
    spawnSpy.mockRejectedValue(new Error('binary missing'));
    const { AndroidStreamingService } = await import('../src/service');
    const svc = new AndroidStreamingService();

    await expect(
      svc.start({ serial: 'emu-3', kind: 'emulator', grpcPort: 8554 }, {} as any, null),
    ).resolves.toBeUndefined();

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(scrcpyStart).toHaveBeenCalledTimes(1);
    expect(svc.getSession('emu-3')?.kind).toBe('scrcpy');
  });

  it('returns a grpc session on happy path', async () => {
    const fakeClient: any = {
      on: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
      sendTouchAtPixel: vi.fn(),
      sendKey: vi.fn(),
    };
    spawnSpy.mockResolvedValue(fakeClient);

    const { AndroidStreamingService } = await import('../src/service');
    const svc = new AndroidStreamingService();

    await svc.start({ serial: 'emu-4', kind: 'emulator', grpcPort: 8554 }, {} as any, null);

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(scrcpyStart).not.toHaveBeenCalled();
    const sess = svc.getSession('emu-4');
    expect(sess?.kind).toBe('grpc');
    if (sess?.kind === 'grpc') expect(sess.client).toBe(fakeClient);
  });

  it('stop() routes to grpc client.stop when session is grpc', async () => {
    const stopFn = vi.fn().mockResolvedValue(undefined);
    const fakeClient: any = { on: vi.fn(), stop: stopFn };
    spawnSpy.mockResolvedValue(fakeClient);

    const { AndroidStreamingService } = await import('../src/service');
    const svc = new AndroidStreamingService();
    await svc.start({ serial: 'emu-5', kind: 'emulator', grpcPort: 8554 }, {} as any, null);

    await svc.stop('emu-5');

    expect(stopFn).toHaveBeenCalledTimes(1);
    expect(scrcpyStop).not.toHaveBeenCalled();
    expect(svc.getSession('emu-5')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2) tap / pressKey / typeText routing (AND-GRPC-TOUCH)
// ---------------------------------------------------------------------------

describe('AndroidStreamingService.routeTap / routeKey routing (AND-GRPC-TOUCH)', () => {
  it('routeTap calls sendTouchAtPixel twice (down + up) when session is grpc', async () => {
    const sendTouchAtPixel = vi.fn();
    const fakeClient: any = {
      on: vi.fn((event: string, cb: any) => {
        // Capture metadata listener so we can drive display size.
        if (event === 'metadata') (fakeClient as any)._metaCb = cb;
        return fakeClient;
      }),
      stop: vi.fn(),
      sendTouchAtPixel,
      sendKey: vi.fn(),
    };
    spawnSpy.mockResolvedValue(fakeClient);

    const { AndroidStreamingService } = await import('../src/service');
    const svc = new AndroidStreamingService();
    await svc.start({ serial: 'emu-6', kind: 'emulator', grpcPort: 8554 }, {} as any, null);

    // Simulate the daemon's first 0x03 metadata frame populating session.display.
    (fakeClient as any)._metaCb?.({ width: 1080, height: 1920, fps: 30 });

    // ROUTED tap:
    const routed = await svc.routeTap('emu-6', 100, 200);
    expect(routed).toBe(true); // signals "handled by grpc path, ADB skipped"

    expect(sendTouchAtPixel).toHaveBeenCalledTimes(2);
    expect(sendTouchAtPixel).toHaveBeenNthCalledWith(1, 100, 200, 1080, 1920, { phase: 0 });
    expect(sendTouchAtPixel).toHaveBeenNthCalledWith(2, 100, 200, 1080, 1920, { phase: 2 });
  });

  it('routeTap returns false when session is scrcpy (caller falls through to ADB)', async () => {
    const { AndroidStreamingService } = await import('../src/service');
    const svc = new AndroidStreamingService();
    // Force scrcpy path via env opt-out.
    process.env.DEVICE_STREAM_ANDROID_GRPC = '0';
    await svc.start({ serial: 'emu-7', kind: 'emulator', grpcPort: 8554 }, {} as any, null);

    const routed = await svc.routeTap('emu-7', 50, 50);
    expect(routed).toBe(false);
  });

  it('routeKey calls sendKey down then up when session is grpc', async () => {
    const sendKey = vi.fn();
    const fakeClient: any = { on: vi.fn(), stop: vi.fn(), sendTouchAtPixel: vi.fn(), sendKey };
    spawnSpy.mockResolvedValue(fakeClient);

    const { AndroidStreamingService } = await import('../src/service');
    const svc = new AndroidStreamingService();
    await svc.start({ serial: 'emu-8', kind: 'emulator', grpcPort: 8554 }, {} as any, null);

    const routed = await svc.routeKey('emu-8', 4 /* AKEYCODE_BACK */);
    expect(routed).toBe(true);

    expect(sendKey).toHaveBeenCalledTimes(2);
    expect(sendKey).toHaveBeenNthCalledWith(1, 'down', 4);
    expect(sendKey).toHaveBeenNthCalledWith(2, 'up', 4);
  });

  it('routeKey returns false on scrcpy session (caller falls through to ADB)', async () => {
    process.env.DEVICE_STREAM_ANDROID_GRPC = '0';
    const { AndroidStreamingService } = await import('../src/service');
    const svc = new AndroidStreamingService();
    await svc.start({ serial: 'emu-9', kind: 'emulator', grpcPort: 8554 }, {} as any, null);

    const routed = await svc.routeKey('emu-9', 4);
    expect(routed).toBe(false);
  });

  it('routeTap falls back to default 1080x1920 if no metadata frame received', async () => {
    const sendTouchAtPixel = vi.fn();
    const fakeClient: any = {
      on: vi.fn(), // never fire metadata
      stop: vi.fn(),
      sendTouchAtPixel,
      sendKey: vi.fn(),
    };
    spawnSpy.mockResolvedValue(fakeClient);

    const { AndroidStreamingService } = await import('../src/service');
    const svc = new AndroidStreamingService();
    await svc.start({ serial: 'emu-10', kind: 'emulator', grpcPort: 8554 }, {} as any, null);

    await svc.routeTap('emu-10', 540, 960);
    expect(sendTouchAtPixel).toHaveBeenCalledWith(540, 960, 1080, 1920, { phase: 0 });
  });
});
