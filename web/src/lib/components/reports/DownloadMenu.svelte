<script lang="ts">
  let { junitXml, logsRaw }: { junitXml: string; logsRaw: string } = $props();
  let open = $state(false);
</script>

<div class="relative inline-block">
  <button
    type="button"
    onclick={() => (open = !open)}
    class="inline-flex items-center gap-1 rounded border border-outline-variant/30 px-3 py-1.5 text-[12px] font-medium hover:bg-surface-variant/30"
  >
    Download <span class="material-symbols-outlined text-[16px]">arrow_drop_down</span>
  </button>
  {#if open}
    <div class="absolute right-0 mt-1 w-44 bg-background border border-outline-variant/20 rounded shadow-lg z-10">
      <a href={junitXml} download class="block px-3 py-2 text-[13px] hover:bg-surface-variant/40">JUnit XML</a>
      <a href={logsRaw}  download class="block px-3 py-2 text-[13px] hover:bg-surface-variant/40">Raw logs</a>
    </div>
  {/if}
</div>
