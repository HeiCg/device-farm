/**
 * Phase 36 Plan 36-03 — palette recents spec.
 *
 * Locks the localStorage-backed FIFO behavior of `getRecent` + `pushRecent`:
 *   - MAX=5 entries
 *   - duplicate push moves entry to head without duplicating
 *   - SSR-safe (no localStorage in environment → returns [])
 *   - JSON.parse failures swallowed → returns []
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { getRecent, pushRecent, STORAGE_KEY, MAX } from '../recent.svelte.js';

function freshStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

describe('[Phase 36-03] palette recents', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', freshStorage());
  });

  it('pushRecent appends to localStorage', () => {
    pushRecent('pair-device');
    expect(getRecent()).toEqual(['pair-device']);
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toEqual(['pair-device']);
  });

  it('pushRecent respects MAX=5 FIFO (6th push drops oldest)', () => {
    pushRecent('a');
    pushRecent('b');
    pushRecent('c');
    pushRecent('d');
    pushRecent('e');
    pushRecent('f');
    const recent = getRecent();
    expect(recent).toHaveLength(MAX);
    // Most recent first; 'a' should have been dropped
    expect(recent[0]).toBe('f');
    expect(recent).not.toContain('a');
  });

  it('getRecent returns [] on empty storage', () => {
    expect(getRecent()).toEqual([]);
  });

  it('getRecent returns [] when JSON.parse fails', () => {
    localStorage.setItem(STORAGE_KEY, '<<<not json>>>');
    expect(getRecent()).toEqual([]);
  });

  it('duplicate pushRecent moves entry to head without duplicating', () => {
    pushRecent('a');
    pushRecent('b');
    pushRecent('c');
    pushRecent('a'); // duplicate → moves to head
    const recent = getRecent();
    expect(recent).toEqual(['a', 'c', 'b']);
    expect(recent.filter((x) => x === 'a')).toHaveLength(1);
  });

  it('SSR safe — getRecent in environment with no localStorage returns []', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(getRecent()).toEqual([]);
    // pushRecent should also not throw under SSR
    expect(() => pushRecent('x')).not.toThrow();
  });
});
