import { describe, it, expect } from 'vitest';
import { decodePngSize, pngSizeFromBase64, imageTokens, clampToApiLimits } from '../png.js';
import { makePngBase64 } from './fixtures.js';

describe('png — dimension decode + image token accounting', () => {
  it('decodes IHDR width/height', () => {
    const b64 = makePngBase64(270, 600);
    const size = pngSizeFromBase64(b64);
    expect(size).toEqual({ width: 270, height: 600 });
  });

  it('returns null for non-PNG bytes', () => {
    expect(decodePngSize(Buffer.from('not a png at all, really'))).toBeNull();
  });

  it('imageTokens uses ceil(w*h/750) for a small frame', () => {
    // 270x600 = 162000 / 750 = 216
    expect(imageTokens({ width: 270, height: 600 })).toBe(216);
  });

  it('clamps an oversized frame to Anthropic limits before counting', () => {
    const clamped = clampToApiLimits({ width: 4000, height: 3000 });
    expect(Math.max(clamped.width, clamped.height)).toBeLessThanOrEqual(1568);
    expect(clamped.width * clamped.height).toBeLessThanOrEqual(1_150_000);
  });

  it('a full-res 1080x2400 screenshot is clamped, not counted raw', () => {
    const raw = 1080 * 2400; // 2,592,000 -> /750 = 3456 tokens if NOT clamped
    const tokens = imageTokens({ width: 1080, height: 2400 });
    expect(tokens).toBeLessThan(Math.ceil(raw / 750));
  });
});
