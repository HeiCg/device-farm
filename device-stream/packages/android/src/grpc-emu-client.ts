/**
 * Node-side client for the android-grpc-stream daemon (Phase 33, Android gRPC
 * EmulatorController bridge).
 *
 * This file mirrors device-stream/packages/ios-simulator/src/sim-capture-private-client.ts
 * with three Phase-33 deltas:
 *   - Spawn args: `--serial <s> --grpc-port <p> --socket <path>` (vs sim's `--udid` + `--socket`)
 *   - Default socket: /tmp/device-stream-android-emu-<serial>.sock
 *   - Additive frame kinds: 0x03 inbound metadata + 0xC2 outbound key
 *
 * Wire format (mirrors device-stream/native-servers/android-grpc/ipc/framer.go):
 *
 *   On the wire: [u32 BE length][u8 kind][payload]   where length = 1 + len(payload).
 *
 * Server -> client kinds:
 *   0x01 = SPS+PPS avcC paramSet blob
 *   0x02 = H.264 access unit (AVCC NAL bytes)
 *   0x03 = metadata [u32 BE width][u32 BE height][u32 BE fps]   (12 bytes)
 *   0x10 = ack (ignored)
 *   0xFF = error (UTF-8 message)
 *
 * Client -> server kinds:
 *   0xC1 = touch (29 bytes): [f64 BE x_ratio][f64 BE y_ratio][u8 phase]
 *                            [f64 BE pressure][u32 BE touchId]
 *   0xC2 = key (9 bytes):    [u8 eventType (0=down,1=up)][u32 BE keyCode][u32 BE modMask]
 *   0xC9 = quit (empty)
 *
 * Lifecycle:
 *   - `GrpcEmuClient.spawn(serial, grpcPort, ws, opts?)` launches the daemon,
 *     waits for the Unix socket to appear, opens a SOCK_STREAM client, and
 *     resolves with a ready instance. Inbound frames forward to the provided
 *     WebSocket as JSON envelopes.
 *   - Caller (service.ts) falls back to ScrcpyService when this client cannot
 *     be spawned. This file is unconditional Node-side IPC.
 *
 * Env opt-out: DEVICE_STREAM_ANDROID_GRPC=0 — enforced in service.ts.
 */

import { EventEmitter } from 'events';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import { ChildProcess, spawn } from 'child_process';
import type { WebSocket } from 'ws';

// The daemon binary is produced by Wave 5's build script and lives under
// device-stream/native-servers/android-grpc/bin/. Compiled JS for this module
// lands at packages/android/dist/grpc-emu-client.js, so we walk up three dirs
// to reach the package root, then sideways into native-servers/.
const DEFAULT_BINARY_PATH = path.resolve(
  __dirname,
  '../../../native-servers/android-grpc/bin/android-grpc-stream',
);

export interface GrpcEmuClientOptions {
  /** Override the daemon binary path. */
  binaryPath?: string;
  /** Override the Unix-socket path (default: /tmp/device-stream-android-emu-<serial>.sock). */
  socketPath?: string;
  /** Time to wait for the socket file to appear after spawn (default 5000ms). */
  spawnTimeoutMs?: number;
}

export interface GrpcEmuTouch {
  xRatio: number;
  yRatio: number;
  /** 0=began, 1=moved, 2=ended, 3=cancelled — matches kittyfarm phase enum. */
  phase: 0 | 1 | 2 | 3;
  pressure: number;
  id: number;
}

export interface GrpcEmuMetadata {
  width: number;
  height: number;
  fps: number;
}

/**
 * GrpcEmuClient — Node-side adapter for android-grpc-stream daemon.
 *
 * Public events:
 *   'frame'      Buffer       — 0x02 H.264 AU bytes (also forwarded to WS)
 *   'paramSets'  Buffer       — 0x01 SPS+PPS bytes (also forwarded + cached)
 *   'metadata'   GrpcEmuMetadata — 0x03 width/height/fps (also forwarded to WS)
 *   'error'      Error        — 0xFF daemon error message or socket error
 *   'spawn-failed' Error      — daemon exited BEFORE first frame (caller fallback case)
 *   'crashed'    Error        — daemon exited AFTER first frame (caller propagates)
 *   'close'                   — socket closed
 */
export class GrpcEmuClient extends EventEmitter {
  private _stopped = false;
  private _firstFrameSeen = false;
  private _cachedParamSets: Buffer | null = null;
  private _readBuf: Buffer = Buffer.alloc(0);

  private constructor(
    private readonly _serial: string,
    private readonly _grpcPort: number,
    private readonly _proc: ChildProcess,
    private readonly _sock: net.Socket,
    private readonly _ws: WebSocket | null,
  ) {
    super();
    this._attachParseLoop();
    this._attachProcessGuards();
  }

  /** Public read-only accessors for tests/observability. */
  get serial(): string { return this._serial; }
  get grpcPort(): number { return this._grpcPort; }

