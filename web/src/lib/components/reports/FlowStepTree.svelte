<script lang="ts">
  import type { ReportStepLite } from '$lib/api/types.js';
  import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
  import { groupStepsByFlow, formatDuration } from './flow-step-tree-logic.js';

  let { steps, activeStepId, onSelect }: {
    steps: ReportStepLite[];
    activeStepId: string | null;
    onSelect: (stepId: string) => void;
  } = $props();

  let groups = $derived(groupStepsByFlow(steps));

  function fmtTime(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  }
</script>

<nav class="text-[12px]">
  {#each groups as [flow, list]}
    <div class="mb-2">
      <div class="px-2 py-1 font-mono text-on-surface-variant text-[11px] uppercase tracking-wide">{flow}</div>
      <ul>
        {#each list as step, i (step.id)}
          <li>
            <button
              type="button"
              data-step-id={step.id}
              data-active={activeStepId === step.id}
              class:bg-primary={activeStepId === step.id}
              class:text-on-primary={activeStepId === step.id}
              class="w-full flex items-center gap-2 px-2 py-1 rounded text-left hover:bg-surface-variant/30"
              onclick={() => onSelect(step.id)}
            >
              <span class="w-5 text-right text-[10px] text-on-surface-variant font-mono shrink-0">{i + 1}</span>
              <StatusBadge status={step.status} size={12} />
              <span class="truncate flex-1 font-mono">{step.command ?? step.flowName}</span>
              {#if step.startedAt}
                <span class="text-[10px] text-on-surface-variant font-mono shrink-0">{fmtTime(step.startedAt)}</span>
              {/if}
              <span class="text-[10px] text-on-surface-variant w-10 text-right shrink-0">{formatDuration(step.durationMs)}</span>
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/each}
</nav>
