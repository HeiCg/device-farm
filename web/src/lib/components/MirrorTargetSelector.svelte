<script lang="ts">
	// Phase 37 Plan 37-04 Wave 1 Track D — MirrorTargetSelector.
	//
	// Multi-select chip group used on /sessions/[id] for fan-out targeting.
	// When the operator selects one or more sessions, every tap/text/key
	// action dispatched on the local canvas is ALSO POSTed to
	// /api/sessions/broadcast with the chosen ids. Result toasts surface
	// per-session ok/error in the parent page.
	//
	// Stateless component — parent passes `sessions` + an `onChange`
	// callback receiving the latest selectedIds[] array. We avoid the
	// $bindable pattern here because the parent page tracks the selection
	// alongside other session-local state.

	type SessionOption = { id: string; deviceLabel: string };

	let {
		sessions,
		selectedIds = [],
		onChange,
	}: {
		sessions: SessionOption[];
		selectedIds?: string[];
		onChange?: (ids: string[]) => void;
	} = $props();

	// Local mutable copy; emits via onChange on every toggle so parent
	// reactivity fires without forcing $bindable on the prop.
	let chosen = $state<string[]>([...selectedIds]);

	function toggle(id: string) {
		chosen = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id];
		onChange?.(chosen);
	}

	function clearAll() {
		chosen = [];
		onChange?.(chosen);
	}
</script>

<div class="border rounded p-2" data-testid="mirror-target-selector">
	<div class="flex items-center justify-between mb-1">
		<div class="text-xs text-gray-500">Mirror to:</div>
		{#if chosen.length > 0}
			<button
				type="button"
				class="text-xs text-blue-600 hover:underline"
				onclick={clearAll}
				data-testid="mirror-clear"
			>Clear ({chosen.length})</button>
		{/if}
	</div>
	{#if sessions.length === 0}
		<p class="text-xs text-gray-400">No other active sessions to mirror to.</p>
	{:else}
		<div class="flex flex-wrap gap-1">
			{#each sessions as s (s.id)}
				<button
					type="button"
					class="px-2 py-1 text-xs rounded font-mono {chosen.includes(s.id)
						? 'bg-blue-600 text-white'
						: 'bg-gray-200 hover:bg-gray-300'}"
					onclick={() => toggle(s.id)}
					data-testid="mirror-chip-{s.id}"
				>{s.deviceLabel}</button>
			{/each}
		</div>
	{/if}
</div>
