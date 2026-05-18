import { describe, it, expect } from 'vitest';
import { fmtOffset } from '../failure-focus-logic.js';

describe('fmtOffset', () => {
  it('formats ms as M:SS', () => {
    expect(fmtOffset(0)).toBe('0:00');
    expect(fmtOffset(1500)).toBe('0:01');
    expect(fmtOffset(60000)).toBe('1:00');
    expect(fmtOffset(125000)).toBe('2:05');
    expect(fmtOffset(3661000)).toBe('61:01');
  });
});