  /**
   * Spawn the android-grpc-stream daemon, wait for its Unix socket to appear,
   * open a SOCK_STREAM connection, and return a wired client.
   *
   * Rejects on missing binary, daemon early exit, socket-appear timeout, or
   * socket connection error. Callers (service.ts) catch and fall back to scrcpy.
   */
  static async spawn(
    serial: string,
    grpcPort: number,
    ws: WebSocket | null,
    opts: GrpcEmuClientOptions = {},
  ): Promise<GrpcEmuClient> {
    const binaryPath = opts.binaryPath ?? DEFAULT_BINARY_PATH;
    const socketPath = opts.socketPath ?? `/tmp/device-stream-android-emu-${serial}.sock`;
    const timeoutMs = opts.spawnTimeoutMs ?? 5000;

    if (!fs.existsSync(binaryPath)) {
      throw new Error(
        `GrpcEmuClient: binary missing at ${binaryPath} ` +
        `(DEVICE_STREAM_ANDROID_GRPC build skipped or postinstall failed)`,
      );
    }

    // Best-effort: clean a stale socket from a prior crash. The daemon also
    // unlinks before bind, but doing it on the Node side too costs nothing.
    try { fs.unlinkSync(socketPath); } catch { /* file may not exist */ }

    const proc = spawn(
      binaryPath,
      ['--serial', serial, '--grpc-port', String(grpcPort), '--socket', socketPath],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (text) console.error('[android-grpc-stream %s] %s', serial, text);
    });

    let exitedEarly = false;
    proc.once('exit', (code) => {
      if (!proc.killed && (code ?? 0) !== 0) exitedEarly = true;
    });

    const deadline = Date.now() + timeoutMs;
    while (!fs.existsSync(socketPath)) {
      if (exitedEarly) {
        throw new Error(`GrpcEmuClient: daemon exited before socket appeared`);
      }
      if (Date.now() > deadline) {
        try { proc.kill('SIGKILL'); } catch { /* ignore */ }
        throw new Error(
          `GrpcEmuClient: socket ${socketPath} did not appear within ${timeoutMs}ms`,
        );
      }
      await new Promise<void>((r) => setTimeout(r, 50));
    }

    const sock = await new Promise<net.Socket>((resolve, reject) => {
      const s = net.createConnection(socketPath);
      const onErr = (e: Error) => { try { s.destroy(); } catch { /* ignore */ } reject(e); };
      s.once('error', onErr);
      s.once('connect', () => { s.removeListener('error', onErr); resolve(s); });
    });

