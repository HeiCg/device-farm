import { describe, it, expect } from 'vitest';
import {
  callAdded,
  perStepAdded,
  flowAdded,
  billedCached,
  billedUncached,
  computeMetrics,
} from '../metrics.js';
import { SAMPLE_CALLS } from './fixtures.js';

describe('metrics — pure derived functions', () => {
  it('callAdded sums request + result tokens', () => {
    expect(callAdded(SAMPLE_CALLS[0])).toBe(110);
    expect(callAdded(SAMPLE_CALLS[1])).toBe(405);
    expect(callAdded(SAMPLE_CALLS[2])).toBe(65);
  });

  it('perStepAdded folds auto-capture into the triggering step', () => {
    expect(perStepAdded(SAMPLE_CALLS, 3)).toEqual([515, 65, 0]);
  });

  it('perStepAdded rejects an out-of-range step', () => {
    expect(() => perStepAdded(SAMPLE_CALLS, 1)).toThrow(RangeError);
  });

  it('flowAdded is the sum of per-step added', () => {
    expect(flowAdded([515, 65, 0])).toBe(580);
  });

  it('billedCached = fixed + Σ added', () => {
    expect(billedCached(1000, [110, 405, 65])).toBe(1580);
  });

  it('billedUncached is the quadratic transcript model', () => {
    // running: 110 -> 515 -> 580; each turn re-bills fixed + running.
    // (1000+110) + (1000+515) + (1000+580) = 1110 + 1515 + 1580 = 4205
    expect(billedUncached(1000, [110, 405, 65])).toBe(4205);
  });

  it('billedUncached >= billedCached always (more turns cost more without caching)', () => {
    const added = [110, 405, 65];
    expect(billedUncached(1000, added)).toBeGreaterThanOrEqual(billedCached(1000, added));
  });

  it('computeMetrics assembles the full set', () => {
    const m = computeMetrics('X', 1000, SAMPLE_CALLS, 3);
    expect(m).toEqual({
      configId: 'X',
      fixed: 1000,
      perStep: [515, 65, 0],
      flowAdded: 580,
      billedCached: 1580,
      billedUncached: 4205,
      roundTrips: 3,
    });
  });

  it('empty flow yields zero added and zero billing beyond fixed', () => {
    const m = computeMetrics('Y', 500, [], 10);
    expect(m.flowAdded).toBe(0);
    expect(m.billedCached).toBe(500);
    expect(m.billedUncached).toBe(0);
    expect(m.roundTrips).toBe(0);
  });
});
