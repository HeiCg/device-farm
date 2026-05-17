/**
 * SimCapturePrivateClient unit tests (Plan 32-04 / T-32.5).
 *
 * Covers:
 *   - framer round-trips a 0x02 AU frame as a 'keyframe' event (NAL type 5)
 *   - emits frame events in order for paramSets (0x01) + 2 AUs (0x02)
 *   - CaptureService.startCapture does NOT spawn private client when
 *     DEVICE_STREAM_SIM_PRIVATE=0
 *   - CaptureService.startCapture falls back to startAvccCapture when
 *     SimCapturePrivateClient.spawn throws
 *   - sendTouch writes a 34-byte 0xC1 control frame whose payload matches
 *     [f64 BE x][f64 BE y][u8 phase][f64 BE pressure][u32 BE touchId]
 *
 * Wire-format reference: device-stream/native-servers/sim-capture-private/Sources/IpcServer.mm
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// ---------- Fake socket / process plumbing shared across tests ----------

class FakeSocket extends EventEmitter {
  destroyed = false;
  written: Buffer[] = [];
  write(chunk: Buffer | string): boolean {
    const b = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    this.written.push(Buffer.from(b));  // copy so later mutations don't leak
    return true;
  }
  destroy(): void { this.destroyed = true; }
  removeListener(): this { return this; }
}

class FakeProc extends EventEmitter {
  stdin = null as any;
  stdout = new EventEmitter() as any;
  stderr = new EventEmitter() as any;
  exitCode: number | null = null;
  killed = false;
  killSignal: NodeJS.Signals | null = null;
  kill(signal?: NodeJS.Signals | number): boolean {
    this.killed = true;
    this.killSignal = (signal as NodeJS.Signals) ?? 'SIGTERM';
    return true;
  }
}

// Build a single [u32 BE length][u8 kind][payload] wire frame.
function frame(kind: number, payload: Buffer): Buffer {
  const out = Buffer.alloc(4 + 1 + payload.length);
  out.writeUInt32BE(payload.length + 1, 0);
  out.writeUInt8(kind, 4);
  payload.copy(out, 5);
  return out;
}

// ---------- 1) Framer round-trip: single 0x02 AU -> 'keyframe' ----------

describe('SimCapturePrivateClient framer', () => {
  it('round-trips a 0x02 AU frame as a keyframe event (NAL type 5 = IDR)', async () => {
    const { SimCapturePrivateClient } = await import('../src/sim-capture-private-client.js');

    const sock = new FakeSocket();
    const proc = new FakeProc();
    const client = SimCapturePrivateClient.fromConnectedSocket('UDID-1', proc as any, sock as any);

    const frames: Array<{ udid: string; kind: string; payload: Buffer }> = [];
    client.on('frame', (e: any) => frames.push(e));

    // Build a 1024-byte AVCC AU whose first NAL is IDR (type 5).
    // NAL header byte: forbidden_zero=0 | nal_ref_idc=3 | nal_unit_type=5 -> 0x65.
    const payload = Buffer.alloc(1024);
    // First 4 bytes = AVCC NAL length (matches the rest of the payload).
    payload.writeUInt32BE(1024 - 4, 0);
    payload[4] = 0x65;  // NAL header: ref_idc=3, type=5 (IDR)
    // Fill the rest with a deterministic pattern (not important for the test).
    for (let i = 5; i < payload.length; i++) payload[i] = (i * 7) & 0xff;

    sock.emit('data', frame(0x02, payload));

    expect(frames.length).toBe(1);
    expect(frames[0].udid).toBe('UDID-1');
    expect(frames[0].kind).toBe('keyframe');
    expect(frames[0].payload.length).toBe(1024);
    expect(frames[0].payload.equals(payload)).toBe(true);
  });

  it('emits frame events in order for paramSets + 2 AUs (avcc, keyframe, delta)', async () => {
    const { SimCapturePrivateClient } = await import('../src/sim-capture-private-client.js');

    const sock = new FakeSocket();
    const proc = new FakeProc();
    const client = SimCapturePrivateClient.fromConnectedSocket('UDID-2', proc as any, sock as any);

    const frames: Array<{ kind: string; payload: Buffer }> = [];
    client.on('frame', (e: any) => frames.push({ kind: e.kind, payload: e.payload }));

    // Frame 1: paramSets (kind 0x01). Payload is an opaque avcC blob.
    const paramSets = Buffer.from([0x01, 0x42, 0xc0, 0x1e, 0xff, 0xe1, 0x00, 0x05, 0x67, 0x42, 0xc0, 0x1e, 0xff]);

    // Frame 2: AU with IDR first NAL (keyframe). Length-prefixed NAL.
    const idrAu = Buffer.alloc(64);
    idrAu.writeUInt32BE(64 - 4, 0);
    idrAu[4] = 0x65;  // nal_unit_type = 5 (IDR)

    // Frame 3: AU with non-IDR first NAL (delta).
    const deltaAu = Buffer.alloc(48);
    deltaAu.writeUInt32BE(48 - 4, 0);
    deltaAu[4] = 0x41;  // nal_ref_idc=2, nal_unit_type=1 (non-IDR slice)

    // Deliver all 3 frames back-to-back, exercising the multi-frame loop.
    sock.emit('data', Buffer.concat([
      frame(0x01, paramSets),
      frame(0x02, idrAu),
      frame(0x02, deltaAu),
    ]));

    expect(frames.length).toBe(3);
    expect(frames.map(f => f.kind)).toEqual(['avcc', 'keyframe', 'delta']);
    expect(frames[0].payload.equals(paramSets)).toBe(true);
    expect(frames[1].payload.length).toBe(64);
    expect(frames[2].payload.length).toBe(48);
  });
});

// ---------- 2) CaptureService fallback paths ----------

// The fallback tests need to control CaptureService's view of the
// SimCapturePrivateClient module (spawn-throws / never-called). vi.doMock
// re-mocks per test before the dynamic import inside startCapture runs.

describe('CaptureService private-bridge fallback', () => {
  beforeEach(() => {
    delete process.env.DEVICE_STREAM_SIM_PRIVATE;
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.DEVICE_STREAM_SIM_PRIVATE;
    vi.doUnmock('../src/sim-capture-private-client.js');
    vi.doUnmock('fs');
    vi.doUnmock('child_process');
  });

  it('skips the private bridge entirely when DEVICE_STREAM_SIM_PRIVATE=0', async () => {
    process.env.DEVICE_STREAM_SIM_PRIVATE = '0';

    const spawnSpy = vi.fn();
    vi.doMock('../src/sim-capture-private-client.js', () => ({
      SimCapturePrivateClient: { spawn: spawnSpy },
    }));
    // Make the AVCC binary appear present so startAvccCapture actually proceeds.
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return { ...actual, existsSync: vi.fn(() => true) };
    });
    // Stub child_process.spawn so AVCC's spawn returns a fake the test can drive.
    const avccProc = new FakeProc();
    vi.doMock('child_process', () => ({
      spawn: vi.fn(() => avccProc as any),
    }));

    const { CaptureService } = await import('../src/capture-service.js');
    const svc = new CaptureService({ avccBinaryPath: '/fake/sim-capture-avcc' });

    vi.useFakeTimers();
    const p = svc.startCapture('UDID-A', { format: 'avcc' });
    vi.advanceTimersByTime(1100);
    const ok = await p;
    vi.useRealTimers();

    expect(ok).toBe(true);
    // Critical assertion: the private bridge was never asked to spawn.
    expect(spawnSpy).not.toHaveBeenCalled();
    // And AVCC's spawn was invoked (the stub returned avccProc).
    const cp = await import('child_process');
    expect((cp.spawn as any)).toHaveBeenCalled();
  });

  it('falls back to startAvccCapture when SimCapturePrivateClient.spawn throws', async () => {
    // Default-on: env not '0'.
    const spawnSpy = vi.fn(async () => { throw new Error('binary missing'); });
    vi.doMock('../src/sim-capture-private-client.js', () => ({
      SimCapturePrivateClient: { spawn: spawnSpy },
    }));
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return { ...actual, existsSync: vi.fn(() => true) };
    });
    const avccProc = new FakeProc();
    vi.doMock('child_process', () => ({
      spawn: vi.fn(() => avccProc as any),
    }));

    const { CaptureService } = await import('../src/capture-service.js');
    const svc = new CaptureService({ avccBinaryPath: '/fake/sim-capture-avcc' });

    // Don't use fake timers: the async dynamic-import + spawn-throws +
    // fall-through to AVCC needs real microtask sequencing. Instead drive
    // the AVCC binary's resolve by emitting a frame on its stdout.
    const p = svc.startCapture('UDID-B', { format: 'avcc' });
    // Yield one microtask so the dynamic-import + thrown-spawn resolve and
    // startAvccCapture has actually invoked child_process.spawn.
    await new Promise<void>((r) => setImmediate(r));
    // Emit a single AVCC keyframe frame on stdout to resolve the AVCC
    // startCapture's firstFrameResolved gate immediately.
    const payload = Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]);
    const wire = Buffer.alloc(4 + 1 + payload.length);
    wire.writeUInt32BE(1 + payload.length, 0);
    wire[4] = 0x02;
    payload.copy(wire, 5);
    avccProc.stdout.emit('data', wire);
    const ok = await p;

    // Private bridge attempted once and threw -> AVCC path took over -> true.
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(ok).toBe(true);
    const cp = await import('child_process');
    expect((cp.spawn as any)).toHaveBeenCalled();
  });
});

// ---------- 3) sendTouch byte layout ----------

describe('SimCapturePrivateClient.sendTouch', () => {
  it('writes a 34-byte 0xC1 control frame with normalized ratio coords', async () => {
    const { SimCapturePrivateClient } = await import('../src/sim-capture-private-client.js');

    const sock = new FakeSocket();
    const proc = new FakeProc();
    const client = SimCapturePrivateClient.fromConnectedSocket('UDID-T', proc as any, sock as any);

    client.sendTouch(0.5, 0.5, 0, 1.0, 0);

    expect(sock.written.length).toBe(1);
    const w = sock.written[0];
    // 4 length + 1 kind + 29 payload = 34 bytes total.
    expect(w.length).toBe(34);

    // length field covers (kind + payload) = 1 + 29 = 30
    expect(w.readUInt32BE(0)).toBe(30);
    // kind byte
    expect(w[4]).toBe(0xC1);
    // payload layout
    expect(w.readDoubleBE(5)).toBeCloseTo(0.5, 12);     // x_ratio
    expect(w.readDoubleBE(13)).toBeCloseTo(0.5, 12);    // y_ratio
    expect(w[21]).toBe(0);                              // phase=0 (down)
    expect(w.readDoubleBE(22)).toBeCloseTo(1.0, 12);    // pressure
    expect(w.readUInt32BE(30)).toBe(0);                 // touchId
  });
});
