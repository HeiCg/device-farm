<script lang="ts">
  let { jobId, open, mintFn, onClose }: {
    jobId: string;
    open: boolean;
    mintFn: (jobId: string, ttl: 5 | 15 | 30) => Promise<{ token: string; url: string; expiresAt: string }>;
    onClose: () => void;
  } = $props();

  let ttl: 5 | 15 | 30 = $state(30);
  let result: { url: string; expiresAt: string } | null = $state(null);
  let loading = $state(false);
  let error: string | null = $state(null);

  async function generate() {
    loading = true;
    error = null;
    try {
      const r = await mintFn(jobId, ttl);
      result = { url: r.url, expiresAt: r.expiresAt };
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to mint share token';
    } finally {
      loading = false;
    }
  }

  async function copy() {
    if (result) await navigator.clipboard.writeText(window.location.origin + result.url);
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    role="dialog"
    aria-modal="true"
    class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
    onclick={onClose}
    onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}
    tabindex="-1"
  >
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="bg-background rounded-lg p-6 max-w-md w-full"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      role="document"
    >
      <h2 class="text-[16px] font-semibold mb-4">Share this report</h2>

      <label class="block text-[13px] mb-2">
        <span class="text-on-surface-variant">TTL (days)</span>
        <select bind:value={ttl} class="ml-2 rounded border border-outline-variant/30 px-2 py-1">
          <option value={5}>5</option>
          <option value={15}>15</option>
          <option value={30}>30</option>
        </select>
      </label>

      <button
        type="button"
        onclick={generate}
        disabled={loading}
        class="rounded bg-primary text-on-primary px-3 py-1.5 text-[13px] disabled:opacity-50"
      >
        {loading ? 'Generating…' : 'Generate'}
      </button>

      {#if result}
        <div class="mt-4 space-y-2">
          <input readonly value={result.url} class="w-full rounded border border-outline-variant/30 px-2 py-1 text-[12px] font-mono" />
          <div class="flex justify-between items-center text-[12px]">
            <span class="text-on-surface-variant">Expires {new Date(result.expiresAt).toLocaleString()}</span>
            <button type="button" onclick={copy} class="text-primary hover:underline">Copy</button>
          </div>
        </div>
      {/if}

      {#if error}
        <div class="mt-3 text-tertiary text-[12px]">{error}</div>
      {/if}
    </div>
  </div>
{/if}
