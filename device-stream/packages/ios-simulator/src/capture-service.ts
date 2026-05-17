/**
 * iOS Simulator Capture Service.
 *
 * Manages sim-capture (legacy MJPEG ScreenCaptureKit binary) and the
 * Phase-D sim-capture-avcc binary (AVCC H.264 + JPEG seed). Both can be
 * spawned per-device; the format is chosen by `startCapture` options.
 *
 * AVCC binary stdout framing — confirmed by reading main.swift's
 * StdoutWriter: 4-byte big-endian length (covering tag + payload) +
 * 1-byte tag + payload. Tags match protocol-v2's AVCC_TAG (0x01 avcC,
 * 0x02 keyframe, 0x03 delta, 0x04 jpeg-seed).
 */

import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import type { AvccFrameKind } from '@device-stream/core';

export type CaptureFormat = 'mjpeg' | 'avcc';

interface CaptureOptions {
  fps?: number;
  quality?: number; // 0-100 (mjpeg only)
  scale?: number;
  bitrate?: number; // bps (avcc only)
  format?: CaptureFormat;
}

interface CaptureHeader {
  version: number;
  pid: number;
  realWidth: number;
  realHeight: number;
  virtualWidth: number;
  virtualHeight: number;
  orientation: number;
}

interface CaptureInstance {
  process: ChildProcess;
  deviceId: string;
  format: CaptureFormat;
  header?: CaptureHeader;
  frameCount: number;
}

const HEADER_SIZE = 24;

// Default paths to the sim-capture binaries (relative to this package's dist/).
const DEFAULT_MJPEG_BINARY_PATH = path.resolve(__dirname, '../../../tools/sim-capture/.build/release/sim-capture');
const DEFAULT_AVCC_BINARY_PATH  = path.resolve(__dirname, '../../../tools/sim-capture-avcc/.build/release/sim-capture-avcc');

// AVCC tag bytes — duplicated here so we don't take a runtime dep on core's
// non-exported AVCC_TAG constants. Kept in lockstep with protocol-v2.ts.
const TAG_TO_KIND: Record<number, AvccFrameKind> = {
  0x01: 'avcc',
  0x02: 'keyframe',
  0x03: 'delta',
  0x04: 'jpeg-seed',
};

export interface CaptureServiceOptions {
  binaryPath?: string;         // legacy: MJPEG binary path
  mjpegBinaryPath?: string;
  avccBinaryPath?: string;
}

export class CaptureService extends EventEmitter {
  private captures = new Map<string, CaptureInstance>();
  private mjpegBinaryPath: string;
  private avccBinaryPath: string;
  // Per-device tuning targets. When an AVCC child is alive, setters also
  // push JSON lines down its stdin; if no child is running we just queue.
  private targets = new Map<string, { fps?: number; bps?: number; scale?: number; format?: CaptureFormat }>();
  private onFrame: ((deviceId: string, base64Jpeg: string, width: number, height: number) => void) | null = null;

  constructor(options?: string | CaptureServiceOptions) {
    super();
    if (typeof options === 'string') {
      this.mjpegBinaryPath = options;
      this.avccBinaryPath = process.env.DEVICE_STREAM_SIM_CAPTURE_AVCC ?? DEFAULT_AVCC_BINARY_PATH;
    } else {
      this.mjpegBinaryPath = options?.mjpegBinaryPath ?? options?.binaryPath ?? DEFAULT_MJPEG_BINARY_PATH;
      this.avccBinaryPath  = options?.avccBinaryPath  ?? process.env.DEVICE_STREAM_SIM_CAPTURE_AVCC ?? DEFAULT_AVCC_BINARY_PATH;
    }
  }

  /**
   * Set the callback for injecting MJPEG frames into the stream service.
   * (AVCC frames are surfaced via the 'frame' event instead.)
   */
  setFrameCallback(cb: (deviceId: string, base64Jpeg: string, width: number, height: number) => void): void {
    this.onFrame = cb;
  }

