/**
 * Node-side client for the sim-capture-private daemon (Phase 32, SimulatorKit private bridge).
 *
 * Wire format (mirrors device-stream/native-servers/sim-capture-private/Sources/IpcServer.mm):
 *
 *   Frame on the wire: [u32 BE length][u8 kind][payload]
 *     where `length` = 1 + payload.length (covers kind byte + payload bytes).
 *
 * Server -> client kinds:
 *   0x01 = SPS+PPS avcC paramSet blob
 *   0x02 = H.264 access unit (AVCC NAL bytes — length-prefixed inside, per VT default)
 *   0x10 = ack (ignored)
 *   0xFF = error (UTF-8 message)
 *
 * Client -> server kinds:
 *   0xC1 = touch
 *          payload (29 bytes): [f64 BE x_ratio][f64 BE y_ratio][u8 phase]
 *                              [f64 BE pressure][u32 BE touchId]
 *   0xC9 = quit (empty payload)
 *
 * Lifecycle:
 *   - `SimCapturePrivateClient.spawn(udid, opts?)` launches the daemon
 *     (`sim-capture-private --udid <UDID> --socket <path>`), waits for the
 *     Unix socket file to appear, opens a SOCK_STREAM client, and returns a
 *     ready instance. Emits `frame` events thereafter (matching the AVCC
 *     EventEmitter contract used by CaptureService.startAvccCapture).
 *   - Falls back to CaptureService.startAvccCapture when this client cannot
 *     be spawned or the daemon dies — that fallback wiring lives in
 *     capture-service.ts. This file is unconditional Node-side IPC.
 *
 * Env opt-out: DEVICE_STREAM_SIM_PRIVATE=0 — gate is enforced in capture-service.ts.
 */

import { EventEmitter } from 'events';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import { ChildProcess, spawn } from 'child_process';
import type { AvccFrameKind } from '@device-stream/core';

// Daemon binary path: device-stream/bin/sim-capture-private, relative to the
// compiled location of this file (packages/ios-simulator/dist/sim-capture-private-client.js).
const DEFAULT_BINARY_PATH = path.resolve(__dirname, '../../../bin/sim-capture-private');

export interface SimCapturePrivateOptions {
  /** Override the daemon binary path (default: device-stream/bin/sim-capture-private). */
  binaryPath?: string;
  /** Override the Unix-socket path (default: /tmp/device-stream-sim-<udid>.sock). */
  socketPath?: string;
  /** Time to wait for the socket file to appear after spawn (default 5000ms). */
  spawnTimeoutMs?: number;
}

export interface SimCapturePrivateFrameEvent {
  udid: string;
  kind: AvccFrameKind;
  payload: Buffer;
}

export class SimCapturePrivateClient extends EventEmitter {
  private _stopped = false;
  private _paramSetsSeen = false;

  private constructor(
    private readonly _udid: string,
    private readonly _proc: ChildProcess,
    private readonly _sock: net.Socket,
  ) {
    super();
    this._attachParseLoop();
    this._attachProcessGuards();
  }

  /** Public read-only accessors for testing/observability. */
  get udid(): string { return this._udid; }
  get socket(): net.Socket { return this._sock; }
  get process(): ChildProcess { return this._proc; }

