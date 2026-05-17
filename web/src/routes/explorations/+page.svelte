<!--
  Phase 35 Plan 35-05 — Explorations list route.

  Renders the most-recent 100 exploration runs as a table. Each row
  links to /explorations/[id] for the interactive Atlas graph viewer.
-->
<script lang="ts">
  import type { ExplorationListItem } from '$lib/explorations/client.js';

  let { data }: { data: { explorations: ExplorationListItem[] } } = $props();

  function formatTime(iso: string | null): string {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  function statusColor(status: ExplorationListItem['status']): string {
    switch (status) {
      case 'running':
        return 'bg-blue-100 text-blue-800';
      case 'queued':
        return 'bg-amber-100 text-amber-800';
      case 'complete':
        return 'bg-green-100 text-green-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'cancelled':
        return 'bg-gray-100 text-gray-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  }
</script>

<svelte:head><title>Explorations — Device Farm</title></svelte:head>

<div class="space-y-4">
  <header class="flex items-baseline justify-between">
    <h1 class="text-2xl font-semibold">Explorations</h1>
    <p class="text-xs text-gray-500">
      Start a run via the CLI: <code class="bg-gray-100 px-1 rounded">device-farm explore --apk myapp.apk</code>
    </p>
  </header>

  {#if data.explorations.length === 0}
    <p class="text-gray-500 text-sm py-8 text-center border border-dashed rounded">
      No explorations yet. Start one from the CLI to see it appear here.
    </p>
  {:else}
    <div class="overflow-x-auto border rounded">
      <table class="w-full text-sm">
        <thead class="bg-gray-50 border-b">
          <tr>
            <th class="text-left p-2 font-medium">Bundle ID</th>
            <th class="text-left p-2 font-medium">Platform</th>
            <th class="text-left p-2 font-medium">Status</th>
            <th class="text-right p-2 font-medium">Screens</th>
            <th class="text-left p-2 font-medium">Started</th>
            <th class="text-left p-2 font-medium">Action</th>
          </tr>
        </thead>
        <tbody>
          {#each data.explorations as exp (exp.id)}
            <tr class="border-b hover:bg-gray-50">
              <td class="p-2 font-mono text-xs">{exp.bundleId}</td>
              <td class="p-2 capitalize">{exp.platform}</td>
              <td class="p-2">
                <span class={`inline-block px-2 py-0.5 text-xs rounded ${statusColor(exp.status)}`}>
                  {exp.status}
                </span>
              </td>
              <td class="p-2 text-right font-mono text-xs">{exp.screensCount}</td>
              <td class="p-2 text-xs">{formatTime(exp.startedAt ?? exp.createdAt)}</td>
              <td class="p-2">
                <a
                  href="/explorations/{exp.id}"
                  class="text-blue-600 hover:underline"
                  data-testid="view-exploration"
                >View</a>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
