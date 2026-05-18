<script lang="ts">
  import type { ReportBundle } from '$lib/api/types.js';

  let { history }: { history: ReportBundle['history'] } = $props();
</script>

{#if !history}
  <div class="text-[12px] text-on-surface-variant">No history</div>
{:else}
  <div class="space-y-2">
    <div class="font-mono text-[13px] text-on-surface">{history.flowName}</div>
    <div class="text-[12px] text-on-surface-variant">
      Pass: {Math.round(history.passRate * 100)}% · avg {(history.avgDurationMs / 1000).toFixed(1)}s
    </div>
    <div class="flex gap-[2px]" data-testid="history-strip">
      {#each history.runs as run}
        <span
          data-outcome={run.status}
          class="w-3 h-3 rounded-sm"
          class:bg-primary={run.status === 'passed'}
          class:bg-tertiary={run.status === 'failed'}
          class:bg-outline-variant={run.status !== 'passed' && run.status !== 'failed'}
          title={`${run.status} · ${run.finishedAt ?? ''}`}
        ></span>
      {/each}
    </div>
  </div>
{/if}
