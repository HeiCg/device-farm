/**
 * Phase 35 Plan 35-02 — sliding-window stuck-detector spec.
 *
 * Covers:
 *   - first observe returns stuck:false, consecutive:1
 *   - 3 identical pHashes → 3rd returns stuck:true + reason + consecutive:3
 *   - 3 distinct pHashes → never stuck
 *   - reset() clears the window
 *   - sliding behavior (window shifts when a 4th observation pushes in)
 *   - constructor rejects invalid window sizes
 */
import { describe, it, expect } from 'vitest';

import { StuckDetector } from '../internal/stuck-detector.js';

/** Helper — 64-char pHash string of all '0's, or all '1's, etc. */
function ph(bit: '0' | '1'): string {
  return bit.repeat(64);
}

/** Helper — 64-char pHash with a single bit flipped near the middle. */
function phMostlyZeros(): string {
  return '0'.repeat(30) + '1' + '0'.repeat(33);
}

describe('explorations/stuck-detector', () => {
  it('first observe returns stuck:false, consecutive:1', () => {
    const d = new StuckDetector();
    const r = d.observe(ph('0'));
    expect(r.stuck).toBe(false);
    expect(r.consecutive).toBe(1);
    expect(r.reason).toBeUndefined();
  });

  it('second observe of identical pHash returns stuck:false, consecutive:2', () => {
    const d = new StuckDetector();
    d.observe(ph('0'));
    const r = d.observe(ph('0'));
    expect(r.stuck).toBe(false);
    expect(r.consecutive).toBe(2);
  });

  it('third identical pHash returns stuck:true + reason + consecutive:3', () => {
    const d = new StuckDetector();
    d.observe(ph('0'));
    d.observe(ph('0'));
    const r = d.observe(ph('0'));
    expect(r.stuck).toBe(true);
    expect(r.consecutive).toBe(3);
    expect(r.reason).toMatch(/3 consecutive/i);
  });

  it('three distinct pHashes (Hamming distance >= 8) never trip stuck', () => {
    const d = new StuckDetector();
    // ph(0) and ph(1) differ in 64 bits — well above PHASH_THRESHOLD(8).
    // phMostlyZeros() differs in 1 bit from ph(0) — close to ph(0) but
    // distant from ph(1) (63 bits). After 3 observations the window contains
    // [ph(0), ph(1), phMostlyZeros]; anchor=ph(0), and ph(1) is far → stuck:false.
    expect(d.observe(ph('0')).stuck).toBe(false);
    expect(d.observe(ph('1')).stuck).toBe(false);
    expect(d.observe(phMostlyZeros()).stuck).toBe(false);
  });

  it('reset() clears the window — next 3 identicals trigger fresh', () => {
    const d = new StuckDetector();
    d.observe(ph('0'));
    d.observe(ph('0'));
    expect(d.observe(ph('0')).stuck).toBe(true);
    d.reset();
    expect(d.currentSize).toBe(0);
    expect(d.observe(ph('0')).stuck).toBe(false);
    expect(d.observe(ph('0')).stuck).toBe(false);
    expect(d.observe(ph('0')).stuck).toBe(true);
  });

  it('window slides — 4th identical observation still reports stuck:true', () => {
    const d = new StuckDetector();
    d.observe(ph('0'));
    d.observe(ph('0'));
    d.observe(ph('0'));
    // 4th observation pushes window from [0,0,0] → [0,0,0] (size cap 3, shift
    // oldest, anchor remains a '0'-pHash). Still stuck.
    const r = d.observe(ph('0'));
    expect(r.stuck).toBe(true);
    expect(r.consecutive).toBe(3);
  });

  it('window slides — a new distinct pHash at the tail un-sticks', () => {
    const d = new StuckDetector();
    d.observe(ph('0'));
    d.observe(ph('0'));
    expect(d.observe(ph('0')).stuck).toBe(true);
    // Push a far-distant pHash → window=[0,0,1] anchor=0 not all close → un-stuck.
    const r = d.observe(ph('1'));
    expect(r.stuck).toBe(false);
    expect(r.consecutive).toBe(3);
  });

  it('rejects invalid window sizes', () => {
    expect(() => new StuckDetector(1)).toThrow();
    expect(() => new StuckDetector(0)).toThrow();
    expect(() => new StuckDetector(-2)).toThrow();
    expect(() => new StuckDetector(2.5)).toThrow();
  });

  it('custom window size of 2 fires on the 2nd identical', () => {
    const d = new StuckDetector(2);
    expect(d.observe(ph('0')).stuck).toBe(false);
    expect(d.observe(ph('0')).stuck).toBe(true);
  });

  it('custom window size of 5 fires only on the 5th identical', () => {
    const d = new StuckDetector(5);
    for (let i = 0; i < 4; i++) {
      expect(d.observe(ph('0')).stuck).toBe(false);
    }
    expect(d.observe(ph('0')).stuck).toBe(true);
  });

  it('observations close-but-not-identical (Hamming < 8) still count as stuck', () => {
    const d = new StuckDetector();
    const a = ph('0');
    const b = phMostlyZeros(); // 1-bit difference — well within PHASH_THRESHOLD(8)
    d.observe(a);
    d.observe(b);
    expect(d.observe(a).stuck).toBe(true);
  });
});