  /**
   * Spawn the sim-capture-private daemon for `udid`, wait for its Unix socket
   * to appear, open a SOCK_STREAM connection, and return a wired client.
   *
   * Rejects with an Error if the binary is missing, the daemon exits before
   * the socket appears, the timeout elapses, or the socket connection fails.
   * Callers should catch and fall back to the AVCC path.
   */
  static async spawn(udid: string, options: SimCapturePrivateOptions = {}): Promise<SimCapturePrivateClient> {
    const binaryPath = options.binaryPath ?? DEFAULT_BINARY_PATH;
    const timeoutMs = options.spawnTimeoutMs ?? 5000;
    const socketPath = options.socketPath ?? `/tmp/device-stream-sim-${udid.toLowerCase()}.sock`;

    if (!fs.existsSync(binaryPath)) {
      throw new Error(`sim-capture-private not found at ${binaryPath}`);
    }

    // Best-effort: clean a stale socket from a prior crash. The daemon also
    // unlinks before bind, but doing it on the Node side too costs nothing.
    try { fs.unlinkSync(socketPath); } catch { /* ignore — file may not exist */ }

    const proc = spawn(binaryPath, ['--udid', udid, '--socket', socketPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (text) console.error('[sim-capture-private %s] %s', udid, text);
    });

    // Wait for the socket file to materialize OR the child to exit OR timeout.
    const start = Date.now();
    while (!fs.existsSync(socketPath)) {
      if (proc.exitCode !== null) {
        throw new Error(`sim-capture-private exited with code ${proc.exitCode} before socket appeared`);
      }
      if (Date.now() - start > timeoutMs) {
        try { proc.kill('SIGTERM'); } catch { /* ignore */ }
        throw new Error(`sim-capture-private socket never appeared within ${timeoutMs}ms`);
      }
      await new Promise<void>((r) => setTimeout(r, 50));
    }

    const sock = await new Promise<net.Socket>((resolve, reject) => {
      const s = net.createConnection(socketPath);
      const onErr = (e: Error) => { try { s.destroy(); } catch {} reject(e); };
      s.once('error', onErr);
      s.once('connect', () => { s.removeListener('error', onErr); resolve(s); });
    });

    return new SimCapturePrivateClient(udid, proc, sock);
  }

  /**
   * Test-only constructor: wrap a pre-existing socket + child process
   * without spawning. Mirrors DSIpcServer.initWithConnectedFd: on the
   * daemon side and lets unit tests drive the parser without filesystem.
   */
  static fromConnectedSocket(udid: string, proc: ChildProcess, sock: net.Socket): SimCapturePrivateClient {
    return new SimCapturePrivateClient(udid, proc, sock);
  }

