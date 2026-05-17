<!--
  Phase 36 Plan 36-03 — CommandPalette (hand-rolled, ~150 LOC).

  Svelte 5 + fuzzysort. NO cmdk-sv (deprecated), NO bits-ui (too heavy).

  Behavior:
    - openPalette() / closePalette() exported for the +layout.svelte ⌘K
      keybinding wiring + programmatic invocation.
    - <dialog> element with native modal semantics (Esc closes via the
      browser; we mirror to state via onclose).
    - $derived.by chain: deviceStore.devices → aggregateItems() → rank().
      Pitfall 7 (RESEARCH §) — ranking must be $derived not $effect so the
      filtered list updates synchronously with input changes.
    - ArrowUp / ArrowDown wraps the selected index; Enter runs the item via
      runItem() (which records to recents) then closes the dialog.
-->
<script lang="ts">
  import { goto } from '$app/navigation';

  import { rank } from '$lib/command-palette/fuzzy.js';
  import {
    aggregateItems,
    onKeyArrow,
    runItem,
    type RunContext,
  } from '$lib/command-palette/palette-logic.js';
  import { deviceStore } from '$lib/stores/devices.svelte.js';

  let open = $state(false);
  let search = $state('');
  let selected = $state(0);
  let dialogEl = $state<HTMLDialogElement | undefined>(undefined);
  let inputEl = $state<HTMLInputElement | undefined>(undefined);

  const ctx: RunContext = { goto: (href) => goto(href) };

  let items = $derived.by(() => aggregateItems(deviceStore.devices));
  let filtered = $derived.by(() => rank(search, items));

  // Reset selected when the filtered list shrinks past the current cursor.
  $effect(() => {
    if (selected >= filtered.length) selected = 0;
  });

  export function openPalette(): void {
    open = true;
    search = '';
    selected = 0;
    // showModal must run after the dialog is attached on next tick.
    requestAnimationFrame(() => {
      try {
        dialogEl?.showModal();
      } catch {
        // showModal throws if already open — harmless.
      }
      inputEl?.focus();
    });
  }

  export function closePalette(): void {
    open = false;
    if (dialogEl?.open) dialogEl.close();
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selected = onKeyArrow('down', selected, filtered.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      selected = onKeyArrow('up', selected, filtered.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[selected];
      if (!item) return;
      void runItem(item, ctx).finally(() => closePalette());
    }
  }

  function onItemClick(index: number): void {
    selected = index;
    const item = filtered[index];
    if (!item) return;
    void runItem(item, ctx).finally(() => closePalette());
  }
</script>

{#if open}
  <dialog
    bind:this={dialogEl}
    class="cmdk-dialog"
    onclose={() => (open = false)}
    onkeydown={onKeydown}
  >
    <div class="flex flex-col gap-2 w-[600px] max-w-[90vw] max-h-[80vh] p-3">
      <input
        bind:this={inputEl}
        bind:value={search}
        placeholder="Search devices, jobs, actions..."
        class="w-full px-3 py-2 rounded border border-border bg-background text-foreground outline-none focus:ring-2 focus:ring-primary"
        type="text"
      />
      <ul role="listbox" class="flex flex-col gap-1 overflow-y-auto">
        {#each filtered as item, i (item.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- Keyboard nav (Arrow/Enter/Esc) is handled at the dialog level. -->
          <li
            role="option"
            aria-selected={i === selected}
            class="cmdk-item flex items-baseline gap-2 px-3 py-2 rounded cursor-pointer hover:bg-muted"
            class:bg-muted={i === selected}
            onclick={() => onItemClick(i)}
            onmouseenter={() => (selected = i)}
          >
            <span class="font-medium text-foreground">{item.label}</span>
            {#if item.sub}
              <span class="text-sm text-muted-foreground truncate">{item.sub}</span>
            {/if}
            <span class="ml-auto text-xs uppercase opacity-60">{item.kind}</span>
          </li>
        {:else}
          <li class="px-3 py-4 text-sm text-muted-foreground">No results</li>
        {/each}
      </ul>
    </div>
  </dialog>
{/if}

<style>
  .cmdk-dialog {
    border: 1px solid var(--border, #2a2a2a);
    border-radius: 8px;
    padding: 0;
    background: var(--background, #0b0b0b);
    color: var(--foreground, #e6e6e6);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  }
  .cmdk-dialog::backdrop {
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(2px);
  }
</style>
