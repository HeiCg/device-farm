<!--
  Phase 35 Plan 35-05 — Atlas Graph (interactive xyflow + dagre).

  Port of `_reference/app-explorer/frontend/src/components/AtlasGraph.tsx`
  (459 LoC React → ~280 LoC Svelte 5). Wires:
    - `layoutGraph(screenMap)` (BFS-aware dagre layout)
    - `enumeratePaths(screenMap)` (DFS journey enumeration)
    - `<SvelteFlow>` from @xyflow/svelte with custom screen + startEnd node types
    - `JourneyPanel` (left rail) + `ScreenPanel` (right rail)

  Live updates: any change to `screenMap` (reactive prop) re-runs
  layoutGraph via `$effect`. Heavy arrays held in `$state.raw` so deep
  tracking doesn't fire on every layout pass.
-->
<script lang="ts">
  import {
    SvelteFlow,
    Background,
    Controls,
    ConnectionLineType,
    type Node,
    type Edge,
    type NodeTypes,
  } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';

  import ScreenNode from './screen-node.svelte';
  import StartEndNode from './start-end-node.svelte';
  import ScreenPanel from './screen-panel.svelte';
  import JourneyPanel from './journey-panel.svelte';

  import { layoutGraph } from './layout-graph.js';
  import { enumeratePaths } from './enumerate-paths.js';
  import type { ScreenMap } from './atlas-types.js';

  interface Props {
    screenMap: ScreenMap;
    screenshotBase?: string;
  }

  let { screenMap, screenshotBase = '/api/artifacts' }: Props = $props();

  // Heavy arrays held raw so SvelteFlow's bind: doesn't trip the deep
  // reactivity proxy. layoutGraph + enumeratePaths run on every
  // screenMap change.
  let nodes = $state.raw<Node[]>([]);
  let edges = $state.raw<Edge[]>([]);
  let paths = $state.raw<string[][]>([]);

  $effect(() => {
    const layouted = layoutGraph(screenMap);
    // Stamp screenshotBase onto every screen node's data so ScreenNode
    // composes the URL correctly.
    nodes = layouted.nodes.map((n) =>
      n.type === 'screen'
        ? {
            ...n,
            data: { ...(n.data as Record<string, unknown>), screenshotBase },
          }
        : n,
    );
    edges = layouted.edges;
    paths = enumeratePaths(screenMap);
  });

  // Cast through `unknown` — xyflow's NodeTypes is a strict mapping
  // from a discriminator string to a `Component<NodeProps & {data:any}>`,
  // but Svelte's per-file `Component<Props>` type narrows `data` to the
  // exact prop shape declared inside the .svelte file. The runtime
  // contract holds (xyflow passes the data prop through to the
  // component verbatim) — only the type-level generic narrowing
  // misaligns, so the cast is safe.
  const nodeTypes = { screen: ScreenNode, startEnd: StartEndNode } as unknown as NodeTypes;

  let activeScreenId = $state<string | null>(null);
  let selectedPathIdx = $state<number | null>(null);
  let stepIndex = $state(0);

  const activeScreen = $derived(
    activeScreenId ? screenMap.screens.find((s) => s.screen_id === activeScreenId) ?? null : null,
  );

  function selectScreen(id: string): void {
    if (id.startsWith('__')) return;
    activeScreenId = id;
  }

  // xyflow/svelte's `onnodeclick` signature is `({node, event}) => void`
  // (single object parameter, unlike React's positional `(event, node)`).
  function onNodeClick({ node }: { node: Node; event: MouseEvent | TouchEvent }): void {
    if (node.id === '__start__') {
      if (screenMap.screens.length > 0) selectScreen(screenMap.screens[0].screen_id);
      return;
    }
    if (node.id.startsWith('__')) return;
    selectScreen(node.id);
  }

  function onSelectPath(idx: number): void {
    if (idx < 0 || idx >= paths.length) return;
    selectedPathIdx = idx;
    stepIndex = 0;
  }
  function onClearPath(): void {
    selectedPathIdx = null;
    stepIndex = 0;
  }
  function onGoToStep(i: number): void {
    if (selectedPathIdx === null) return;
    const path = paths[selectedPathIdx];
    if (!path) return;
    stepIndex = Math.max(0, Math.min(i, path.length - 1));
  }
</script>

<div class="atlas-graph-root flex w-full h-full">
  <JourneyPanel
    {screenMap}
    {paths}
    {selectedPathIdx}
    {stepIndex}
    {onSelectPath}
    {onClearPath}
    {onGoToStep}
  />

  <div class="atlas-graph-canvas flex-1 relative">
    <SvelteFlow
      bind:nodes
      bind:edges
      {nodeTypes}
      fitView
      minZoom={0.08}
      maxZoom={1.5}
      connectionLineType={ConnectionLineType.SmoothStep}
      proOptions={{ hideAttribution: true }}
      onnodeclick={onNodeClick}
    >
      <Background />
      <Controls showLock={false} />
    </SvelteFlow>
  </div>

  {#if activeScreen}
    <ScreenPanel
      screen={activeScreen}
      {screenMap}
      {screenshotBase}
      onNavigate={selectScreen}
      onClose={() => (activeScreenId = null)}
    />
  {/if}
</div>

<style>
  .atlas-graph-root {
    min-height: 600px;
    color: rgb(229 231 235);
    background: rgb(9 9 11);
  }
  .atlas-graph-canvas {
    background: rgb(9 9 11);
  }
</style>
