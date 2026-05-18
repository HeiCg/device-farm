import { describe, it, expect } from 'vitest';
import { markerPositionsPercent } from '../sync-video-logic.js';

describe('markerPositionsPercent', () => {
  it('converts ms offsets to percentages of total duration', () => {
    const out = markerPositionsPercent([0, 5000, 10000], 10000);
    expect(out).toEqual([0, 50, 100]);
  });

  it('returns empty when duration is 0 or null', () => {
    expect(markerPositionsPercent([1000], 0)).toEqual([]);
    expect(markerPositionsPercent([1000], null)).toEqual([]);
  });

  it('filters markers beyond duration (clamped or dropped)', () => {
    const out = markerPositionsPercent([1000, 15000], 10000);
    expect(out).toEqual([10]); // 15000 > 10000 → dropped
  });

  it('returns empty when no markers', () => {
    expect(markerPositionsPercent([], 10000)).toEqual([]);
  });
});
