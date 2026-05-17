import { describe, it, expect } from 'vitest';
import { suggestDeviceCount, mergeConfigSuggestions } from '../setup-mac-mini.js';

describe('suggestDeviceCount', () => {
  it('reserves 4GB and divides remainder by 4 (cap 4)', () => {
    expect(suggestDeviceCount(8)).toBe(1);
    expect(suggestDeviceCount(16)).toBe(3);
    expect(suggestDeviceCount(24)).toBe(4);
    expect(suggestDeviceCount(64)).toBe(4);
  });

  it('returns minimum 1 for low-RAM machines', () => {
    expect(suggestDeviceCount(4)).toBe(1);
    expect(suggestDeviceCount(6)).toBe(1);
  });
});

describe('mergeConfigSuggestions', () => {
  it('produces a diff of suggested vs current', () => {
    const current = { pool: { max_devices: 2 } };
    const suggested = { pool: { max_devices: 3 }, pipelines: { max_concurrent_runs: 3 } };
    const diff = mergeConfigSuggestions(current, suggested);
    expect(diff).toContainEqual({ path: 'pool.max_devices', from: 2, to: 3 });
    expect(diff).toContainEqual({
      path: 'pipelines.max_concurrent_runs',
      from: undefined,
      to: 3,
    });
  });

  it('returns empty diff when current matches suggested', () => {
    const diff = mergeConfigSuggestions(
      { pool: { max_devices: 3 } },
      { pool: { max_devices: 3 } },
    );
    expect(diff).toEqual([]);
  });
});
