/**
 * Phase 35 Plan 35-05 — DFS simple-paths enumeration.
 *
 * Port of `_reference/app-explorer/frontend/src/components/AtlasGraph.tsx`
 * lines 22-40 (`enumeratePaths`).
 *
 * Walks the forward adjacency graph from the entry screen (= first
 * screen in `screens[]`, mirroring the reference) via DFS, collecting
 * simple (cycle-free) paths. Capped at `maxPaths` to keep the
 * JourneyPanel UX responsive on large graphs.
 *
 * Note (intentional deviation from reference): we filter out
 * `is_back_edge: true` transitions BEFORE the DFS rather than treating
 * the adjacency as a multi-set. The reference de-dupes adjacency on
 * insertion (`if (!adj[t.from].includes(t.to))`) which is equivalent
 * to "ignore parallel edges", and the BFS tree-edge identifier in
 * `layout-graph.ts` already marks back-edges. Ignoring them here keeps
 * the path enumeration aligned with the visually-prominent (solid)
 * edges in the rendered graph.
 */
import type { ScreenMap } from './atlas-types.js';

export function enumeratePaths(map: ScreenMap, maxPaths = 20): string[][] {
  if (map.screens.length === 0) return [];

  const adj = new Map<string, string[]>();
  for (const t of map.transitions) {
    if (t.is_back_edge) continue;
    const list = adj.get(t.from_screen_id);
    if (!list) {
      adj.set(t.from_screen_id, [t.to_screen_id]);
    } else if (!list.includes(t.to_screen_id)) {
      list.push(t.to_screen_id);
    }
  }

  const start = map.screens[0].screen_id;
  const paths: string[][] = [];

  function dfs(node: string, path: string[]): void {
    if (paths.length >= maxPaths) return;
    const neighbors = (adj.get(node) ?? []).filter((n) => !path.includes(n));
    if (neighbors.length === 0) {
      // Terminal in the forward graph — record the path. Reference
      // requires `path.length > 1` so a single-node graph yields [].
      // We relax that: a single-node graph yields `[[start]]`, which
      // keeps the JourneyPanel "0 paths" empty state semantically
      // accurate (the start screen IS a degenerate journey).
      paths.push([...path]);
      return;
    }
    for (const n of neighbors) {
      path.push(n);
      dfs(n, path);
      path.pop();
    }
  }

  dfs(start, [start]);
  return paths;
}
