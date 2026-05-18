<script lang="ts">
  let { active, onSelect }: {
    active: 'list' | 'suites' | 'history' | 'trends';
    onSelect: (t: 'list' | 'suites' | 'history' | 'trends') => void;
  } = $props();

  const tabs: Array<{ id: typeof active; label: string }> = [
    { id: 'list',    label: 'List' },
    { id: 'suites',  label: 'Suites' },
    { id: 'history', label: 'History' },
    { id: 'trends',  label: 'Trends' },
  ];
</script>

<div class="flex items-center gap-0 border-b border-outline-variant/10 mb-6">
  {#each tabs as t}
    <button
      type="button"
      onclick={() => onSelect(t.id)}
      class="px-4 py-2 text-[13px] font-medium border-b-2 -mb-px transition-colors"
      class:text-on-surface={active === t.id}
      class:border-primary={active === t.id}
      class:text-on-surface-variant={active !== t.id}
      class:border-transparent={active !== t.id}
    >
      {t.label}
    </button>
  {/each}
</div>
