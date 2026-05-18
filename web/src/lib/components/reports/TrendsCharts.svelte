<script lang="ts">
  import type { TrendsOutput } from '$lib/api/reports.js';
  let { trends }: { trends: TrendsOutput } = $props();
  let max = $derived(Math.max(1, ...trends.byDay.map((d) => d.total)));
</script>

<div class="space-y-6">
  <section>
    <h3 class="text-[14px] font-semibold mb-2">By day (pass/fail)</h3>
    <div class="flex items-end gap-1 h-32">
      {#each trends.byDay as d}
        <div class="flex flex-col-reverse items-center w-8" title={`${d.date}: ${d.passed} passed, ${d.failed} failed`}>
          <div class="bg-primary w-full" style="height: {(d.passed / max) * 100}%"></div>
          <div class="bg-tertiary w-full" style="height: {(d.failed / max) * 100}%"></div>
        </div>
      {/each}
    </div>
    <div class="flex gap-1 mt-1 text-[10px] text-on-surface-variant">
      {#each trends.byDay as d}
        <span class="w-8 text-center truncate">{d.date.slice(5)}</span>
      {/each}
    </div>
  </section>

  <section>
    <h3 class="text-[14px] font-semibold mb-2">By flow</h3>
    <table class="text-[13px]">
      <tbody>
        {#each trends.byFlow as f}
          <tr>
            <td class="font-mono pr-4">{f.flowName}</td>
            <td class="text-primary pr-2">{f.passed}</td>
            <td class="text-tertiary">{f.failed}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
</div>
