<!--
  Phase 35 Plan 35-05 — JourneyPanel (left-rail DFS path navigator).

  Port of `_reference/app-explorer/frontend/src/components/JourneyPanel.tsx`
  (259 LoC React → ~270 LoC Svelte 5).

  Two modes:
    - List mode (default): cards per DFS path with flow-tag chip + start→end
      titles + via line + length bar.
    - Stepper mode (when `selectedPathIdx !== null`): path scrubber with
      Prev/Next buttons + dot timeline + step listing.
-->
<script lang="ts">
  import type { ScreenMap } from './atlas-types.js';
  import { getFlowTag } from './flow-tag.js';

  interface Props {
    screenMap: ScreenMap;
    paths: string[][];
    selectedPathIdx: number | null;
    stepIndex: number;
    onSelectPath: (idx: number) => void;
    onClearPath: () => void;
    onGoToStep: (i: number) => void;
  }

  let {
    screenMap,
    paths,
    selectedPathIdx,
    stepIndex,
    onSelectPath,
    onClearPath,
    onGoToStep,
  }: Props = $props();

  const titleById = $derived(() => {
    const m = new Map<string, string>();
    for (const s of screenMap.screens) m.set(s.screen_id, s.title);
    return m;
  });

  function title(id: string): string {
    return titleById().get(id) ?? id;
  }

  const activePath = $derived(
    selectedPathIdx !== null && paths[selectedPathIdx] ? paths[selectedPathIdx] : null,
  );
</script>

<div
  class="atlas-journey-panel w-[300px] shrink-0 bg-zinc-900 border-r border-gray-700 flex flex-col overflow-hidden"
  data-testid="atlas-journey-panel"
>
  {#if selectedPathIdx === null || activePath === null}
    <!-- LIST MODE -->
    <div class="shrink-0 px-4 py-3 border-b border-gray-700">
      <div class="text-xs font-semibold text-gray-200 uppercase tracking-widest">
        User Journeys
      </div>
      <div class="text-[10px] font-mono text-gray-400 mt-0.5">
        {paths.length} paths discovered
      </div>
    </div>

    <div class="flex-1 overflow-y-auto">
      {#each paths as path, i (i)}
        {@const tag = getFlowTag(path, screenMap)}
        {@const startTitle = title(path[0])}
        {@const endTitle = title(path[path.length - 1])}
        {@const viaTitle = path.length > 2 ? title(path[1]) : null}
        <button
          type="button"
          onclick={() => onSelectPath(i)}
          class="w-full text-left px-4 py-3.5 border-b border-gray-800 hover:bg-purple-500/[0.04] transition-colors group"
          data-testid="journey-card"
        >
          <div class="flex items-center justify-between mb-2">
            <span
              class={`text-[9px] font-mono px-1.5 py-0.5 uppercase tracking-wider ${tag.color}`}
            >
              {tag.label}
            </span>
            <span class="text-[10px] font-mono text-gray-400">
              {path.length} screens
            </span>
          </div>

          <div class="flex items-center gap-1.5 mb-1">
            <span class="text-xs font-medium text-gray-200 truncate">
              {startTitle}
            </span>
            <span class="text-purple-300 text-xs shrink-0">→</span>
            <span class="text-xs font-medium text-gray-200 truncate">
              {endTitle}
            </span>
          </div>

          {#if viaTitle}
            <div class="text-[10px] text-gray-400 truncate">
              via {viaTitle}{path.length > 3 ? ` + ${path.length - 3} more` : ''}
            </div>
          {/if}

          <div class="mt-2 flex gap-0.5">
            {#each path as _, j (j)}
              <div
                class="h-1 flex-1 bg-purple-500/20 group-hover:bg-purple-500/40 transition-colors"
                style="max-width: 24px"
              ></div>
            {/each}
          </div>
        </button>
      {/each}

      {#if paths.length === 0}
        <div class="px-4 py-8 text-xs text-gray-500 text-center">
          No paths yet. Waiting for screens to be discovered…
        </div>
      {/if}
    </div>
  {:else}
    <!-- STEPPER MODE -->
    <div class="shrink-0 px-4 py-3 border-b border-gray-700">
      <div class="flex items-center justify-between gap-3 mb-2">
        <button
          type="button"
          onclick={onClearPath}
          class="flex items-center gap-1.5 text-[10px] font-mono text-gray-400 hover:text-purple-300 uppercase tracking-wider"
          data-testid="journey-back"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M10 3L5 8l5 5" />
          </svg>
          All Journeys
        </button>
        <span class="text-[10px] font-mono text-purple-300 shrink-0">
          Step {stepIndex + 1} of {activePath.length}
        </span>
      </div>
      <div class="text-xs font-semibold text-gray-100 leading-snug line-clamp-2">
        {title(activePath[0])} → {title(activePath[activePath.length - 1])}
      </div>
    </div>

    <div class="shrink-0 px-4 py-2.5 border-b border-gray-700 flex items-center gap-3">
      <button
        type="button"
        onclick={() => onGoToStep(stepIndex - 1)}
        disabled={stepIndex === 0}
        class="px-4 py-2 text-[10px] font-mono uppercase tracking-wider border border-gray-700 disabled:opacity-20 hover:border-purple-400/50 hover:text-purple-300"
        data-testid="journey-prev"
      >
        Prev
      </button>
      <div class="flex-1 flex items-center gap-1.5 justify-center flex-wrap">
        {#each activePath as _, i (i)}
          <button
            type="button"
            onclick={() => onGoToStep(i)}
            class={`w-4 h-4 transition-colors ${
              i === stepIndex
                ? 'bg-purple-500'
                : i < stepIndex
                  ? 'bg-purple-500/30'
                  : 'bg-gray-600'
            }`}
            aria-label={`Go to step ${i + 1}`}
          ></button>
        {/each}
      </div>
      <button
        type="button"
        onclick={() => onGoToStep(stepIndex + 1)}
        disabled={stepIndex === activePath.length - 1}
        class="px-4 py-2 text-[10px] font-mono uppercase tracking-wider border border-gray-700 disabled:opacity-20 hover:border-purple-400/50 hover:text-purple-300"
        data-testid="journey-next"
      >
        Next
      </button>
    </div>

    <div class="flex-1 overflow-y-auto">
      {#each activePath as sid, i (i)}
        {@const isCurrent = i === stepIndex}
        {@const isPast = i < stepIndex}
        <button
          type="button"
          onclick={() => onGoToStep(i)}
          class={`w-full text-left flex items-center gap-4 px-4 py-3 border-b transition-colors ${
            isCurrent
              ? 'bg-purple-500/[0.06] border-gray-700/50'
              : 'border-gray-800 hover:bg-white/[0.02]'
          }`}
        >
          <div
            class={`w-7 h-7 shrink-0 flex items-center justify-center text-[11px] font-mono font-medium border ${
              isCurrent
                ? 'border-purple-400 text-purple-300'
                : 'border-gray-700 text-gray-500'
            }`}
          >
            {i + 1}
          </div>
          <div
            class={`truncate ${
              isCurrent
                ? 'text-[13px] text-white'
                : isPast
                  ? 'text-xs text-gray-400'
                  : 'text-xs text-gray-400'
            }`}
          >
            {title(sid)}
          </div>
        </button>
      {/each}
    </div>
  {/if}
</div>