  /** Check if the appropriate sim-capture binary exists. */
  isBinaryAvailable(format: CaptureFormat = 'mjpeg'): boolean {
    return fs.existsSync(format === 'avcc' ? this.avccBinaryPath : this.mjpegBinaryPath);
  }

  /**
   * Start capturing a simulator's screen.
   * Returns true if started successfully, false if binary not available or spawn fails.
   */
  async startCapture(deviceId: string, options: CaptureOptions = {}): Promise<boolean> {
    if (this.captures.has(deviceId)) {
      console.log('[SimCapture] Already capturing %s', deviceId);
      return true;
    }

    const format: CaptureFormat = options.format ?? 'mjpeg';
    this.targets.set(deviceId, { ...this.targets.get(deviceId), format });

    // Phase 32: try the SimulatorKit private bridge first when env-enabled
    // AND the caller asked for AVCC. The MJPEG path is unchanged.
    // Opt out with DEVICE_STREAM_SIM_PRIVATE=0.
    const tryPrivate = format === 'avcc' && process.env.DEVICE_STREAM_SIM_PRIVATE !== '0';
    if (tryPrivate) {
      try {
        const { SimCapturePrivateClient } = await import('./sim-capture-private-client.js');
        const client = await SimCapturePrivateClient.spawn(deviceId);
        // Forward 'frame' events to keep the existing AVCC EventEmitter contract.
        client.on('frame', (e) => this.emit('frame', e));
        client.on('exit', (info) => {
          console.warn('[SimCapture] private daemon exited for %s: %o', deviceId, info);
          this.captures.delete(deviceId);
          this.emit('exit', deviceId, info?.code ?? null);
        });
        // Track via the captures map using a synthetic CaptureInstance so
        // stopCapture(deviceId) / isCapturing(deviceId) / getStats(deviceId)
        // all keep working unchanged.
        const fakeProc = {
          kill: (_sig?: NodeJS.Signals | number) => { client.stop(); return true; },
          stdin: null,
          stdout: null,
          stderr: null,
          on: (_e: string, _cb: (...a: any[]) => void) => undefined,
        } as unknown as ChildProcess;
        this.captures.set(deviceId, {
          process: fakeProc,
          deviceId,
          format: 'avcc',
          frameCount: 0,
        });
        // Stash the live client on the instance so stopCapture can stop it
        // cleanly without going through SIGTERM-on-a-fake-process gymnastics.
        (this.captures.get(deviceId) as CaptureInstance & { privateClient?: any }).privateClient = client;
        return true;
      } catch (err) {
        console.warn('[SimCapture] private bridge unavailable for %s, falling back to AVCC: %s',
          deviceId, (err as Error).message);
        // Intentional fall-through to startAvccCapture below.
      }
    }

    if (format === 'avcc') {
      return this.startAvccCapture(deviceId, options);
    }
    return this.startMjpegCapture(deviceId, options);
  }

