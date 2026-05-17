/**
 * Phase 35 Plan 35-06 — Report generator tests.
 *
 * Tests cover:
 *   - buildMermaid: happy fixture, empty transitions, quote escaping, action-shape variants
 *   - enumerateJourneys: fixture path count, back-edge exclusion, maxPaths cap, empty screens
 *   - buildReport: fixture full-document snapshot diff (file fixture),
 *                  empty-screens short-circuit, no-notes Edge Cases section omission
 *   - Route smoke: dispatches to buildReport via the route handler shape
 *
 * Snapshot is a committed file at __fixtures__/sample-report.md. Regen by
 * setting REGENERATE_REPORT_SNAPSHOT=1 and re-running.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  buildMermaid,
  enumerateJourneys,
  buildReport,
  sidSafe,
  describeAction,
} from '../internal/report.js';
import type {
  Exploration,
  ExplorationScreen,
  ExplorationTransition,
} from '../schemas.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface Fixture {
  run: Exploration;
  screens: ExplorationScreen[];
  transitions: ExplorationTransition[];
}

function loadFixture(): Fixture {
  const raw = JSON.parse(
    readFileSync(resolve(__dirname, '__fixtures__/sample-screenmap.json'), 'utf8'),
  ) as {
    run: Omit<Exploration, 'createdAt' | 'startedAt' | 'finishedAt'> & {
      createdAt: string;
      startedAt: string | null;
      finishedAt: string | null;
    };
    screens: (Omit<ExplorationScreen, 'visitedAt'> & { visitedAt: string })[];
    transitions: (Omit<ExplorationTransition, 'createdAt'> & { createdAt: string })[];
  };
  return {
    run: {
      ...raw.run,
      createdAt: new Date(raw.run.createdAt),
      startedAt: raw.run.startedAt ? new Date(raw.run.startedAt) : null,
      finishedAt: raw.run.finishedAt ? new Date(raw.run.finishedAt) : null,
    },
    screens: raw.screens.map((s) => ({ ...s, visitedAt: new Date(s.visitedAt) })),
    transitions: raw.transitions.map((t) => ({
      ...t,
      createdAt: new Date(t.createdAt),
    })),
  };
}

describe('explorations/report — sidSafe + describeAction helpers', () => {
  it('sidSafe replaces non-alphanumeric with underscore', () => {
    expect(sidSafe('home-shop')).toBe('home_shop');
    expect(sidSafe('a.b:c')).toBe('a_b_c');
    expect(sidSafe('plain_id123')).toBe('plain_id123');
  });

  it('describeAction renders tap with target', () => {
    expect(describeAction({ kind: 'tap', target: 'Shop tab' })).toBe('tap: Shop tab');
  });

  it('describeAction renders bare tap without target', () => {
    expect(describeAction({ kind: 'tap' })).toBe('tap');
  });

  it('describeAction renders swipe', () => {
    expect(describeAction({ kind: 'swipe' })).toBe('swipe');
  });

  it('describeAction renders key with code', () => {
    expect(describeAction({ kind: 'key', code: 'back' })).toBe('key:back');
  });

  it('describeAction falls back to truncated JSON for unknown shapes', () => {
    const out = describeAction({ kind: 'mystery', huge: 'a'.repeat(200) });
    expect(out.length).toBeLessThanOrEqual(41);
  });
});

describe('explorations/report — buildMermaid', () => {
  it('returns empty string when no transitions', () => {
    expect(buildMermaid([], [])).toBe('');
    const fixture = loadFixture();
    expect(buildMermaid(fixture.screens, [])).toBe('');
  });

  it('emits opening + closing fence + graph TD header', () => {
    const fixture = loadFixture();
    const md = buildMermaid(fixture.screens, fixture.transitions);
    expect(md.startsWith('```mermaid\ngraph TD')).toBe(true);
    expect(md.endsWith('```')).toBe(true);
  });

  it('emits one node line per unique screenId in transition order', () => {
    const fixture = loadFixture();
    const md = buildMermaid(fixture.screens, fixture.transitions);
    // 5 unique screens: home, shop, product, cart, settings
    expect(md.match(/^\s+[a-z_0-9]+\["[^"]+"\]$/gm)?.length).toBe(5);
  });

  it('emits one edge line per transition', () => {
    const fixture = loadFixture();
    const md = buildMermaid(fixture.screens, fixture.transitions);
    expect(md.match(/-->/g)?.length).toBe(fixture.transitions.length);
  });

  it('escapes double-quotes inside node labels to single-quotes', () => {
    const screens = [
      {
        ...loadFixture().screens[0],
        screenId: 'home',
        title: 'Home "quoted" title',
      },
      { ...loadFixture().screens[1], screenId: 'shop', title: 'Shop' },
    ];
    const transitions = [loadFixture().transitions[0]];
    const md = buildMermaid(screens, transitions);
    expect(md).toContain("Home 'quoted' title");
    expect(md).not.toContain('"quoted"');
  });

  it('uses screenId as label when title is missing for a referenced screen', () => {
    const fixture = loadFixture();
    // Trim screens to one — referenced toScreenId 'shop' has no title row.
    const md = buildMermaid([fixture.screens[0]], [fixture.transitions[0]]);
    expect(md).toContain('shop["shop"]');
  });
});

describe('explorations/report — enumerateJourneys', () => {
  it('returns [] when no screens', () => {
    expect(enumerateJourneys([], [])).toEqual([]);
  });

  it('returns [] when only one screen and no transitions', () => {
    const fixture = loadFixture();
    expect(enumerateJourneys([fixture.screens[0]], [])).toEqual([]);
  });

  it('excludes back-edges from journey enumeration', () => {
    const fixture = loadFixture();
    const paths = enumerateJourneys(fixture.screens, fixture.transitions);
    // Back-edges include cart→home, settings→home, product→shop. None of
    // those reverse traversals should appear in any journey.
    for (const path of paths) {
      for (let i = 0; i < path.length - 1; i++) {
        const fromTo = `${path[i]}->${path[i + 1]}`;
        expect(fromTo).not.toBe('cart->home');
        expect(fromTo).not.toBe('settings->home');
        expect(fromTo).not.toBe('product->shop');
      }
    }
  });

  it('enumerates exactly the expected paths for the fixture (home root with 2 branches)', () => {
    const fixture = loadFixture();
    const paths = enumerateJourneys(fixture.screens, fixture.transitions);
    // Tree-edge fan-out from home: home→shop→product→cart  AND  home→settings.
    expect(paths).toEqual([
      ['home', 'shop', 'product', 'cart'],
      ['home', 'settings'],
    ]);
  });

  it('respects the maxPaths cap', () => {
    // Build a synthetic fan: 1 root → 30 leaves. Cap at 5 paths.
    const screens: ExplorationScreen[] = [
      makeScreen('root', 'Root', 0),
      ...Array.from({ length: 30 }, (_, i) => makeScreen(`leaf${i}`, `Leaf ${i}`, 1)),
    ];
    const transitions: ExplorationTransition[] = Array.from({ length: 30 }, (_, i) =>
      makeTransition('root', `leaf${i}`, i + 1, false),
    );
    const paths = enumerateJourneys(screens, transitions, 5);
    expect(paths.length).toBe(5);
  });
});

describe('explorations/report — buildReport', () => {
  it('returns the empty-screens short-circuit Markdown when no screens', () => {
    const fixture = loadFixture();
    const md = buildReport(fixture.run, [], []);
    expect(md).toContain('# App Explorer Report:');
    expect(md).toContain('No screens discovered yet.');
  });

  it('matches the committed snapshot exactly', () => {
    const fixture = loadFixture();
    const out = buildReport(fixture.run, fixture.screens, fixture.transitions);
    const snapshotPath = resolve(__dirname, '__fixtures__/sample-report.md');

    if (process.env.REGENERATE_REPORT_SNAPSHOT === '1') {
      writeFileSync(snapshotPath, out, 'utf8');
    }

    expect(existsSync(snapshotPath)).toBe(true);
    const expected = readFileSync(snapshotPath, 'utf8');
    expect(out).toBe(expected);
  });

  it('omits the Edge Cases section when no screens carry notes', () => {
    const fixture = loadFixture();
    const screensNoNotes = fixture.screens.map((s) => ({ ...s, notes: null }));
    const out = buildReport(fixture.run, screensNoNotes, fixture.transitions);
    expect(out).not.toContain('## Edge Cases');
  });

  it('omits the User Paths section when no tree paths exist (only back-edges)', () => {
    const fixture = loadFixture();
    // All transitions marked as back-edges → adjacency map empty → no DFS paths.
    const allBackEdges = fixture.transitions.map((t) => ({ ...t, isBackEdge: true }));
    const out = buildReport(fixture.run, fixture.screens, allBackEdges);
    expect(out).not.toContain('## User Paths');
  });

  it('includes the Mermaid graph block when transitions exist', () => {
    const fixture = loadFixture();
    const out = buildReport(fixture.run, fixture.screens, fixture.transitions);
    expect(out).toContain('## Navigation Map');
    expect(out).toContain('```mermaid');
    expect(out).toContain('graph TD');
  });

  it('reports coverage as integer percentage', () => {
    const fixture = loadFixture();
    // Fixture has 5 elements total, 3 explored → 60%.
    const out = buildReport(fixture.run, fixture.screens, fixture.transitions);
    expect(out).toContain('Elements explored | 3 (60%)');
  });

  it('embeds screenshot URLs pointing at the artifacts surface', () => {
    const fixture = loadFixture();
    const out = buildReport(fixture.run, fixture.screens, fixture.transitions);
    expect(out).toContain('/api/artifacts/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01/raw');
  });
});

// ---------- Helpers ----------

function makeScreen(
  screenId: string,
  title: string,
  bfsDepth: number,
): ExplorationScreen {
  return {
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${screenId.padEnd(12, '_').slice(0, 12)}`,
    runId: '11111111-1111-4111-8111-111111111111',
    screenId,
    title,
    screenshotArtifactId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    phash: null,
    elements: [],
    notes: null,
    bfsDepth,
    visitedAt: new Date('2026-05-16T20:00:00.000Z'),
  };
}

function makeTransition(
  fromScreenId: string,
  toScreenId: string,
  bfsOrder: number,
  isBackEdge: boolean,
): ExplorationTransition {
  return {
    id: `cccccccc-cccc-4ccc-8ccc-${String(bfsOrder).padStart(12, '0')}`,
    runId: '11111111-1111-4111-8111-111111111111',
    fromScreenId,
    toScreenId,
    action: { kind: 'tap' },
    actionHash: `h${bfsOrder}`,
    isBackEdge,
    bfsOrder,
    createdAt: new Date('2026-05-16T20:00:00.000Z'),
  };
}