  /**
   * Parse loop: maintains a rolling buffer; pulls one [u32 BE length][u8 kind][payload]
   * frame at a time and dispatches a `frame` event with an `AvccFrameKind`-shaped envelope
   * so downstream consumers (stream-service.ts) don't change.
   *
   * Kind mapping (sim-capture-private -> AvccFrameKind):
   *   0x01 -> 'avcc'         (SPS+PPS init blob)
   *   0x02 -> 'keyframe' | 'delta'
   *           Decided by reading the first NAL unit type inside the AVCC payload:
   *           AVCC NAL = [u32 BE nal_length][nal_byte_0 ...]. nal_unit_type = nal_byte_0 & 0x1F.
   *           Type 5 = IDR (keyframe); anything else = delta.
   *   0x10 -> ignored (ack)
   *   0xFF -> 'error' event with the UTF-8 payload as the message
   */
  private _attachParseLoop(): void {
    let buf: Buffer = Buffer.alloc(0);
    this._sock.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 4) {
        const length = buf.readUInt32BE(0);
        // 16 MiB ceiling matches startAvccCapture's defensive limit.
        if (length === 0 || length > 16 * 1024 * 1024) {
          console.error('[SimCapturePrivate] invalid frame length %d for %s', length, this._udid);
          this.stop();
          return;
        }
        if (buf.length < 4 + length) break;
        const kind = buf[4];
        // Copy out the payload so emitted listeners don't share the rolling buffer.
        const payload = Buffer.from(buf.subarray(5, 4 + length));
        buf = buf.subarray(4 + length);

        let avccKind: AvccFrameKind | null = null;
        if (kind === 0x01) {
          avccKind = 'avcc';
          this._paramSetsSeen = true;
        } else if (kind === 0x02) {
          // Inspect first NAL unit type to distinguish IDR (keyframe) from non-IDR (delta).
          // AVCC: 4-byte length + 1-byte NAL header. nal_unit_type = byte & 0x1F.
          // Type 5 = IDR slice (keyframe); Type 1 = non-IDR (delta).
          if (payload.length >= 5) {
            const nalType = payload[4] & 0x1F;
            avccKind = nalType === 5 ? 'keyframe' : 'delta';
          } else {
            // Too short to inspect — treat the first AU after paramSets as keyframe.
            avccKind = this._paramSetsSeen ? 'keyframe' : 'delta';
            this._paramSetsSeen = false;
          }
        } else if (kind === 0xFF) {
          this.emit('error', new Error(payload.toString('utf8')));
          continue;
        } else if (kind === 0x10) {
          continue;  // ack — silently drop
        } else {
          console.warn('[SimCapturePrivate] unknown frame kind 0x%s for %s', kind.toString(16), this._udid);
          continue;
        }

        if (avccKind) {
          const event: SimCapturePrivateFrameEvent = { udid: this._udid, kind: avccKind, payload };
          this.emit('frame', event);
        }
      }
    });

    this._sock.on('error', (err: Error) => {
      console.error('[SimCapturePrivate] socket error for %s: %s', this._udid, err.message);
      this.emit('socket-error', err);
    });
  }

  private _attachProcessGuards(): void {
    this._proc.on('exit', (code, signal) => {
      this.emit('exit', { code, signal });
    });
    this._sock.on('close', () => this.emit('close'));
  }

  /**
   * Send a touch event to the daemon. Coordinates are normalized 0..1 ratios
   * (transform to device pixels happens on the daemon side using
   * SimDeviceScreen.bounds, per 32-BRIEF risk mitigation).
   *
   * Wire layout (29-byte payload, big-endian throughout):
   *   [f64 x_ratio][f64 y_ratio][u8 phase][f64 pressure][u32 touchId]
   * Phase enum:
   *   0 = down, 1 = move, 2 = up, 3 = cancel.
   */
  sendTouch(x: number, y: number, phase: 0 | 1 | 2 | 3, pressure = 1.0, touchId = 0): void {
    const payload = Buffer.alloc(29);
    payload.writeDoubleBE(x, 0);
    payload.writeDoubleBE(y, 8);
    payload.writeUInt8(phase, 16);
    payload.writeDoubleBE(pressure, 17);
    payload.writeUInt32BE(touchId, 25);
    this._writeFrame(0xC1, payload);
  }

  /**
   * Send a quit frame (0xC9, empty payload) so the daemon performs an orderly
   * teardown (bridge_detach + exit). Always called by stop() before the
   * destructive close.
   */
  private _sendQuit(): void {
    this._writeFrame(0xC9, Buffer.alloc(0));
  }

  /**
   * Write a single framed message: [u32 BE length][u8 kind][payload]
   * where length = 1 + payload.length.
   */
  private _writeFrame(kind: number, payload: Buffer): void {
    const lengthField = payload.length + 1;
    const buf = Buffer.alloc(4 + lengthField);
    buf.writeUInt32BE(lengthField, 0);
    buf.writeUInt8(kind, 4);
    if (payload.length > 0) {
      payload.copy(buf, 5);
    }
    try {
      this._sock.write(buf);
    } catch (err) {
      console.error('[SimCapturePrivate] write failed for %s kind=0x%s: %s',
        this._udid, kind.toString(16), (err as Error).message);
    }
  }

  /**
   * Idempotent teardown: send a polite 0xC9 quit, destroy the socket, then
   * SIGTERM the child. Safe to call from exit handlers and from CaptureService
   * fallback paths.
   */
  stop(): void {
    if (this._stopped) return;
    this._stopped = true;
    try { this._sendQuit(); } catch { /* socket may already be dead */ }
    try { this._sock.destroy(); } catch { /* ignore */ }
    try { this._proc.kill('SIGTERM'); } catch { /* ignore */ }
  }
}
