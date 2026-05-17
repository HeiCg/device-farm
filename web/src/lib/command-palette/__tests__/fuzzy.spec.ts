/**
 * Phase 36 Plan 36-03 — fuzzysort wrapper spec.
 *
 * Locks the rank() behavior:
 *   - empty query → first 50 items unranked (insertion order)
 *   - non-empty query → fuzzysort.go ranked subset (best match first)
 */
import { describe, it, expect } from 'vitest';

import { rank, type FuzzyItem } from '../fuzzy.js';

function item(id: string, label: string, sub?: string, keywords?: string[]): FuzzyItem {
  return {
    id,
    label,
    sub,
    keywords: keywords?.join(' '),
    kind: 'device',
    run: () => {},
  };
}

describe('[Phase 36-03] fuzzy rank', () => {
  it("rank('') returns items unranked (first 50)", () => {
    const items: FuzzyItem[] = [
      item('a', 'Alpha'),
      item('b', 'Beta'),
      item('c', 'Gamma'),
    ];
    const result = rank('', items);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it("rank('pixel') ranks Pixel 8 first among device-like items", () => {
    const items: FuzzyItem[] = [
      item('iphone', 'iPhone 15', 'iOS · idle'),
      item('pixel8', 'Pixel 8', 'android · idle'),
      item('emu', 'Emulator-5554', 'android · idle'),
    ];
    const result = rank('pixel', items);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].id).toBe('pixel8');
  });
});
