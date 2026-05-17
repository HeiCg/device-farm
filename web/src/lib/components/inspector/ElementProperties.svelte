<script lang="ts">
	import type { HierarchyNode } from '$lib/api/types.js';
	import MaestroSuggestions from './MaestroSuggestions.svelte';

	let { node, onClose }: { node: HierarchyNode; onClose: () => void } = $props();
</script>

<div class="bg-surface-container-low rounded-lg p-4 border border-primary/20 space-y-4" data-testid="element-properties">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<h2 class="text-[10px] text-primary tracking-widest uppercase font-medium">Selected Element</h2>
		<button
			onclick={onClose}
			class="text-on-surface-variant hover:text-on-surface transition-colors"
			aria-label="Close properties panel"
		>
			<span class="material-symbols-outlined text-sm">close</span>
		</button>
	</div>

	<!-- Properties -->
	<dl class="space-y-2 text-xs">
		<div>
			<dt class="text-on-surface-variant/70">Type</dt>
			<dd class="font-mono text-on-surface">{node.type}</dd>
		</div>
		{#if node.id}
			<div>
				<dt class="text-on-surface-variant/70">ID</dt>
				<dd class="font-mono text-on-surface break-all">{node.id}</dd>
			</div>
		{/if}
		{#if node.text}
			<div>
				<dt class="text-on-surface-variant/70">Text</dt>
				<dd class="text-on-surface">{node.text}</dd>
			</div>
		{/if}
		{#if node.description}
			<div>
				<dt class="text-on-surface-variant/70">Description</dt>
				<dd class="text-on-surface">{node.description}</dd>
			</div>
		{/if}
		{#if node.bounds}
			<div>
				<dt class="text-on-surface-variant/70">Bounds</dt>
				<dd class="font-mono text-on-surface">[{node.bounds.join(', ')}]</dd>
			</div>
		{/if}

		<!-- State flags -->
		<div class="flex flex-wrap gap-2 pt-1">
			{#if node.clickable}
				<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium">
					<span class="material-symbols-outlined text-xs">touch_app</span>
					clickable
				</span>
			{/if}
			{#if node.focused}
				<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary/10 text-secondary text-[10px] font-medium">
					<span class="material-symbols-outlined text-xs">center_focus_strong</span>
					focused
				</span>
			{/if}
			{#if node.enabled}
				<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-on-surface-variant/10 text-on-surface-variant text-[10px] font-medium">
					<span class="material-symbols-outlined text-xs">check_circle</span>
					enabled
				</span>
			{/if}
			{#if !node.visible}
				<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-tertiary/10 text-tertiary text-[10px] font-medium">
					<span class="material-symbols-outlined text-xs">visibility_off</span>
					hidden
				</span>
			{:else}
				<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium">
					<span class="material-symbols-outlined text-xs">visibility</span>
					visible
				</span>
			{/if}
		</div>
	</dl>

	<!-- Divider -->
	<div class="border-t border-outline-variant/15"></div>

	<!-- Maestro commands -->
	<MaestroSuggestions {node} />
</div>
