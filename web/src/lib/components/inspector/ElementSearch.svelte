<script lang="ts">
	import type { HierarchyNode } from '$lib/api/types.js';
	import { flattenTree } from '$lib/utils/coordinate-mapping.js';

	let {
		nodes,
		onSearchResults
	}: {
		nodes: HierarchyNode[];
		onSearchResults: (matchedIndices: Set<number>) => void;
	} = $props();

	let searchTerm = $state('');
	let matchCount = $state(0);
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		const term = searchTerm.trim().toLowerCase();

		clearTimeout(debounceTimer);

		if (term === '') {
			matchCount = 0;
			onSearchResults(new Set());
			return;
		}

		debounceTimer = setTimeout(() => {
			const flat = flattenTree(nodes);
			const matched = new Set<number>();

			for (let i = 0; i < flat.length; i++) {
				const n = flat[i];
				if (
					n.id?.toLowerCase().includes(term) ||
					n.text?.toLowerCase().includes(term) ||
					n.type.toLowerCase().includes(term) ||
					n.description?.toLowerCase().includes(term)
				) {
					matched.add(i);
				}
			}

			matchCount = matched.size;
			onSearchResults(matched);
		}, 200);

		return () => clearTimeout(debounceTimer);
	});

	function clearSearch() {
		searchTerm = '';
	}
</script>

<div class="relative mb-3">
	<div class="relative flex items-center">
		<!-- Search icon -->
		<span class="absolute left-3 material-symbols-outlined text-base text-on-surface-variant/60 pointer-events-none">
			search
		</span>

		<!-- Search input -->
		<input
			type="text"
			data-testid="element-search"
			bind:value={searchTerm}
			placeholder="Search elements…"
			class="w-full pl-9 pr-20 py-2 text-sm text-on-surface bg-surface-container-low border border-outline-variant/20 rounded-lg placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-colors"
		/>

		<!-- Right side: match count + clear button -->
		<div class="absolute right-2 flex items-center gap-1.5">
			{#if searchTerm.trim() !== ''}
				<!-- Match count badge -->
				<span class="text-[10px] font-medium tracking-wide px-1.5 py-0.5 rounded-md bg-surface-container-highest text-on-surface-variant tabular-nums">
					{matchCount} match{matchCount !== 1 ? 'es' : ''}
				</span>

				<!-- Clear button -->
				<button
					onclick={clearSearch}
					class="p-0.5 rounded-md text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-container-high transition-colors"
					aria-label="Clear search"
				>
					<span class="material-symbols-outlined text-base">close</span>
				</button>
			{/if}
		</div>
	</div>
</div>
