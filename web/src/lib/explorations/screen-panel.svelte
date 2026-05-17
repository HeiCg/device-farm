<!--
  Phase 35 Plan 35-05 — ScreenPanel (right-rail screen detail).

  Port of `_reference/app-explorer/frontend/src/components/ScreenPanel.tsx`
  (178 LoC React → ~210 LoC Svelte 5). Renders:
    - Header with screen title + close button.
    - Click-to-expand screenshot overlay (fixed inset-0 backdrop).
    - Collapsible elements list color-coded by element_type.
    - "Navigates to" list with clickable thumbnails (calls onNavigate).
    - "Reached from" list with clickable thumbnails (calls onNavigate).
-->
<script lang="ts">
  import type { ScreenMap, Screen, ElementType } from './atlas-types.js';

  interface Props {
    screen: Screen;
    screenMap: ScreenMap;
    screenshotBase: string;
    onNavigate: (screenId: string) => void;
    onClose: () => void;
  }

  let { screen, screenMap, screenshotBase, onNavigate, onClose }: Props = $props();

  let showElements = $state(false);
  let imgExpanded = $state(false);

  const screenshotUrl = $derived(`${screenshotBase}/${screen.screenshot_artifact_id}/raw`);
  const outgoing = $derived(
    screenMap.transitions.filter((t) => t.from_screen_id === screen.screen_id),
  );
  const incoming = $derived(
    screenMap.transitions.filter((t) => t.to_screen_id === screen.screen_id),
  );

  function thumbFor(screenId: string): string {
    const s = screenMap.screens.find((sc) => sc.screen_id === screenId);
    if (!s) return '';
    return `${screenshotBase}/${s.screenshot_artifact_id}/raw`;
  }

  function actionLabel(action: Record<string, unknown>): string {
    const kind = typeof action.kind === 'string' ? action.kind : undefined;
    if (kind === 'tap') {
      const target = typeof action.target === 'string' ? action.target : '';
      return target.replace(/['"]/g, '') || 'tap';
    }
    if (kind === 'swipe') return 'swipe';
    if (kind === 'key') {
      const code = typeof action.code === 'string' ? action.code : '';
      return code ? `key:${code}` : 'key';
    }
    return JSON.stringify(action).slice(0, 24);
  }

  const ELEMENT_COLORS: Record<ElementType | 'default', string> = {
    button: 'bg-blue-500/20 text-blue-300',
    tab: 'bg-teal-500/20 text-teal-300',
    input: 'bg-amber-500/20 text-amber-300',
    icon: 'bg-purple-500/20 text-purple-300',
    list_item: 'bg-emerald-500/20 text-emerald-300',
    link: 'bg-cyan-500/20 text-cyan-300',
    text: 'bg-gray-700 text-gray-300',
    default: 'bg-gray-700 text-gray-300',
  };

  function elementColor(type: string): string {
    return (ELEMENT_COLORS as Record<string, string>)[type] ?? ELEMENT_COLORS.default;
  }
</script>

{#if imgExpanded}
  <div
    role="button"
    tabindex="0"
    aria-label="Close expanded screenshot"
    class="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8 cursor-pointer"
    onclick={() => (imgExpanded = false)}
    onkeydown={(e) => {
      if (e.key === 'Escape' || e.key === 'Enter') imgExpanded = false;
    }}
  >
    <img
      src={screenshotUrl}
      alt={screen.title}
      class="max-h-[90vh] max-w-[90vw] object-contain shadow-2xl"
    />
  </div>
{/if}

<div
  class="atlas-screen-panel w-[340px] shrink-0 bg-zinc-900 border-l border-gray-700 flex flex-col overflow-hidden"
  data-testid="atlas-screen-panel"
>
  <!-- Header -->
  <div class="shrink-0 px-4 py-3 border-b border-gray-700 flex items-start justify-between">
    <div class="min-w-0">
      <div class="text-sm font-semibold text-white truncate">{screen.title}</div>
      <div class="text-[11px] font-mono text-gray-400 mt-0.5 truncate">{screen.screen_id}</div>
    </div>
    <button
      type="button"
      onclick={onClose}
      class="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-800 transition-colors shrink-0 ml-2"
      aria-label="Close panel"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path
          d="M1 1L13 13M1 13L13 1"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        />
      </svg>
    </button>
  </div>

  <div class="flex-1 overflow-y-auto">
    <!-- Screenshot -->
    <div class="p-3">
      <button
        type="button"
        class="block w-full border border-gray-700 hover:border-gray-500 transition-colors"
        onclick={() => (imgExpanded = true)}
        aria-label="Expand screenshot"
      >
        <img
          src={screenshotUrl}
          alt={screen.title}
          class="w-full object-contain bg-black"
        />
      </button>
    </div>

    <!-- Notes -->
    {#if screen.notes}
      <div class="px-4 pb-3">
        <div
          class="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 px-3 py-2"
        >
          {screen.notes}
        </div>
      </div>
    {/if}

    <!-- Elements (collapsible) -->
    <div class="px-4 pb-3">
      <button
        type="button"
        onclick={() => (showElements = !showElements)}
        class="flex items-center gap-2 w-full text-left"
      >
        <svg
          class="w-3 h-3 text-gray-400 transition-transform"
          class:rotate-90={showElements}
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path d="M6 3l5 5-5 5" />
        </svg>
        <span class="text-[10px] font-mono text-gray-400 uppercase tracking-wider">
          Elements ({screen.elements.length})
        </span>
      </button>
      {#if showElements}
        <div class="mt-2 space-y-1 pl-5">
          {#each screen.elements as el, i (i)}
            <div class="flex items-center gap-2">
              <span
                class={`text-[8px] font-mono px-1 py-0.5 uppercase shrink-0 ${elementColor(el.element_type)}`}
              >
                {el.element_type}
              </span>
              <span class="text-[10px] text-gray-400 truncate">{el.label}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Navigates to -->
    {#if outgoing.length > 0}
      <div class="px-4 pb-3">
        <div class="text-[10px] font-mono text-gray-400 uppercase tracking-wider mb-2">
          Navigates to ({outgoing.length})
        </div>
        <div class="space-y-1.5">
          {#each outgoing as t, i (i)}
            {@const target = screenMap.screens.find((s) => s.screen_id === t.to_screen_id)}
            <button
              type="button"
              onclick={() => onNavigate(t.to_screen_id)}
              class="w-full flex items-center gap-2.5 p-1.5 border border-gray-700 hover:border-purple-400/50 hover:bg-purple-500/[0.04] transition-all text-left group"
              data-testid="navigate-to"
            >
              <img
                src={thumbFor(t.to_screen_id)}
                alt=""
                class="w-8 h-14 object-cover object-top shrink-0 border border-gray-600"
              />
              <div class="min-w-0 flex-1">
                <div
                  class="text-[10px] font-medium text-gray-300 truncate group-hover:text-purple-300"
                >
                  {target?.title ?? t.to_screen_id}
                </div>
                <div class="text-[9px] text-gray-400 truncate">
                  {actionLabel(t.action)}
                </div>
              </div>
              <svg
                class="w-3 h-3 text-gray-300 group-hover:text-purple-300 shrink-0"
                viewBox="0 0 16 16"
                fill="currentColor"
              >
                <path d="M6 3l5 5-5 5" />
              </svg>
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Reached from -->
    {#if incoming.length > 0}
      <div class="px-4 pb-4">
        <div class="text-[10px] font-mono text-gray-400 uppercase tracking-wider mb-2">
          Reached from ({incoming.length})
        </div>
        <div class="space-y-1.5">
          {#each incoming as t, i (i)}
            {@const source = screenMap.screens.find((s) => s.screen_id === t.from_screen_id)}
            <button
              type="button"
              onclick={() => onNavigate(t.from_screen_id)}
              class="w-full flex items-center gap-2.5 p-1.5 border border-gray-700 hover:border-purple-400/50 hover:bg-purple-500/[0.04] transition-all text-left group"
              data-testid="reached-from"
            >
              <img
                src={thumbFor(t.from_screen_id)}
                alt=""
                class="w-8 h-14 object-cover object-top shrink-0 border border-gray-600"
              />
              <div class="min-w-0 flex-1">
                <div
                  class="text-[10px] font-medium text-gray-300 truncate group-hover:text-purple-300"
                >
                  {source?.title ?? t.from_screen_id}
                </div>
                <div class="text-[9px] text-gray-400 truncate">
                  {actionLabel(t.action)}
                </div>
              </div>
              <svg
                class="w-3 h-3 text-gray-300 group-hover:text-purple-300 shrink-0"
                viewBox="0 0 16 16"
                fill="currentColor"
              >
                <path d="M6 3l5 5-5 5" />
              </svg>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>
