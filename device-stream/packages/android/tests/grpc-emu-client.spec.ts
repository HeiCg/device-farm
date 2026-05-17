/**
 * GrpcEmuClient unit tests (Phase 33 / T-33.6 / Wave 4).
 *
 * Mirror of device-stream/packages/ios-simulator/tests/sim-capture-private-client.spec.ts
 * with Phase-33 deltas:
 *   - 0x03 inbound metadata frame -> JSON {type:'metadata',width,height,fps,codec:'h264'}
 *   - 0xC2 outbound key frame (9-byte payload)
 *   - Outbound 0x01/0x02 forwarded to WS as base64 envelopes
 *
 * Wire-format reference:
 *   device-stream/native-servers/android-grpc/ipc/framer.go
 *   33-02-SUMMARY.md (Wave 2 byte-for-byte cross-check with Phase 32 fixture)
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Test plumbing: fake socket + fake process used to drive the parse loop
// without touching the real filesystem or spawning a child.
// ---------------------------------------------------------------------------

class FakeSocket extends EventEmitter {
  destroyed = false;
  written: Buffer[] = [];
  write(chunk: Buffer | string): boolean {
    const b = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    this.written.push(Buffer.from(b));
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

class FakeWebSocket extends EventEmitter {
  readyState = 1; // OPEN
  sent: string[] = [];
  send(data: string): void { this.sent.push(data); }
}

/** Build a single [u32 BE length][u8 kind][payload] wire frame. */
function frame(kind: number, payload: Buffer): Buffer {
  const out = Buffer.alloc(4 + 1 + payload.length);
  out.writeUInt32BE(payload.length + 1, 0);
  out.writeUInt8(kind, 4);
  payload.copy(out, 5);
  return out;
}

/**
 * Construct a GrpcEmuClient bypassing spawn — drives the private ctor via
 * a static test-only helper. Mirrors SimCapturePrivateClient.fromConnectedSocket.
 */
async function makeFakeConnectedClient(ws: FakeWebSocket | null = new FakeWebSocket()) {
  const { GrpcEmuClient } = await import('../src/grpc-emu-client.js');
  const sock = new FakeSocket();
  const proc = new FakeProc();
  const client = (GrpcEmuClient as any).fromConnectedSocket('emu-1', 8554, proc, sock, ws);
  return { client, sock, proc, ws };
}

// ---------------------------------------------------------------------------
// 1) Outbound 0xC1 touch — byte-exact wire format
// ---------------------------------------------------------------------------

describe('GrpcEmuClient outbound framer', () => {
  it('encodes 0xC1 touch as exactly 34 bytes [4 length][1 kind][29 payload]', async () => {
    const { client, sock } = await makeFakeConnectedClient();

    client.sendTouch({ xRatio: 0.5, yRatio: 0.25, phase: 0, pressure: 1, id: 42 });

    expect(sock.written.length).toBe(1);
    const w = sock.written[0];
    expect(w.length).toBe(34);
    expect(w.readUInt32BE(0)).toBe(30); // length covers 1 kind + 29 payload
    expect(w.readUInt8(4)).toBe(0xC1);
    expect(w.readDoubleBE(5)).toBeCloseTo(0.5, 12);
    expect(w.readDoubleBE(13)).toBeCloseTo(0.25, 12);
    expect(w.readUInt8(21)).toBe(0); // phase=began
    expect(w.readDoubleBE(22)).toBeCloseTo(1, 12);
    expect(w.readUInt32BE(30)).toBe(42);
  });

  it('encodes 0xC2 key as exactly 14 bytes [4 length][1 kind][9 payload]', async () => {
    const { client, sock } = await makeFakeConnectedClient();

    client.sendKey('down', 0x0007, 0);

    expect(sock.written.length).toBe(1);
    const w = sock.written[0];
    expect(w.length).toBe(14);
    expect(w.readUInt32BE(0)).toBe(10); // length covers 1 kind + 9 payload
    expect(w.readUInt8(4)).toBe(0xC2);
    expect(w.readUInt8(5)).toBe(0); // eventType=down
    expect(w.readUInt32BE(6)).toBe(0x0007);
    expect(w.readUInt32BE(10)).toBe(0); // modMask
  });

  it('sendTouchAtPixel computes ratios = pixel / (display - 1)', async () => {
    const { client, sock } = await makeFakeConnectedClient();

    // 540x960 within a 1080x1920 logical display -> ratios 0.5 each.
    client.sendTouchAtPixel(540, 960, 1081, 1921, { phase: 0, pressure: 1, id: 0 });

    expect(sock.written.length).toBe(1);
    const w = sock.written[0];
    expect(w.readDoubleBE(5)).toBeCloseTo(0.5, 12);
    expect(w.readDoubleBE(13)).toBeCloseTo(0.5, 12);
  });
});

