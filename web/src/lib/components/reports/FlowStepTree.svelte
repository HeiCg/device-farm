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
</script>

<nav class="text-[13px]">
  {#each groups as [flow, list]}
    <div class="mb-3">
      <div class="px-2 py-1 font-mono text-on-surface-variant text-[12px] uppercase tracking-wide">{flow}</div>
      <ul>
        {#each list as step (step.id)}
          <li>
            <button
              type="button"
              data-step-id={step.id}
              data-active={activeStepId === step.id}
              class:bg-primary={activeStepId === step.id}
              class:text-on-primary={activeStepId === step.id}
              class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-surface-variant/30"
              onclick={() => onSelect(step.id)}
            >
              <StatusBadge status={step.status} />
              <span class="truncate flex-1 font-mono">{step.command ?? step.flowName}</span>
              <span class="text-[11px] text-on-surface-variant">{formatDuration(step.durationMs)}</span>
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/each}
</nav>
