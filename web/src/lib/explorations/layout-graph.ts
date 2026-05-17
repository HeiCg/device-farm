/**
 * Phase 35 Plan 35-05 — BFS-aware dagre layout.
 *
 * Port of `_reference/app-explorer/frontend/src/components/AtlasGraph.tsx`
 * lines 53-233 (`layoutGraph`). The same algorithm, the same constants,
 * the same edge styling, ported from `@xyflow/react` + `dagre` to
 * `@xyflow/svelte` + `@dagrejs/dagre`.
 *
 * Algorithm:
 *   1. BFS from the entry screen (first screen in `screens[]`) builds
 *      depth + identifies tree-edges (`from->to` keys that DISCOVER a
 *      new node).
 *   2. Terminal screens (no outgoing) get synthetic `__end_<id>__`
 *      marker nodes.
 *   3. Only the BFS-tree edges + start/end markers feed dagre, so back-
 *      edges + cross-edges don't distort the vertical layout.
 *   4. Back-edges are drawn AFTER layout as dashed bezier overlays.
 *
 * Styling (verbatim from reference, transposed to xyflow/svelte's
 * string-only `style` field — xyflow/react accepts CSSProperties
 * objects but xyflow/svelte accepts a literal CSS string):
 *   - Tree edges: solid `#9D61FF` strokeWidth 1.5
 *   - Back-edges: dashed `#9D61FF` strokeWidth 1, opacity 0.6
 *   - Start edge: green `#10b981` strokeWidth 2
 *   - End edges: dashed gray `#9ca3af`
 *   - Edge labels: JetBrains Mono 11px
 */
import dagre from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/svelte';

import type { ScreenMap } from './atlas-types.js';

export const NODE_WIDTH = 175;
export const NODE_HEIGHT = 350;
export const MARKER_WIDTH = 160;
export const MARKER_HEIGHT = 50;

/**
 * `Position` values mirror `@xyflow/system/utils.Position` enum.
 * Inlined as a string-literal const so vitest (running under Node ESM,
 * which cannot resolve `@xyflow/svelte`'s directory-import dist tree)
 * can load this module without pulling the whole package in. At
 * runtime the literal values round-trip through xyflow's runtime
 * checks identically — the package just compares against the same
 * string constants.
 */
type PositionLiteral = 'top' | 'right' | 'bottom' | 'left';
const POS_TOP: PositionLiteral = 'top';
const POS_BOTTOM: PositionLiteral = 'bottom';

const TREE_EDGE_STYLE = 'stroke:#9D61FF;stroke-width:1.5;';
const BACK_EDGE_STYLE =
  'stroke:#9D61FF;stroke-width:1;stroke-dasharray:6 4;opacity:0.6;';
const START_EDGE_STYLE = 'stroke:#10b981;stroke-width:2;';
const END_EDGE_STYLE = 'stroke:#9ca3af;stroke-width:1.5;stroke-dasharray:6 3;';

const LABEL_STYLE =
  'fill:#C4A1FF;font-size:11px;font-weight:500;font-family:JetBrains Mono, monospace;';
const START_LABEL_STYLE =
  'fill:#6ee7b7;font-size:11px;font-weight:500;font-family:JetBrains Mono, monospace;';

/**
 * Build a short human-readable label for a transition action.
 * Mirrors the reference's "strip `tap ` prefix + single-quote / double-quote
 * scrub" behavior, but handles our typed action envelopes too:
 *   - `{ kind: 'tap', target?: string }` → `target` (or `tap`)
 *   - `{ kind: 'swipe' }`                → `swipe`
 *   - `{ kind: 'key', code?: string }`   → `key:code` (or `key`)
 *   - anything else                       → JSON-truncated to 24 chars
 */
