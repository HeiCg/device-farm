import { describe, it, expect } from 'vitest';
import {
  HEADER_SIZE,
  MAX_CANVAS_WIDTH,
  MAX_CANVAS_HEIGHT,
  TOTAL_BYTE_COUNT,
  FLAG_FILL_GRAVITY,
  FLAG_MIRROR,
  encodeHeader,
  decodeHeader,
  frameByteCount,
  fitsCanvas,
} from '../src/camera-layout.js';

describe('camera-layout', () => {
  it('exposes a 24-byte header and 1280x1280 canvas cap', () => {
    expect(HEADER_SIZE).toBe(24);
    expect(MAX_CANVAS_WIDTH).toBe(1280);
    expect(MAX_CANVAS_HEIGHT).toBe(1280);
    expect(TOTAL_BYTE_COUNT).toBe(24 + 1280 * 1280 * 4);
  });

  it('encodes UInt32 fields little-endian at the documented offsets', () => {
    const buf = encodeHeader({
      sequence: 0x01020304,
      timestampMs: 0x05060708,
      width: 390,
      height: 844,
      flags: FLAG_FILL_GRAVITY | FLAG_MIRROR,
    });
    expect(buf.length).toBe(24);
    expect(Array.from(buf.slice(0, 4))).toEqual([0x04, 0x03, 0x02, 0x01]);
    expect(Array.from(buf.slice(4, 8))).toEqual([0x08, 0x07, 0x06, 0x05]);
    expect(buf[8]).toBe(390 & 0xff);
    expect(buf[16]).toBe(0x03);
    expect(Array.from(buf.slice(20, 24))).toEqual([0, 0, 0, 0]);
  });

  it('round-trips encode -> decode', () => {
    const header = {
      sequence: 42,
      timestampMs: 1_700_000_000,
      width: 1170,
      height: 2532,
      flags: FLAG_MIRROR,
    };
    const decoded = decodeHeader(encodeHeader(header));
    expect(decoded).toEqual(header);
  });

  it('rejects non-UInt32 values', () => {
    expect(() => encodeHeader({ sequence: -1, timestampMs: 0, width: 0, height: 0, flags: 0 })).toThrow(RangeError);
    expect(() => encodeHeader({ sequence: 2 ** 32, timestampMs: 0, width: 0, height: 0, flags: 0 })).toThrow(RangeError);
    expect(() => encodeHeader({ sequence: 0.5, timestampMs: 0, width: 0, height: 0, flags: 0 })).toThrow(RangeError);
  });

  it('refuses to decode a too-small buffer', () => {
    expect(() => decodeHeader(new Uint8Array(23))).toThrow(RangeError);
  });

  it('frameByteCount and fitsCanvas honour the cap', () => {
    expect(frameByteCount(100, 100)).toBe(24 + 100 * 100 * 4);
    expect(fitsCanvas(1280, 1280)).toBe(true);
    expect(fitsCanvas(1281, 720)).toBe(false);
    expect(fitsCanvas(0, 720)).toBe(false);
  });
});
