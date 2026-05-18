<script lang="ts">
  import type { SuiteAggregate } from '$lib/api/reports.js';
  let { suites }: { suites: SuiteAggregate[] } = $props();
</script>

<table class="w-full text-[13px]">
  <thead class="text-[11px] uppercase text-on-surface-variant border-b border-outline-variant/10">
    <tr>
      <th class="text-left py-2">Flow</th>
      <th class="text-right py-2">Runs</th>
      <th class="text-right py-2">Pass rate</th>
      <th class="text-right py-2">Avg duration</th>
      <th class="text-right py-2">Trend</th>
      <th class="text-right py-2">Last run</th>
    </tr>
  </thead>
  <tbody>
    {#each suites as s}
      <tr class="border-b border-outline-variant/5">
        <td class="py-2 font-mono">{s.flowName}</td>
        <td class="py-2 text-right">{s.totalRuns}</td>
        <td class="py-2 text-right">{Math.round(s.passRate * 100)}%</td>
        <td class="py-2 text-right">{(s.avgDurationMs / 1000).toFixed(1)}s</td>
        <td class="py-2 text-right">
          <span class="inline-flex gap-[1px] align-middle">
            {#each s.trend as v}
              <span class="w-2 h-3 inline-block rounded-sm" class:bg-primary={v === 1} class:bg-tertiary={v === 0}></span>
            {/each}
          </span>
        </td>
        <td class="py-2 text-right text-on-surface-variant">{s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : '—'}</td>
      </tr>
    {/each}
  </tbody>
</table>
