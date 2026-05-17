// Ported from baguette (Apache-2.0). Upstream: https://github.com/tddworks/baguette
// Original: Sources/Baguette/Infrastructure/Camera/SharedMemoryFrameSink.swift

import * as fs from 'fs';
import {
  HEADER_SIZE,
  SHARED_FRAME_PATH,
  TOTAL_BYTE_COUNT,
  encodeHeader,
  fitsCanvas,
  FLAG_FILL_GRAVITY,
  FLAG_MIRROR,
} from './camera-layout.js';

export interface CameraFrameSinkOptions {
  path?: string;
  /** If true, the underlying file is initialised to the full canvas size (1280*1280*4 + header). */
  preallocate?: boolean;
}

export interface FrameWriteOptions {
  width: number;
  height: number;
  /** Monotonic frame counter — the dylib uses this to detect new frames. */
  sequence: number;
  /** Milliseconds since some epoch (LSB-truncated to UInt32). Defaults to Date.now() & 0xffffffff. */
  timestampMs?: number;
  /** AVLayerVideoGravity equivalent — true = resizeAspectFill, false = resizeAspect. */
  fillGravity?: boolean;
  /** Front-camera mirror. */
  mirror?: boolean;
}

/**
 * Writes BGRA frames to the shared-memory file the VirtualCamera dylib reads
 * from. Uses plain fs.write (pwrite-equivalent) — no mmap-io dependency.
 * Slower than mmap but correct and dependency-free.
 *
 * Lifecycle: `open()` once, `writeFrame(bgra, opts)` per frame, `close()` on shutdown.
 */
export class CameraFrameSink {
  readonly path: string;
  private fd: number | null = null;
  private preallocate: boolean;

  constructor(opts: CameraFrameSinkOptions = {}) {
    this.path = opts.path ?? SHARED_FRAME_PATH;
    this.preallocate = opts.preallocate ?? true;
  }

  async open(): Promise<void> {
    if (this.fd !== null) return;
    this.fd = fs.openSync(this.path, fs.constants.O_RDWR | fs.constants.O_CREAT, 0o644);
    if (this.preallocate) {
      fs.ftruncateSync(this.fd, TOTAL_BYTE_COUNT);
    }
  }

  isOpen(): boolean {
    return this.fd !== null;
  }

  writeFrame(bgra: Uint8Array, opts: FrameWriteOptions): void {
    if (this.fd === null) {
      throw new Error('CameraFrameSink not open — call open() first');
    }
    const { width, height } = opts;
    if (!fitsCanvas(width, height)) {
      throw new RangeError(`frame ${width}x${height} exceeds 1280x1280 canvas`);
    }
    const expected = width * height * 4;
    if (bgra.length !== expected) {
      throw new RangeError(`bgra length ${bgra.length} does not match ${width}x${height}x4 = ${expected}`);
    }

    let flags = 0;
    if (opts.fillGravity) flags |= FLAG_FILL_GRAVITY;
    if (opts.mirror) flags |= FLAG_MIRROR;

    const header = encodeHeader({
      sequence: opts.sequence >>> 0,
      timestampMs: (opts.timestampMs ?? Date.now()) >>> 0,
      width: width >>> 0,
      height: height >>> 0,
      flags: flags >>> 0,
    });

    // pwrite header at offset 0, then BGRA at offset HEADER_SIZE.
    fs.writeSync(this.fd, header, 0, HEADER_SIZE, 0);
    fs.writeSync(this.fd, bgra, 0, bgra.length, HEADER_SIZE);
  }

  /** Returns the raw 24-byte header from the current file contents. */
  peekHeader(): Uint8Array {
    if (this.fd === null) {
      throw new Error('CameraFrameSink not open — call open() first');
    }
    const buf = new Uint8Array(HEADER_SIZE);
    fs.readSync(this.fd, buf, 0, HEADER_SIZE, 0);
    return buf;
  }

  close(): void {
    if (this.fd === null) return;
    fs.closeSync(this.fd);
    this.fd = null;
  }
}
