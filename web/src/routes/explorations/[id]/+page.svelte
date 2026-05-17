<!--
  Phase 35 Plan 35-05 — Exploration detail route.

  Loads exploration + screens + transitions via REST and renders the
  Atlas graph. For queued/running runs, opens a WebSocket connection
  to merge live `screen-discovered` and `transition` frames into the
  local screenMap state — AtlasGraph re-runs layoutGraph on every
  mutation via $effect.

  Server returns camelCase row shapes (per schemas.ts); we adapt to
  the snake_case ScreenMap shape used inside web/explorations/ at
  the boundary, preserving the React→Svelte port fidelity.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { getApiKey } from '$lib/auth/auth-store.svelte.js';
  import AtlasGraph from '$lib/explorations/atlas-graph.svelte';
  import {
    openExplorationWs,
    type ExplorationWsClient,
  } from '$lib/explorations/ws-client.js';
  import type { ScreenMap } from '$lib/explorations/atlas-types.js';
  import type {
    ExplorationGetResponse,
    ExplorationScreenRow,
    ExplorationTransitionRow,
  } from '$lib/explorations/client.js';

  let { data }: { data: ExplorationGetResponse } = $props();

  function adaptScreen(s: ExplorationScreenRow) {
    return {
      screen_id: s.screenId,
      title: s.title,
      screenshot_artifact_id: s.screenshotArtifactId,
      elements: s.elements,
      notes: s.notes,
      bfs_depth: s.bfsDepth,
    };
  }

  function adaptTransition(t: ExplorationTransitionRow) {
    return {
      from_screen_id: t.fromScreenId,
      to_screen_id: t.toScreenId,
      action: t.action,
      is_back_edge: t.isBackEdge,
      bfs_order: t.bfsOrder,
    };
  }

  // Initial capture is intentional: the server-loaded payload is the
  // seed, and WS frames mutate `screenMap` from there. We don't want
  // re-renders if SvelteKit re-runs the loader (we'd lose live frames).
  // svelte-ignore state_referenced_locally
  let screenMap = $state<ScreenMap>({
    run_id: data.exploration.id,
    app_name: data.exploration.bundleId,
    platform: data.exploration.platform,
    screens: data.screens.map(adaptScreen),
    transitions: data.transitions.map(adaptTransition),
  });
  // svelte-ignore state_referenced_locally
  let status = $state(data.exploration.status);
  let liveError = $state<string | null>(null);

  let ws: ExplorationWsClient | null = null;

  onMount(() => {
    if (status !== 'running' && status !== 'queued') return;

    const token = getApiKey() ?? undefined;
    ws = openExplorationWs({
      runId: data.exploration.id,
      baseUrl: window.location.origin,
      token,
      onScreenDiscovered: (s) => {
        // Idempotent insert — guard against duplicate frames (replay
        // window from the broadcaster history).
        if (screenMap.screens.some((x) => x.screen_id === s.screen_id)) return;
        screenMap = { ...screenMap, screens: [...screenMap.screens, s] };
      },
      onTransition: (t) => {
        screenMap = { ...screenMap, transitions: [...screenMap.transitions, t] };
      },
      onFinished: ({ reason }) => {
        status =
          reason === 'cancelled'
            ? 'cancelled'
            : reason === 'login_required'
              ? 'failed'
              : 'complete';
        ws?.close();
        ws = null;
      },
      onError: (msg) => {
        liveError = msg;
      },
    });
  });

  onDestroy(() => {
    ws?.close();
    ws = null;
  });
</script>

<svelte:head><title>Exploration {data.exploration.bundleId} — Device Farm</title></svelte:head>

<div class="-mx-6 -my-6">
  <header class="px-6 py-3 border-b bg-white sticky top-0 z-10">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-lg font-medium">
          <a href="/explorations" class="text-gray-500 hover:underline">Explorations</a>
          <span class="text-gray-300 mx-1">/</span>
          {data.exploration.bundleId}
        </h1>
        <div class="text-xs text-gray-500 mt-0.5">
          Status: <span class="font-medium">{status}</span> ·
          Platform: {data.exploration.platform} ·
          {screenMap.screens.length} screens ·
          {screenMap.transitions.length} transitions
        </div>
      </div>
      {#if status === 'running' || status === 'queued'}
        <div class="flex items-center gap-2 text-xs text-blue-700">
          <span class="relative flex h-2 w-2">
            <span
              class="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"
            ></span>
            <span class="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
          </span>
          Live
        </div>
      {/if}
    </div>
    {#if liveError}
      <div
        class="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 px-3 py-1.5 rounded"
      >
        Live update error: {liveError}
      </div>
    {/if}
  </header>

  <div style="height: calc(100vh - 88px)">
    <AtlasGraph {screenMap} screenshotBase="/api/artifacts" />
  </div>
</div>
