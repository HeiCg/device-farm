<script lang="ts">
	let {
		hasMore,
		loading,
		onloadmore
	}: { hasMore: boolean; loading: boolean; onloadmore: () => void } = $props();
</script>

{#if hasMore}
	<div class="flex justify-center py-4">
		<button
			onclick={onloadmore}
			disabled={loading}
			class="inline-flex items-center gap-2 rounded-md border border-outline-variant/30 bg-surface-container-high px-4 py-[5px] text-[13px] font-medium text-on-surface-variant hover:bg-surface-bright focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
		>
			{#if loading}
				<span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
				Loading...
			{:else}
				Load more
			{/if}
		</button>
	</div>
{/if}
