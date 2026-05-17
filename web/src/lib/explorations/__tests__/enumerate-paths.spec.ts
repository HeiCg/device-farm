/**
 * Phase 35 Plan 35-05 — enumeratePaths spec.
 *
 * Locks the DFS simple-paths semantics ported from
 * `_reference/app-explorer/frontend/src/components/AtlasGraph.tsx:22-40`.
 */
import { describe, it, expect } from 'vitest';

import { enumeratePaths } from '../enumerate-paths.js';
import type { ScreenMap, Screen, Transition } from '../atlas-types.js';

function screen(id: string, title = id): Screen {
  return {
    screen_id: id,
    title,
    screenshot_artifact_id: '00000000-0000-0000-0000-000000000000',
    elements: [],
    notes: null,
    bfs_depth: 0,
  };
}

function tx(from: string, to: string, opts: Partial<Transition> = {}): Transition {
  return {
    from_screen_id: from,
    to_screen_id: to,
    action: { kind: 'tap' },
    is_back_edge: false,
    bfs_order: 0,
    ...opts,
  };
}

function build(screens: Screen[], transitions: Transition[]): ScreenMap {
  return {
    run_id: '00000000-0000-0000-0000-000000000001',
    app_name: 'test',
    platform: 'android',
    screens,
    transitions,
  };
}

describe('enumeratePaths', () => {
  it('returns [] on an empty screen map', () => {
    expect(enumeratePaths(build([], []))).toEqual([]);
  });

  it('returns [[start]] for a single-node graph', () => {
    expect(enumeratePaths(build([screen('A')], []))).toEqual([['A']]);
  });

  it('walks a linear A→B→C graph', () => {
    const paths = enumeratePaths(
      build(
        [screen('A'), screen('B'), screen('C')],
        [tx('A', 'B'), tx('B', 'C')],
      ),
    );
    expect(paths).toEqual([['A', 'B', 'C']]);
  });

  it('enumerates both branches for A→{B,C}', () => {
    const paths = enumeratePaths(
      build(
        [screen('A'), screen('B'), screen('C')],
        [tx('A', 'B'), tx('A', 'C')],
      ),
    );
    expect(paths).toContainEqual(['A', 'B']);
    expect(paths).toContainEqual(['A', 'C']);
    expect(paths.length).toBe(2);
  });

  it('skips cycles (no infinite recursion on A→B→A)', () => {
    const paths = enumeratePaths(
      build([screen('A'), screen('B')], [tx('A', 'B'), tx('B', 'A')]),
    );
    // B→A is filtered by the cycle guard (A already on stack) →
    // path A→B has no forward neighbors → it's emitted as a leaf.
    expect(paths).toEqual([['A', 'B']]);
  });

  it('ignores transitions flagged as back-edges', () => {
    const paths = enumeratePaths(
      build(
        [screen('A'), screen('B'), screen('C')],
        [tx('A', 'B'), tx('B', 'C'), tx('C', 'A', { is_back_edge: true })],
      ),
    );
    expect(paths).toEqual([['A', 'B', 'C']]);
  });

  it('respects the maxPaths cap', () => {
    // A → {B, C, D, E, F} — 5 simple paths total; capped at 2
    const paths = enumeratePaths(
      build(
        ['A', 'B', 'C', 'D', 'E', 'F'].map((id) => screen(id)),
        [tx('A', 'B'), tx('A', 'C'), tx('A', 'D'), tx('A', 'E'), tx('A', 'F')],
      ),
      2,
    );
    expect(paths.length).toBe(2);
  });

  it('de-dupes parallel edges A→B emitted twice (reference parity)', () => {
    const paths = enumeratePaths(
      build([screen('A'), screen('B')], [tx('A', 'B'), tx('A', 'B')]),
    );
    expect(paths).toEqual([['A', 'B']]);
  });
});