function describeAction(action: Record<string, unknown>): string {
  const kind = typeof action.kind === 'string' ? action.kind : undefined;
  if (kind === 'tap') {
    const target = typeof action.target === 'string' ? action.target : '';
    return target ? target.replace(/['"]/g, '') : 'tap';
  }
  if (kind === 'swipe') return 'swipe';
  if (kind === 'key') {
    const code = typeof action.code === 'string' ? action.code : '';
    return code ? `key:${code}` : 'key';
  }
  // Fallback: legacy string-shaped actions wrapped in {value:'tap "Sign In"'}
  if (typeof action.value === 'string') {
    return action.value.replace(/^tap\s*/, '').replace(/['"]/g, '');
  }
  return JSON.stringify(action).slice(0, 24);
}

export interface LayoutResult {
  nodes: Node[];
  edges: Edge[];
  /** Exposed for tests + debugging — the BFS tree-edge key set. */
  treeEdges: Set<string>;
}

export function layoutGraph(map: ScreenMap): LayoutResult {
  if (!map.screens.length) {
    return { nodes: [], edges: [], treeEdges: new Set() };
  }

  const entryId = map.screens[0].screen_id;

  // ── BFS depth + tree-edge identification ──────────────────────────
  const adj = new Map<string, Set<string>>();
  for (const t of map.transitions) {
    let bucket = adj.get(t.from_screen_id);
    if (!bucket) {
      bucket = new Set();
      adj.set(t.from_screen_id, bucket);
    }
    bucket.add(t.to_screen_id);
  }

  const depth = new Map<string, number>([[entryId, 0]]);
  const treeEdges = new Set<string>();
  const queue: string[] = [entryId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const next = adj.get(current);
    if (!next) continue;
    for (const n of next) {
      if (!depth.has(n)) {
        depth.set(n, depth.get(current)! + 1);
        treeEdges.add(`${current}->${n}`);
        queue.push(n);
      }
    }
  }
  for (const s of map.screens) {
    if (!depth.has(s.screen_id)) depth.set(s.screen_id, 0);
  }

  // ── Terminal screens (no outgoing) ────────────────────────────────
  const hasOutgoing = new Set(map.transitions.map((t) => t.from_screen_id));
  const terminalIds = map.screens
    .filter((s) => !hasOutgoing.has(s.screen_id))
    .map((s) => s.screen_id);

  // ── Dagre: only tree edges + start/end synthetics ────────────────
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: 'TB',
    nodesep: 100,
    ranksep: 100,
    marginx: 60,
    marginy: 60,
  });

  g.setNode('__start__', { width: MARKER_WIDTH, height: MARKER_HEIGHT });
  for (const s of map.screens) {
    g.setNode(s.screen_id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const tid of terminalIds) {
    g.setNode(`__end_${tid}__`, { width: MARKER_WIDTH, height: MARKER_HEIGHT });
  }

  g.setEdge('__start__', entryId);
  for (const key of treeEdges) {
    const [from, to] = key.split('->');
    g.setEdge(from, to);
  }
  for (const tid of terminalIds) {
    g.setEdge(tid, `__end_${tid}__`);
  }

  dagre.layout(g);

  // ── Build screen nodes ────────────────────────────────────────────
  const nodes: Node[] = [];
  const screenPositions = new Map<string, { x: number; y: number }>();

  for (const screen of map.screens) {
    const pos = g.node(screen.screen_id);
    const xy = { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 };
    screenPositions.set(screen.screen_id, xy);
    nodes.push({
      id: screen.screen_id,
      type: 'screen',
      position: xy,
      data: {
        label: screen.title,
        screenshot: screen.screenshot_artifact_id,
        elementCount: screen.elements.length,
        notes: screen.notes ?? null,
        platform: map.platform,
      },
      sourcePosition: POS_BOTTOM as unknown as Node['sourcePosition'],
      targetPosition: POS_TOP as unknown as Node['targetPosition'],
    });
  }

  // Start marker — align with entry screen center
  const startPos = g.node('__start__');
  const entryPos = screenPositions.get(entryId);
  const startX = entryPos
    ? entryPos.x + NODE_WIDTH / 2 - MARKER_WIDTH / 2
    : startPos.x - MARKER_WIDTH / 2;
  nodes.unshift({
    id: '__start__',
    type: 'startEnd',
    position: { x: startX, y: startPos.y - MARKER_HEIGHT / 2 },
    data: { label: `Start: ${map.app_name}`, nodeKind: 'start' },
    sourcePosition: POS_BOTTOM as unknown as Node['sourcePosition'],
    targetPosition: POS_TOP as unknown as Node['targetPosition'],
  });

  // End markers — align with terminal screen centers
  const titleById = new Map<string, string>();
  for (const s of map.screens) titleById.set(s.screen_id, s.title);

  for (const tid of terminalIds) {
    const pos = g.node(`__end_${tid}__`);
    const parentPos = screenPositions.get(tid);
    const endX = parentPos
      ? parentPos.x + NODE_WIDTH / 2 - MARKER_WIDTH / 2
      : pos.x - MARKER_WIDTH / 2;
    nodes.push({
      id: `__end_${tid}__`,
      type: 'startEnd',
      position: { x: endX, y: pos.y - MARKER_HEIGHT / 2 },
      data: { label: `End: ${titleById.get(tid) ?? tid}`, nodeKind: 'end' },
      sourcePosition: POS_BOTTOM as unknown as Node['sourcePosition'],
      targetPosition: POS_TOP as unknown as Node['targetPosition'],
    });
  }

  // ── Build edges ───────────────────────────────────────────────────
  const edges: Edge[] = [];

  // Start edge (always solid green to the entry screen)
  edges.push({
    id: '__start_edge__',
    source: '__start__',
    target: entryId,
    type: 'smoothstep',
    label: 'entry',
    style: START_EDGE_STYLE,
    labelStyle: START_LABEL_STYLE,
  });

  // Screen→screen edges. Multiple transitions between the same
  // (from,to) pair are merged into a single edge with an "N paths"
  // label, mirroring the reference.
  const edgeBucket = new Map<string, Record<string, unknown>[]>();
  for (const t of map.transitions) {
    const key = `${t.from_screen_id}->${t.to_screen_id}`;
    const list = edgeBucket.get(key);
    if (list) list.push(t.action);
    else edgeBucket.set(key, [t.action]);
  }

  for (const [key, actions] of edgeBucket) {
    const [source, target] = key.split('->');
    const label =
      actions.length === 1 ? describeAction(actions[0]) : `${actions.length} paths`;
    const isTree = treeEdges.has(key);
    edges.push({
      id: key,
      source,
      target,
      type: 'smoothstep',
      label,
      style: isTree ? TREE_EDGE_STYLE : BACK_EDGE_STYLE,
      labelStyle: LABEL_STYLE,
    });
  }

  // End edges
  for (const tid of terminalIds) {
    edges.push({
      id: `__end_edge_${tid}__`,
      source: tid,
      target: `__end_${tid}__`,
      type: 'smoothstep',
      style: END_EDGE_STYLE,
    });
  }

  return { nodes, edges, treeEdges };
}

// Re-export the describer for tests + dev tooling.
export { describeAction };
