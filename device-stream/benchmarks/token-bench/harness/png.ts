/**
 * PNG dimension extraction + Anthropic image-token accounting.
 *
 * Image content blocks are NOT counted with a text tokenizer. Anthropic bills an
 * image at roughly `width * height / 750` tokens (per the vision docs), regardless
 * of the base64 byte count. So the harness must decode the real pixel dimensions
 * from the PNG header and apply that formula — and separately record the base64
 * byte size, which is what actually crosses the wire.
 *
 * Pure functions only; no IO. `decodePngSize` reads the IHDR chunk from the raw
 * (already base64-decoded) bytes.
 */

/** PNG signature: the 8 bytes every PNG starts with. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface PngSize {
  width: number;
  height: number;
}

/**
 * Read width/height from a PNG's IHDR chunk. Returns `null` if the buffer is not
 * a PNG (caller then falls back to whatever dimensions the tool reported, or none).
 */
export function decodePngSize(bytes: Uint8Array): PngSize | null {
  if (bytes.length < 24) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  }
  // IHDR is the first chunk: 8-byte sig, 4-byte length, 4-byte "IHDR", then
  // width (4 bytes BE) and height (4 bytes BE) at offsets 16 and 20.
  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

/** Decode a base64 string to bytes and read its PNG dimensions, if it is a PNG. */
export function pngSizeFromBase64(b64: string): PngSize | null {
  try {
    return decodePngSize(Buffer.from(b64, 'base64'));
  } catch {
    return null;
  }
}

/**
 * Anthropic image token estimate: `ceil(width * height / 750)`.
 *
 * Anthropic downscales images whose long edge exceeds ~1568px (and total area
 * beyond ~1.15MP) before this formula applies. We replicate that clamp so the
 * estimate matches what the API would actually bill for an oversized frame.
 */
export function imageTokens(size: PngSize): number {
  const clamped = clampToApiLimits(size);
  return Math.ceil((clamped.width * clamped.height) / 750);
}

/** Anthropic resizes so the long edge ≤ 1568px and area ≤ ~1.15MP, preserving aspect. */
export function clampToApiLimits(size: PngSize): PngSize {
  const MAX_EDGE = 1568;
  const MAX_AREA = 1_150_000;
  let { width, height } = size;
  const longEdge = Math.max(width, height);
  if (longEdge > MAX_EDGE) {
    const scale = MAX_EDGE / longEdge;
    // Floor, so the clamped frame never exceeds the limit by a rounding pixel.
    width = Math.floor(width * scale);
    height = Math.floor(height * scale);
  }
  const area = width * height;
  if (area > MAX_AREA) {
    const scale = Math.sqrt(MAX_AREA / area);
    width = Math.floor(width * scale);
    height = Math.floor(height * scale);
  }
  return { width, height };
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}
