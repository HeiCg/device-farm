/**
 * Phase 35 Plan 35-05 — layoutGraph spec.
 *
 * Locks the BFS-aware dagre layout ported from
 * `_reference/app-explorer/frontend/src/components/AtlasGraph.tsx:53-233`.
 *
 * Tests assert the OBSERVABLE behavior: tree-edges feed dagre, back-edges
 * render dashed, terminal screens get __end_ markers, every node gets
 * x/y coordinates from dagre output, and the start node aligns with
 * the entry screen.
 */
import { describe, it, expect } from 'vitest';

import { layoutGraph, NODE_WIDTH, NODE_HEIGHT, MARKER_WIDTH } from '../layout-graph.js';
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
    action: { kind: 'tap', target: 'btn' },
    is_back_edge: false,
    bfs_order: 0,
    ...opts,
  };
}

function build(screens: Screen[], transitions: Transition[]): ScreenMap {
  return {
    run_id: '00000000-0000-0000-0000-000000000001',
    app_name: 'testapp',
    platform: 'android',
    screens,
    transitions,
  };
}

describe('layoutGraph', () => {
  it('returns empty result for an empty screen map', () => {
    const r = layoutGraph(build([], []));
    expect(r.nodes).toEqual([]);
    expect(r.edges).toEqual([]);
    expect(r.treeEdges.size).toBe(0);
  });

  it('renders a single screen with start + end markers + 2 marker edges', () => {
    const r = layoutGraph(build([screen('A')], []));
    // Nodes: __start__ + A + __end_A__ = 3
    expect(r.nodes.map((n) => n.id).sort()).toEqual(['A', '__end_A__', '__start__']);
    // Node types
    const byId = new Map(r.nodes.map((n) => [n.id, n]));
    expect(byId.get('A')?.type).toBe('screen');
    expect(byId.get('__start__')?.type).toBe('startEnd');
    expect(byId.get('__end_A__')?.type).toBe('startEnd');
    // Edges: __start_edge__ + __end_edge_A__ = 2
    expect(r.edges.map((e) => e.id).sort()).toEqual([
      '__end_edge_A__',
      '__start_edge__',
    ]);
  });

  it('identifies BFS tree edges for a linear A→B→C', () => {
    const r = layoutGraph(
      build([screen('A'), screen('B'), screen('C')], [tx('A', 'B'), tx('B', 'C')]),
    );
    expect(r.treeEdges.has('A->B')).toBe(true);
    expect(r.treeEdges.has('B->C')).toBe(true);
    expect(r.treeEdges.size).toBe(2);
  });

  it('back-edge A→B→A renders dashed (NOT in treeEdges)', () => {
    const r = layoutGraph(build([screen('A'), screen('B')], [tx('A', 'B'), tx('B', 'A')]));
    expect(r.treeEdges.has('A->B')).toBe(true);
    expect(r.treeEdges.has('B->A')).toBe(false);
    const backEdge = r.edges.find((e) => e.id === 'B->A');
    expect(backEdge).toBeDefined();
    const backStyle = backEdge!.style ?? '';
    expect(backStyle).toContain('stroke-dasharray:6 4');
    expect(backStyle).toContain('opacity:0.6');
    const treeEdge = r.edges.find((e) => e.id === 'A->B');
    const treeStyle = treeEdge!.style ?? '';
    expect(treeStyle).not.toContain('stroke-dasharray');
    expect(treeStyle).toContain('stroke-width:1.5');
  });

  it('terminal screens get __end_ markers (multiple)', () => {
    // A→B, A→C. Both B and C are terminals.
    const r = layoutGraph(
      build(
        [screen('A'), screen('B'), screen('C')],
        [tx('A', 'B'), tx('A', 'C')],
      ),
    );
    const ids = r.nodes.map((n) => n.id);
    expect(ids).toContain('__end_B__');
    expect(ids).toContain('__end_C__');
    // A is NOT a terminal (it has outgoing) — no __end_A__
    expect(ids).not.toContain('__end_A__');
  });

  it('all nodes have valid numeric x/y positions from dagre', () => {
    const r = layoutGraph(
      build([screen('A'), screen('B'), screen('C')], [tx('A', 'B'), tx('B', 'C')]),
    );
    for (const n of r.nodes) {
      expect(typeof n.position.x).toBe('number');
      expect(typeof n.position.y).toBe('number');
      expect(Number.isFinite(n.position.x)).toBe(true);
      expect(Number.isFinite(n.position.y)).toBe(true);
    }
  });

  it('start marker x-aligns with entry screen center', () => {
    const r = layoutGraph(build([screen('A')], []));
    const start = r.nodes.find((n) => n.id === '__start__')!;
    const entry = r.nodes.find((n) => n.id === 'A')!;
    const startCenterX = start.position.x + MARKER_WIDTH / 2;
    const entryCenterX = entry.position.x + NODE_WIDTH / 2;
    expect(startCenterX).toBeCloseTo(entryCenterX, 5);
  });

  it('emits one edge per (from,to) — parallel actions collapse with "N paths" label', () => {
    const r = layoutGraph(
      build(
        [screen('A'), screen('B')],
        [
          tx('A', 'B', { action: { kind: 'tap', target: 'one' } }),
          tx('A', 'B', { action: { kind: 'tap', target: 'two' } }),
        ],
      ),
    );
    const screenEdges = r.edges.filter((e) => e.source === 'A' && e.target === 'B');
    expect(screenEdges.length).toBe(1);
    expect(screenEdges[0].label).toBe('2 paths');
  });

  it('single transition labels with the action target (verbatim port: tap "Sign In" → Sign In)', () => {
    const r = layoutGraph(
      build(
        [screen('A'), screen('B')],
        [tx('A', 'B', { action: { kind: 'tap', target: '"Sign In"' } })],
      ),
    );
    const e = r.edges.find((e) => e.source === 'A' && e.target === 'B');
    expect(e?.label).toBe('Sign In');
  });

  it('node dimensions are constants — NODE_WIDTH 175 + NODE_HEIGHT 350', () => {
    expect(NODE_WIDTH).toBe(175);
    expect(NODE_HEIGHT).toBe(350);
    expect(MARKER_WIDTH).toBe(160);
  });

  it('start edge is solid green', () => {
    const r = layoutGraph(build([screen('A')], []));
    const startEdge = r.edges.find((e) => e.id === '__start_edge__');
    const style = startEdge!.style ?? '';
    expect(style).toContain('stroke:#10b981');
    expect(style).toContain('stroke-width:2');
  });

  it('end edge is dashed gray', () => {
    const r = layoutGraph(build([screen('A')], []));
    const endEdge = r.edges.find((e) => e.id === '__end_edge_A__');
    const style = endEdge!.style ?? '';
    expect(style).toContain('stroke:#9ca3af');
    expect(style).toContain('stroke-dasharray:6 3');
  });

  it('screen-node data exposes label / screenshot / elementCount / platform', () => {
    const r = layoutGraph(
      build(
        [
          {
            ...screen('A', 'Home'),
            screenshot_artifact_id: '11111111-2222-3333-4444-555555555555',
            elements: [
              { label: 'btn', element_type: 'button', explored: false },
              { label: 'in', element_type: 'input', explored: false },
            ],
          },
        ],
        [],
      ),
    );
    const a = r.nodes.find((n) => n.id === 'A')!;
    expect(a.data).toMatchObject({
      label: 'Home',
      screenshot: '11111111-2222-3333-4444-555555555555',
      elementCount: 2,
      platform: 'android',
    });
  });
});
