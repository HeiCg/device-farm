// Ported from baguette (Apache-2.0). Upstream: https://github.com/tddworks/baguette
// Original: Sources/Baguette/Domain/Camera/SharedFrameLayout.swift

/**
 * Layout of the mmap'd buffer at `/tmp/SimCam.bgra` (the path the
 * VirtualCamera dylib reads). 24-byte little-endian header, then
 * BGRA pixels (premultiplied-first, byteOrder32Little) up to the
 * canvas cap.
 *
 * Header (24 bytes LE):
 *   [ 0..< 4]  sequence       UInt32 — monotonic, reader picks up new frames
 *   [ 4..< 8]  timestampMs    UInt32 — capture wall clock, milliseconds
 *   [ 8..<12]  width          UInt32 — pixel width
 *   [12..<16]  height         UInt32 — pixel height
 *   [16..<20]  flags          UInt32 — bit 0 fillGravity, bit 1 mirror
 *   [20..<24]  reserved       zeros
 *   [24...  ]  BGRA pixels
 *
 * The canvas cap (1280×1280) is fixed by the dylib's reader — the
 * reader allocates a static buffer of this size and rejects larger
 * frames as a safety net against truncated reads.
 */

export const HEADER_SIZE = 24;
export const MAX_CANVAS_WIDTH = 1280;
export const MAX_CANVAS_HEIGHT = 1280;
export const TOTAL_BYTE_COUNT = HEADER_SIZE + MAX_CANVAS_WIDTH * MAX_CANVAS_HEIGHT * 4;

export const FLAG_FILL_GRAVITY = 1 << 0;
export const FLAG_MIRROR = 1 << 1;

export const SHARED_FRAME_PATH = '/tmp/SimCam.bgra';

export interface FrameHeader {
  sequence: number;
  timestampMs: number;
  width: number;
  height: number;
  flags: number;
}

function assertU32(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(`${name} must be a UInt32, got ${value}`);
  }
}

export function encodeHeader(header: FrameHeader): Uint8Array {
  assertU32('sequence', header.sequence);
  assertU32('timestampMs', header.timestampMs);
  assertU32('width', header.width);
  assertU32('height', header.height);
  assertU32('flags', header.flags);

  const buffer = new Uint8Array(HEADER_SIZE);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, header.sequence, true);
  view.setUint32(4, header.timestampMs, true);
  view.setUint32(8, header.width, true);
  view.setUint32(12, header.height, true);
  view.setUint32(16, header.flags, true);
  // [20..<24] reserved — already zero
  return buffer;
}

export function decodeHeader(bytes: Uint8Array): FrameHeader {
  if (bytes.length < HEADER_SIZE) {
    throw new RangeError(`header buffer must be >= ${HEADER_SIZE} bytes, got ${bytes.length}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    sequence: view.getUint32(0, true),
    timestampMs: view.getUint32(4, true),
    width: view.getUint32(8, true),
    height: view.getUint32(12, true),
    flags: view.getUint32(16, true),
  };
}

export function frameByteCount(width: number, height: number): number {
  return HEADER_SIZE + width * height * 4;
}

export function fitsCanvas(width: number, height: number): boolean {
  return width > 0 && height > 0 && width <= MAX_CANVAS_WIDTH && height <= MAX_CANVAS_HEIGHT;
}
