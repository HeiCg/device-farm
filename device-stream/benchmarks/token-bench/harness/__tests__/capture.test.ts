import { describe, it, expect } from 'vitest';
import { captureCall, imageInfo, serializeArgs, measureText } from '../capture.js';
import { tiktokenCounter } from '../tokens.js';
import { textResult, textAndImageResult, makePngBase64 } from './fixtures.js';

const counter = tiktokenCounter();

describe('capture — result → CallRecord', () => {
  it('serializeArgs stringifies, empty for null/undefined', () => {
    expect(serializeArgs({ a: 1 })).toBe('{"a":1}');
    expect(serializeArgs(undefined)).toBe('{}');
    expect(serializeArgs(null)).toBe('{}');
  });

  it('counts a text result with the token counter', async () => {
    const rec = await captureCall(
      { step: 3, tool: 'dsl_describe', origin: 'agent', requestArgs: {}, result: textResult('Network & internet\nConnected devices') },
      counter,
    );
    expect(rec.contentTypes).toEqual(['text']);
    expect(rec.resultTokens).toBeGreaterThan(0);
    expect(rec.images).toBeUndefined();
    expect(rec.step).toBe(3);
  });

  it('image blocks are counted by the PNG formula, not tiktoken on base64', async () => {
    const rec = await captureCall(
      { step: 4, tool: 'screenshot', origin: 'auto-screenshot', requestArgs: { udid: 'emulator-5554' }, result: textAndImageResult('--- Screen after action ---', 270, 600) },
      counter,
    );
    expect(rec.contentTypes).toEqual(['text', 'image']);
    expect(rec.images).toHaveLength(1);
    expect(rec.images![0]).toMatchObject({ width: 270, height: 600, tokens: 216 });
    // Pixel-token count comes from the formula, independent of the base64 length,
    // and the base64 byte size is recorded separately.
    expect(rec.images![0].base64Bytes).toBeGreaterThan(0);
  });

  it('imageInfo falls back to a byte estimate for non-PNG data', () => {
    const info = imageInfo(Buffer.from('junk-not-png').toString('base64'));
    expect(info.width).toBe(0);
    expect(info.tokens).toBeGreaterThanOrEqual(1);
  });

  it('measureText returns bytes and tokens', async () => {
    const m = await measureText('hello world', counter);
    expect(m.bytes).toBe(11);
    expect(m.tokens).toBeGreaterThan(0);
  });

  it('a valid crafted PNG round-trips through base64', () => {
    const info = imageInfo(makePngBase64(100, 100));
    expect(info.tokens).toBe(Math.ceil((100 * 100) / 750));
  });
});
