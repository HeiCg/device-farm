import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CameraFrameSink } from '../src/camera-frame-sink.js';
import { decodeHeader, FLAG_MIRROR, FLAG_FILL_GRAVITY, HEADER_SIZE } from '../src/camera-layout.js';

describe('CameraFrameSink', () => {
  let tmpPath: string;
  let sink: CameraFrameSink;

  beforeEach(() => {
    tmpPath = path.join(os.tmpdir(), `cam-sink-${process.pid}-${Math.random().toString(16).slice(2)}.bgra`);
    sink = new CameraFrameSink({ path: tmpPath });
  });

  afterEach(() => {
    try { sink.close(); } catch {}
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  });

  it('writes a 24-byte header + BGRA payload at the documented offsets', async () => {
    await sink.open();
    const width = 4;
    const height = 2;
    const bgra = new Uint8Array(width * height * 4);
    bgra.fill(0xab);
    sink.writeFrame(bgra, { width, height, sequence: 1, timestampMs: 1700000000, fillGravity: true, mirror: true });

    const fileBytes = fs.readFileSync(tmpPath);
    const header = decodeHeader(fileBytes.subarray(0, HEADER_SIZE));
    expect(header).toEqual({
      sequence: 1,
      timestampMs: 1700000000,
      width,
      height,
      flags: FLAG_FILL_GRAVITY | FLAG_MIRROR,
    });
    // BGRA region:
    expect(fileBytes[HEADER_SIZE]).toBe(0xab);
    expect(fileBytes[HEADER_SIZE + width * height * 4 - 1]).toBe(0xab);
  });

  it('rejects frames bigger than the canvas cap', async () => {
    await sink.open();
    const w = 1281, h = 720;
    const bgra = new Uint8Array(w * h * 4);
    expect(() => sink.writeFrame(bgra, { width: w, height: h, sequence: 0 })).toThrow(RangeError);
  });

  it('rejects bgra buffers that do not match width*height*4', async () => {
    await sink.open();
    expect(() => sink.writeFrame(new Uint8Array(10), { width: 4, height: 2, sequence: 0 })).toThrow(RangeError);
  });

  it('throws if writeFrame is called before open', () => {
    expect(() => sink.writeFrame(new Uint8Array(16), { width: 2, height: 2, sequence: 0 })).toThrow(/not open/);
  });

  it('preallocates the full canvas size when preallocate=true', async () => {
    await sink.open();
    const stat = fs.statSync(tmpPath);
    expect(stat.size).toBe(24 + 1280 * 1280 * 4);
  });
});
