// @vitest-environment jsdom
//
// Phase 36 Plan 36-03 — CommandPalette spec.
//
// web/ has no vite-plugin-svelte test integration (see sessions-detail.spec
// for the established pattern), so we exercise the pure logic that powers
// `CommandPalette.svelte` via `command-palette/palette-logic.ts`:
//
//   - aggregateItems(): merges actions + devices + pages into FuzzyItem[]
//   - onKeyArrow(): wraps selected index up/down with bounds
//   - typing 'pair' ranks the Pair-device action first
//   - typing 'pixel' ranks Pixel 8 device first
//   - file existence: CommandPalette.svelte present + still hand-rolled
//
// Component render + ⌘K wiring is exercised at the human-verify checkpoint
// (manual smoke documented in the plan SUMMARY).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  aggregateItems,
  onKeyArrow,
  runItem,
  type RunContext,
} from '$lib/command-palette/palette-logic.js';
import { rank } from '$lib/command-palette/fuzzy.js';
import { STORAGE_KEY } from '$lib/command-palette/recent.svelte.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPONENT_PATH = resolve(HERE, '../CommandPalette.svelte');

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

describe('[Phase 36-03] CommandPalette component file', () => {
  it('CommandPalette.svelte exists', () => {
    expect(existsSync(COMPONENT_PATH)).toBe(true);
  });

  it('component is hand-rolled — no cmdk-sv or bits-ui imports', () => {
    const src = readFileSync(COMPONENT_PATH, 'utf8');
    expect(src).not.toMatch(/from\s+['"]cmdk-sv['"]/);
    expect(src).not.toMatch(/from\s+['"]bits-ui['"]/);
  });

  it('component exports openPalette + closePalette + uses dialog element', () => {
    const src = readFileSync(COMPONENT_PATH, 'utf8');
    expect(src).toMatch(/export function openPalette/);
    expect(src).toMatch(/export function closePalette/);
    expect(src).toMatch(/<dialog/);
  });
});

describe('[Phase 36-03] aggregateItems', () => {
  it('merges actions + devices + pages into a single FuzzyItem[]', () => {
    const devices = [
      { id: 'd1', name: 'Pixel 8', platform: 'android', state: 'idle' },
    ];
    const items = aggregateItems(devices);
    // 7 actions + 1 device + (>=1) pages
    expect(items.length).toBeGreaterThanOrEqual(8);
    const kinds = new Set(items.map((i) => i.kind));
    expect(kinds.has('action')).toBe(true);
    expect(kinds.has('device')).toBe(true);
    expect(kinds.has('page')).toBe(true);
  });

  it("typing 'pair' ranks 'Pair device' first", () => {
    const items = aggregateItems([]);
    const ranked = rank('pair', items);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].label.toLowerCase()).toContain('pair');
  });

  it("typing 'pixel' ranks Pixel 8 first when present in devices", () => {
    const devices = [
      { id: 'd1', name: 'iPhone 15', platform: 'ios', state: 'idle' },
      { id: 'd2', name: 'Pixel 8', platform: 'android', state: 'idle' },
      { id: 'd3', name: 'Emulator-5554', platform: 'android', state: 'idle' },
    ];
    const items = aggregateItems(devices);
    const ranked = rank('pixel', items);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].label).toBe('Pixel 8');
  });
});

describe('[Phase 36-03] onKeyArrow', () => {
  it('ArrowDown increments selected with wrap', () => {
    expect(onKeyArrow('down', 0, 3)).toBe(1);
    expect(onKeyArrow('down', 2, 3)).toBe(0);
  });

  it('ArrowUp decrements selected with wrap', () => {
    expect(onKeyArrow('up', 1, 3)).toBe(0);
    expect(onKeyArrow('up', 0, 3)).toBe(2);
  });

  it('zero-length filtered list returns 0', () => {
    expect(onKeyArrow('down', 0, 0)).toBe(0);
    expect(onKeyArrow('up', 0, 0)).toBe(0);
  });
});

describe('[Phase 36-03] runItem', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', freshStorage());
  });

  it('runs the item with the supplied context', async () => {
    let gotoHref: string | null = null;
    const ctx: RunContext = { goto: (href) => (gotoHref = href) };
    const items = aggregateItems([]);
    const pairItem = items.find((i) => i.id === 'pair-device');
    expect(pairItem).toBeTruthy();
    await runItem(pairItem!, ctx);
    expect(gotoHref).toBe('/devices/pair');
  });

  it('pushes the item id to recent after running', async () => {
    const ctx: RunContext = { goto: () => {} };
    const items = aggregateItems([]);
    const jobsItem = items.find((i) => i.id === 'go-jobs')!;
    await runItem(jobsItem, ctx);
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toContain('go-jobs');
  });
});