// ---------------------------------------------------------------------------
// 2) Inbound parser — 0x02 AU, 0x03 metadata, 0x01 paramSets replay
// ---------------------------------------------------------------------------

describe('GrpcEmuClient inbound parser', () => {
  it('forwards 0x02 H.264 AU to WS as base64 frame envelope', async () => {
    const { sock, ws } = await makeFakeConnectedClient();

    const au = Buffer.alloc(64);
    au.writeUInt32BE(64 - 4, 0);
    au[4] = 0x65; // IDR NAL header
    for (let i = 5; i < au.length; i++) au[i] = (i * 11) & 0xff;
    sock.emit('data', frame(0x02, au));

    expect(ws.sent.length).toBe(1);
    const env = JSON.parse(ws.sent[0]);
    expect(env.type).toBe('frame');
    expect(env.data).toBe(au.toString('base64'));
  });

  it('forwards 0x03 metadata as JSON {type:metadata,width,height,fps,codec:h264}', async () => {
    const { sock, ws } = await makeFakeConnectedClient();

    // 12-byte payload: [u32 BE width=1080][u32 BE height=1920][u32 BE fps=30]
    const meta = Buffer.alloc(12);
    meta.writeUInt32BE(1080, 0);
    meta.writeUInt32BE(1920, 4);
    meta.writeUInt32BE(30, 8);
    sock.emit('data', frame(0x03, meta));

    expect(ws.sent.length).toBe(1);
    const env = JSON.parse(ws.sent[0]);
    expect(env).toEqual({ type: 'metadata', width: 1080, height: 1920, fps: 30, codec: 'h264' });
  });

  it('forwards 0x01 SPS+PPS as paramSets envelope and caches for replay', async () => {
    const { sock, ws } = await makeFakeConnectedClient();

    const paramSets = Buffer.from([0x01, 0x42, 0xc0, 0x1e, 0xff, 0xe1, 0x00, 0x05]);
    sock.emit('data', frame(0x01, paramSets));

    expect(ws.sent.length).toBe(1);
    const env = JSON.parse(ws.sent[0]);
    expect(env.type).toBe('paramSets');
    expect(env.data).toBe(paramSets.toString('base64'));

    // Late-joining WS gets the cached blob via replayParamSets().
    const lateWs = new FakeWebSocket();
    // We don't have the client reference handy via destructure when using sock-only — re-grab via import.
    const { GrpcEmuClient } = await import('../src/grpc-emu-client.js');
    // We need to call replayParamSets on the client created above.
    // Recreate the test with explicit client reference:
  });

  it('caches 0x01 SPS+PPS and replays to late-joining WS clients', async () => {
    const { client, sock } = await makeFakeConnectedClient();

    const paramSets = Buffer.from([0x01, 0x42, 0xc0, 0x1e, 0xff, 0xe1, 0x00, 0x05]);
    sock.emit('data', frame(0x01, paramSets));

    const lateWs = new FakeWebSocket();
    client.replayParamSets(lateWs as any);

    expect(lateWs.sent.length).toBe(1);
    const env = JSON.parse(lateWs.sent[0]);
    expect(env.type).toBe('paramSets');
    expect(env.data).toBe(paramSets.toString('base64'));
  });
});

// ---------------------------------------------------------------------------
// 3) Spawn failure paths (binary missing / daemon exits early)
// ---------------------------------------------------------------------------

describe('GrpcEmuClient.spawn failure paths', () => {
  it('rejects when binary path does not exist (ENOENT)', async () => {
    const { GrpcEmuClient } = await import('../src/grpc-emu-client.js');
    await expect(
      GrpcEmuClient.spawn('emu-x', 8554, null, {
        binaryPath: '/definitely/does/not/exist/android-grpc-stream',
        spawnTimeoutMs: 50,
      })
    ).rejects.toThrow(/binary/i);
  });

  it('rejects when daemon exits before socket appears (real binary that exits 1)', async () => {
    // Strategy: point binaryPath at /bin/false (always exits non-zero) and a
    // socket path that will never materialize. The spawn() loop should
    // observe the early exit and reject within spawnTimeoutMs.
    const fakeSocket = `/tmp/grpc-emu-client-spec-${Date.now()}.sock`;
    // Best-effort cleanup if a previous run left the file behind.
    try { fs.unlinkSync(fakeSocket); } catch { /* ignore */ }

    const { GrpcEmuClient } = await import('../src/grpc-emu-client.js');
    await expect(
      GrpcEmuClient.spawn('emu-y', 8554, null, {
        binaryPath: '/usr/bin/false',
        socketPath: fakeSocket,
        spawnTimeoutMs: 500,
      })
    ).rejects.toThrow(/exited|socket/i);
  });
});
