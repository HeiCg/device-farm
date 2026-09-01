/**
 * WS3 — dsl_screenshot context-safety spec.
 *
 * The screenshot tool must (a) default to a low capture scale (0.25) that it
 * forwards to the driver, (b) honor an explicit scale, (c) return an image
 * content block, and (d) refuse — with an isError text result, never the blob —
 * when the encoded payload blows past the 1 MB cap.
 */
import { describe, it, expect, vi } from 'vitest';
import { getDslTool } from '../src/dsl/registry.js';

function sessionReturning(buf: Buffer): any {
  return { screenshot: vi.fn(async () => buf) };
}

describe('dsl_screenshot', () => {
  it('defaults to scale 0.25 forwarded to the driver', async () => {
    const s = sessionReturning(Buffer.from('PNGBYTES'));
    await getDslTool('dsl_screenshot')!.execute(s, {});
    expect(s.screenshot).toHaveBeenCalledWith({ scale: 0.25 });
  });

  it('honors an explicit scale', async () => {
    const s = sessionReturning(Buffer.from('PNGBYTES'));
    await getDslTool('dsl_screenshot')!.execute(s, { scale: 1 });
    expect(s.screenshot).toHaveBeenCalledWith({ scale: 1 });
  });

  it('returns an image content block for a normal-sized capture', async () => {
    const s = sessionReturning(Buffer.from('PNGBYTES'));
    const res = await getDslTool('dsl_screenshot')!.execute(s, {});
    expect(res.isError).toBeFalsy();
    expect(res.content[0].type).toBe('image');
    expect(res.content[0].mimeType).toBe('image/png');
    expect(res.content[0].data).toBe(Buffer.from('PNGBYTES').toString('base64'));
  });

  it('refuses (isError text, no blob) when the encoded payload exceeds 1 MB', async () => {
    // 900 KB of raw bytes -> ~1.2 MB base64, over the 1 MB cap.
    const s = sessionReturning(Buffer.alloc(900 * 1024, 0xff));
    const res = await getDslTool('dsl_screenshot')!.execute(s, { scale: 1 });
    expect(res.isError).toBe(true);
    expect(res.content[0].type).toBe('text');
    expect(res.content[0].text).toMatch(/too large/i);
    expect(res.content[0].text).toMatch(/scale/i);
    // never the blob
    expect(res.content.some((c) => c.type === 'image')).toBe(false);
  });
});