    return new GrpcEmuClient(serial, grpcPort, proc, sock, ws);
  }

  /**
   * Test-only constructor: wrap a pre-connected socket + child process without
   * spawning. Mirrors SimCapturePrivateClient.fromConnectedSocket.
   */
  static fromConnectedSocket(
    serial: string,
    grpcPort: number,
    proc: ChildProcess,
    sock: net.Socket,
    ws: WebSocket | null,
  ): GrpcEmuClient {
    return new GrpcEmuClient(serial, grpcPort, proc, sock, ws);
  }

  private _attachParseLoop(): void {
    this._sock.on('data', (chunk: Buffer) => {
      this._readBuf = Buffer.concat([this._readBuf, chunk]);
      while (this._readBuf.length >= 5) {
        const length = this._readBuf.readUInt32BE(0);
        // 16 MiB ceiling — matches the Phase 32 sim client's defensive limit.
        if (length === 0 || length > 16 * 1024 * 1024) {
          console.error('[GrpcEmuClient] invalid frame length %d for %s', length, this._serial);
          this.stop();
          return;
        }
        if (this._readBuf.length < 4 + length) break;
        const kind = this._readBuf.readUInt8(4);
        // Copy the payload so emitted listeners don't share the rolling buffer.
        const payload = Buffer.from(this._readBuf.subarray(5, 4 + length));
        this._readBuf = this._readBuf.subarray(4 + length);
        this._handleFrame(kind, payload);
      }
    });
    this._sock.on('error', (err: Error) => {
      console.error('[GrpcEmuClient] socket error for %s: %s', this._serial, err.message);
      this.emit('error', err);
    });
    this._sock.on('close', () => {
      if (!this._stopped) this.emit('close');
    });
  }

  private _handleFrame(kind: number, payload: Buffer): void {
    switch (kind) {
      case 0x01: { // SPS+PPS paramSets
        this._firstFrameSeen = true;
        this._cachedParamSets = Buffer.from(payload);
        this._wsSend({ type: 'paramSets', data: payload.toString('base64') });
        this.emit('paramSets', payload);
        break;
      }
      case 0x02: { // H.264 AU
        this._firstFrameSeen = true;
        this._wsSend({ type: 'frame', data: payload.toString('base64') });
        this.emit('frame', payload);
        break;
      }
      case 0x03: { // metadata
        if (payload.length === 12) {
          const width = payload.readUInt32BE(0);
          const height = payload.readUInt32BE(4);
          const fps = payload.readUInt32BE(8);
          this._wsSend({ type: 'metadata', width, height, fps, codec: 'h264' });
          this.emit('metadata', { width, height, fps } as GrpcEmuMetadata);
        }
        break;
      }
      case 0x10: // ack — silently drop
        break;
      case 0xFF:
        this.emit('error', new Error(`daemon: ${payload.toString('utf8')}`));
        break;
      default:
        console.warn('[GrpcEmuClient] unknown frame kind 0x%s for %s', kind.toString(16), this._serial);
        break;
    }
  }

  private _wsSend(envelope: object): void {
    if (this._ws == null) return;
    if ((this._ws as any).readyState !== 1 /* OPEN */) return;
    try { (this._ws as any).send(JSON.stringify(envelope)); }
    catch { /* swallow — ws may have closed mid-write */ }
  }

  /** Replay cached SPS+PPS to a late-joining WS client. */
  replayParamSets(ws: WebSocket): void {
    if (this._cachedParamSets == null) return;
    try {
      (ws as any).send(JSON.stringify({
        type: 'paramSets',
        data: this._cachedParamSets.toString('base64'),
      }));
    } catch { /* ignore */ }
  }

  /**
   * Send a 0xC1 touch frame to the daemon. Ratios are normalized 0..1 (the
   * daemon translates to device pixels using display dimensions from gRPC
   * GetStatus, mirroring kittyfarm AndroidEmulatorTouchTranslator).
   */
  sendTouch(t: GrpcEmuTouch): void {
    const payload = Buffer.alloc(29);
    payload.writeDoubleBE(t.xRatio, 0);
    payload.writeDoubleBE(t.yRatio, 8);
    payload.writeUInt8(t.phase, 16);
    payload.writeDoubleBE(t.pressure, 17);
    payload.writeUInt32BE(t.id, 25);
    this._writeFrame(0xC1, payload);
  }

  /**
   * Pixel-coordinate convenience wrapper — computes xRatio/yRatio with
   * `(display - 1)` denominator (matches kittyfarm normalization). Defaults:
   * phase=0 (began), pressure=1, id=0.
   */
  sendTouchAtPixel(
    x: number,
    y: number,
    displayW: number,
    displayH: number,
    opts?: { phase?: 0 | 1 | 2 | 3; pressure?: number; id?: number },
  ): void {
    const xRatio = x / Math.max(1, displayW - 1);
    const yRatio = y / Math.max(1, displayH - 1);
    this.sendTouch({
      xRatio,
      yRatio,
      phase: opts?.phase ?? 0,
      pressure: opts?.pressure ?? 1,
      id: opts?.id ?? 0,
    });
  }

  /**
   * Send a 0xC2 key event frame. eventType:'down' (0) | 'up' (1); keyCode is
   * the Android AKEYCODE_* numeric value; modMask defaults to 0.
   */
  sendKey(eventType: 'down' | 'up', keyCode: number, modMask = 0): void {
    const payload = Buffer.alloc(9);
    payload.writeUInt8(eventType === 'down' ? 0 : 1, 0);
    payload.writeUInt32BE(keyCode, 1);
    payload.writeUInt32BE(modMask, 5);
    this._writeFrame(0xC2, payload);
  }

  private _writeFrame(kind: number, payload: Buffer): void {
    const lengthField = payload.length + 1;
    const buf = Buffer.alloc(4 + lengthField);
    buf.writeUInt32BE(lengthField, 0);
    buf.writeUInt8(kind, 4);
    if (payload.length > 0) payload.copy(buf, 5);
    try {
      this._sock.write(buf);
    } catch (err) {
      console.error(
        '[GrpcEmuClient] write failed for %s kind=0x%s: %s',
        this._serial, kind.toString(16), (err as Error).message,
      );
    }
  }

  private _attachProcessGuards(): void {
    this._proc.on('exit', (code, signal) => {
      this.emit('exit', { code, signal });
      if (this._stopped) return;
      const reason = `daemon exited code=${code} signal=${signal}`;
      if (!this._firstFrameSeen) this.emit('spawn-failed', new Error(reason + ' before first frame'));
      else this.emit('crashed', new Error(reason + ' mid-stream'));
    });
  }

  /**
   * Idempotent teardown: send polite 0xC9 quit, destroy the socket, then
   * SIGTERM the child. Safe to call from exit handlers and fallback paths.
   */
  async stop(): Promise<void> {
    if (this._stopped) return;
    this._stopped = true;
    try { this._writeFrame(0xC9, Buffer.alloc(0)); } catch { /* socket may be dead */ }
    try { this._sock.destroy(); } catch { /* ignore */ }
    if (!this._proc.killed) {
      try { this._proc.kill('SIGTERM'); } catch { /* ignore */ }
      // Give the daemon up to 2s to flush, then SIGKILL if still alive.
      await new Promise<void>((r) => setTimeout(r, 2000));
      if (!this._proc.killed && this._proc.exitCode === null) {
        try { this._proc.kill('SIGKILL'); } catch { /* ignore */ }
      }
    }
  }
}
