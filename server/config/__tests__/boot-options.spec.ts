import { describe, it, expect } from 'vitest';
import { bootOptionsSchema } from '../schema.js';

// Phase 31 Wave 0: RED state. The `bootOptionsSchema` export is added by
// Wave 1 plan 31-03 to `server/config/schema.ts`. Until then, this spec MUST
// fail because the named export does not exist.

describe('bootOptionsSchema', () => {
  it('defaults: parse({}) returns expected defaults', () => {
    const parsed = bootOptionsSchema.parse({});
    expect(parsed).toEqual({ coldBoot: false, noAudio: true, gpu: 'swiftshader_indirect' });
  });

  it('explicit coldBoot=true is preserved', () => {
    expect(bootOptionsSchema.parse({ coldBoot: true })).toEqual({
      coldBoot: true,
      noAudio: true,
      gpu: 'swiftshader_indirect',
    });
  });

  it('explicit noAudio=false is preserved', () => {
    expect(bootOptionsSchema.parse({ noAudio: false })).toEqual({
      coldBoot: false,
      noAudio: false,
      gpu: 'swiftshader_indirect',
    });
  });

  it('gpu=host is preserved', () => {
    const parsed = bootOptionsSchema.parse({ gpu: 'host' });
    expect(parsed.gpu).toBe('host');
  });

  it('invalid gpu value is rejected (Zod throw)', () => {
    expect(() => bootOptionsSchema.parse({ gpu: 'metal' })).toThrow();
  });

  it('invalid type is rejected (coldBoot must be boolean)', () => {
    expect(() => bootOptionsSchema.parse({ coldBoot: 'yes' })).toThrow();
  });
});