  private startMjpegCapture(deviceId: string, options: CaptureOptions): Promise<boolean> {
    if (!this.isBinaryAvailable('mjpeg')) {
      console.log('[SimCapture] MJPEG binary not found at %s', this.mjpegBinaryPath);
      return Promise.resolve(false);
    }

    const args = [
      '--udid', deviceId,
      '--fps', String(options.fps ?? 30),
      '--quality', String(options.quality ?? 80),
      '--scale', String(options.scale ?? 1),
    ];

    console.log('[SimCapture] Starting MJPEG for %s: %s %s', deviceId, this.mjpegBinaryPath, args.join(' '));

    return new Promise((resolve) => {
      try {
        const proc = spawn(this.mjpegBinaryPath, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        const instance: CaptureInstance = {
          process: proc,
          deviceId,
          format: 'mjpeg',
          frameCount: 0,
        };

        this.captures.set(deviceId, instance);

        let buffer = Buffer.alloc(0);
        let headerParsed = false;
        let firstFrameResolved = false;

        proc.stdout!.on('data', (chunk: Buffer) => {
          buffer = Buffer.concat([buffer, chunk]);

          if (!headerParsed) {
            if (buffer.length >= HEADER_SIZE) {
              const header = this.parseHeader(buffer.subarray(0, HEADER_SIZE));
              instance.header = header;
              buffer = buffer.subarray(HEADER_SIZE);
              headerParsed = true;
              console.log('[SimCapture] Header for %s: %dx%d (virtual: %dx%d)', deviceId, header.realWidth, header.realHeight, header.virtualWidth, header.virtualHeight);
            } else {
              return;
            }
          }

          while (buffer.length >= 4) {
            const frameSize = buffer.readUInt32LE(0);

            if (frameSize === 0 || frameSize > 10 * 1024 * 1024) {
              console.error('[SimCapture] Invalid frame size: %d for %s', frameSize, deviceId);
              this.stopCapture(deviceId);
              return;
            }

            if (buffer.length < 4 + frameSize) break;

            const jpegData = buffer.subarray(4, 4 + frameSize);
            buffer = buffer.subarray(4 + frameSize);

            instance.frameCount++;

            const base64 = jpegData.toString('base64');
            const header = instance.header!;

            if (this.onFrame) {
              this.onFrame(deviceId, base64, header.virtualWidth, header.virtualHeight);
            }

            this.emit('frame', deviceId, instance.frameCount);

            if (!firstFrameResolved) {
              firstFrameResolved = true;
              resolve(true);
            }
          }
        });

        proc.stderr!.on('data', (chunk: Buffer) => {
          const lines = chunk.toString().trim().split('\n');
          for (const line of lines) {
            if (line) console.log('[SimCapture:%s] %s', deviceId, line);
          }
        });

        proc.on('error', (err) => {
          console.error('[SimCapture] Process error for %s: %s', deviceId, err);
          this.captures.delete(deviceId);
          if (!firstFrameResolved) {
            firstFrameResolved = true;
            resolve(false);
          }
        });

        proc.on('exit', (code, signal) => {
          console.log('[SimCapture] Process exited for %s (code=%d, signal=%s)', deviceId, code ?? -1, signal ?? '');
          this.captures.delete(deviceId);
          this.emit('exit', deviceId, code);
          if (!firstFrameResolved) {
            firstFrameResolved = true;
            resolve(false);
          }
        });

        setTimeout(() => {
          if (!firstFrameResolved) {
            firstFrameResolved = true;
            console.log('[SimCapture] Timeout waiting for first frame from %s', deviceId);
            this.stopCapture(deviceId);
            resolve(false);
          }
        }, 5000);
      } catch (err) {
        console.error('[SimCapture] Failed to spawn for %s: %s', deviceId, err);
        this.captures.delete(deviceId);
        resolve(false);
      }
    });
  }

  private startAvccCapture(deviceId: string, options: CaptureOptions): Promise<boolean> {
    if (!this.isBinaryAvailable('avcc')) {
      console.log('[SimCapture] AVCC binary not found at %s', this.avccBinaryPath);
      return Promise.resolve(false);
    }

    const fps = options.fps ?? 30;
    const bps = options.bitrate ?? 4_000_000;
    const scale = options.scale ?? 1.0;

    // Persist the launch targets so getQueuedTargets returns sensible values.
    this.targets.set(deviceId, { ...this.targets.get(deviceId), fps, bps, scale, format: 'avcc' });

    const args = [
      '--udid', deviceId,
      '--fps', String(fps),
      '--bitrate', String(bps),
      '--scale', String(scale),
      '--format', 'avcc',
    ];

    console.log('[SimCapture] Starting AVCC for %s: %s %s', deviceId, this.avccBinaryPath, args.join(' '));

    return new Promise((resolve) => {
      try {
        const proc = spawn(this.avccBinaryPath, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        const instance: CaptureInstance = {
          process: proc,
          deviceId,
          format: 'avcc',
          frameCount: 0,
        };

        this.captures.set(deviceId, instance);

        // Stream framing: 4-byte BE length (covers tag + payload) + 1-byte
        // tag + payload. See tools/sim-capture-avcc/Sources/main.swift
        // StdoutWriter for the producer side.
        let buf = Buffer.alloc(0);
        let firstFrameResolved = false;

        proc.stdout!.on('data', (chunk: Buffer) => {
          buf = Buffer.concat([buf, chunk]);
          while (buf.length >= 4) {
            const length = buf.readUInt32BE(0);
            if (length === 0 || length > 16 * 1024 * 1024) {
              console.error('[SimCapture] Invalid AVCC frame length %d for %s', length, deviceId);
              this.stopCapture(deviceId);
              return;
            }
            if (buf.length < 4 + length) break;
            const tag = buf[4];
            const payload = buf.subarray(5, 4 + length);
            buf = buf.subarray(4 + length);

            const kind = TAG_TO_KIND[tag];
            if (!kind) {
              console.error('[SimCapture] Unknown AVCC tag 0x%s for %s', tag.toString(16), deviceId);
              continue;
            }

            instance.frameCount++;
            // Copy out so downstream listeners don't share the rolling buffer.
            const payloadCopy = Buffer.from(payload);
            this.emit('frame', { udid: deviceId, kind, payload: payloadCopy });

            if (!firstFrameResolved) {
              firstFrameResolved = true;
              resolve(true);
            }
          }
        });

        proc.stderr!.on('data', (chunk: Buffer) => {
          const lines = chunk.toString().trim().split('\n');
          for (const line of lines) {
            if (line) console.error('[sim-capture-avcc %s] %s', deviceId, line);
          }
        });

        proc.on('error', (err) => {
          console.error('[SimCapture] AVCC process error for %s: %s', deviceId, err);
          this.captures.delete(deviceId);
          if (!firstFrameResolved) {
            firstFrameResolved = true;
            resolve(false);
          }
        });

        proc.on('exit', (code, signal) => {
          console.log('[SimCapture] AVCC process exited for %s (code=%d, signal=%s)', deviceId, code ?? -1, signal ?? '');
          this.captures.delete(deviceId);
          this.emit('exit', deviceId, code);
          if (!firstFrameResolved) {
            firstFrameResolved = true;
            resolve(false);
          }
        });

        // Resolve as soon as the child is up — the first frame can take
        // a beat (SimulatorKit handshake + first IDR). Late-joiners use
        // the JPEG seed so this is fine.
        setTimeout(() => {
          if (!firstFrameResolved) {
            firstFrameResolved = true;
            resolve(true);
          }
        }, 1000);
      } catch (err) {
        console.error('[SimCapture] Failed to spawn AVCC binary for %s: %s', deviceId, err);
        this.captures.delete(deviceId);
        resolve(false);
      }
    });
  }

  /** Stop capturing for a device. */
  async stopCapture(deviceId: string): Promise<void> {
    const instance = this.captures.get(deviceId) as (CaptureInstance & { privateClient?: any }) | undefined;
    if (!instance) return;

    console.log('[SimCapture] Stopping for %s (%d frames sent)', deviceId, instance.frameCount);
    this.captures.delete(deviceId);

    // Phase 32 private bridge: stop the client directly; the synthetic fake
    // process has no real child to wait on.
    if (instance.privateClient) {
      try { instance.privateClient.stop(); } catch { /* ignore */ }
      return;
    }

    try { instance.process.stdout?.destroy(); } catch { /* may be destroyed */ }

    try {
      instance.process.kill('SIGTERM');
    } catch {
      return;
    }

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        try { instance.process.kill('SIGKILL'); } catch { /* ignore */ }
        resolve();
      }, 3000);
      instance.process.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  /** Alias matching the Phase-D plan vocabulary. */
  async stop(deviceId: string): Promise<void> {
    return this.stopCapture(deviceId);
  }

  isCapturing(deviceId: string): boolean {
    return this.captures.has(deviceId);
  }

  getStats(deviceId: string): { frameCount: number; header?: CaptureHeader; format?: CaptureFormat } | null {
    const instance = this.captures.get(deviceId);
    if (!instance) return null;
    return {
      frameCount: instance.frameCount,
      header: instance.header,
      format: instance.format,
    };
  }

  async cleanup(): Promise<void> {
    const deviceIds = Array.from(this.captures.keys());
    await Promise.all(deviceIds.map(deviceId => this.stopCapture(deviceId)));
  }

  /** Push a set_fps reconfig to the child if running (AVCC only); always update queued target. */
  async setFps(deviceId: string, fps: number): Promise<void> {
    console.log('[SimCapture] set_fps %d for %s', fps, deviceId);
    this.targets.set(deviceId, { ...this.targets.get(deviceId), fps });
    this.writeStdinJson(deviceId, { type: 'set_fps', fps });
  }

  /** Push a set_bitrate reconfig to the child if running (AVCC only); always update queued target. */
  async setBitrate(deviceId: string, bps: number): Promise<void> {
    console.log('[SimCapture] set_bitrate %d for %s', bps, deviceId);
    this.targets.set(deviceId, { ...this.targets.get(deviceId), bps });
    this.writeStdinJson(deviceId, { type: 'set_bitrate', bps });
  }

  /** Queue the new scale target. Scale change requires a restart on the AVCC binary. */
  async setScale(deviceId: string, scale: number): Promise<void> {
    console.log('[SimCapture] set_scale %f for %s', scale, deviceId);
    this.targets.set(deviceId, { ...this.targets.get(deviceId), scale });
  }

  /** Force an IDR on the AVCC encoder. No-op on MJPEG. */
  async forceIdr(deviceId: string): Promise<void> {
    console.log('[SimCapture] force_idr for %s', deviceId);
    this.writeStdinJson(deviceId, { type: 'force_idr' });
  }

  /** Request an extra JPEG seed frame. Also emits 'snapshot-requested'. */
  async snapshot(deviceId: string): Promise<void> {
    console.log('[SimCapture] snapshot requested for %s', deviceId);
    this.emit('snapshot-requested', deviceId);
    this.writeStdinJson(deviceId, { type: 'snapshot' });
  }

  /** Read-only view of queued tuning targets for a device. */
  getQueuedTargets(deviceId: string): { fps?: number; bps?: number; scale?: number; format?: CaptureFormat } | undefined {
    return this.targets.get(deviceId);
  }

  private writeStdinJson(deviceId: string, obj: Record<string, unknown>): void {
    const instance = this.captures.get(deviceId);
    if (!instance || instance.format !== 'avcc') return;
    const stdin = instance.process.stdin;
    if (!stdin || stdin.destroyed) return;
    try {
      stdin.write(JSON.stringify(obj) + '\n');
    } catch (err) {
      console.error('[SimCapture] stdin write failed for %s: %s', deviceId, err);
    }
  }

  private parseHeader(data: Buffer): CaptureHeader {
    return {
      version: data.readUInt8(0),
      pid: data.readUInt32LE(2),
      realWidth: data.readUInt32LE(6),
      realHeight: data.readUInt32LE(10),
      virtualWidth: data.readUInt32LE(14),
      virtualHeight: data.readUInt32LE(18),
      orientation: data.readUInt8(22),
    };
  }
}

/** Create a CaptureService instance. */
export function createCaptureService(options?: string | CaptureServiceOptions): CaptureService {
  return new CaptureService(options);
}
