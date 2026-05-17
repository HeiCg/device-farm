<script lang="ts">
	import type { HierarchyNode } from '$lib/api/types.js';

	let {
		nodes,
		selectedNodeId = null,
		highlightedNodeIds = new Set<number>(),
		onNodeClick,
		onNodeHover
	}: {
		nodes: HierarchyNode[];
		selectedNodeId?: string | null;
		highlightedNodeIds?: Set<number>;
		onNodeClick?: (node: HierarchyNode) => void;
		onNodeHover?: (node: HierarchyNode | null) => void;
	} = $props();

	/** Track which nodes are expanded. Root nodes start expanded. */
	let expandedNodes = $state<Set<string>>(new Set());
	let initialized = $state(false);

	/** Auto-expand root nodes on first render */
	$effect(() => {
		if (nodes.length > 0 && !initialized) {
			const roots = new Set<string>();
			for (const n of nodes) {
				roots.add(nodeKey(n, 0));
				// Also expand first level children for visibility
				for (const child of n.children) {
					roots.add(nodeKey(child, 1));
				}
			}
			expandedNodes = roots;
			initialized = true;
		}
	});

	/** Build a stable key for a node (type + id + bounds hash) */
	function nodeKey(node: HierarchyNode, depth: number): string {
		const b = node.bounds ? node.bounds.join(',') : 'none';
		return `${depth}:${node.type}:${node.id ?? ''}:${b}`;
	}

	function toggleExpand(key: string, event: Event) {
		event.stopPropagation();
		const next = new Set(expandedNodes);
		if (next.has(key)) {
			next.delete(key);
		} else {
			next.add(key);
		}
		expandedNodes = next;
	}

	function expandAll() {
		const all = new Set<string>();
		function walk(node: HierarchyNode, depth: number) {
			all.add(nodeKey(node, depth));
			for (const child of node.children) walk(child, depth + 1);
		}
		for (const n of nodes) walk(n, 0);
		expandedNodes = all;
	}

	function collapseAll() {
		expandedNodes = new Set();
	}

	/** Short display label for a node */
	function displayLabel(node: HierarchyNode): string {
		// e.g. "FrameLayout" from "android.widget.FrameLayout"
		const shortType = node.type.includes('.') ? node.type.split('.').pop()! : node.type;
		return shortType;
	}

	/** Flat index counter for highlight matching */
	let flatIndexMap = $derived.by(() => {
		const map = new Map<string, number>();
		let idx = 0;
		function walk(node: HierarchyNode, depth: number) {
			map.set(nodeKey(node, depth), idx++);
			for (const child of node.children) walk(child, depth + 1);
		}
		for (const n of nodes) walk(n, 0);
		return map;
	});
</script>

<div class="flex flex-col h-full min-h-0">
	<!-- Toolbar -->
	<div class="flex items-center justify-between px-3 py-2 border-b border-outline-variant/10 shrink-0">
		<span class="text-[10px] text-on-surface-variant tracking-widest uppercase font-medium">Element Tree</span>
		<div class="flex items-center gap-1">
			<button
				onclick={expandAll}
				class="p-1 rounded text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-container-high transition-colors"
				title="Expand all"
			>
				<span class="material-symbols-outlined text-sm">unfold_more</span>
			</button>
			<button
				onclick={collapseAll}
				class="p-1 rounded text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-container-high transition-colors"
				title="Collapse all"
			>
				<span class="material-symbols-outlined text-sm">unfold_less</span>
			</button>
		</div>
	</div>

	<!-- Tree -->
	<div class="overflow-y-auto overflow-x-hidden flex-1 min-h-0 py-1 text-xs font-mono">
		{#each nodes as node}
			{@render treeNode(node, 0)}
		{/each}
	</div>
</div>

{#snippet treeNode(node: HierarchyNode, depth: number)}
	{@const key = nodeKey(node, depth)}
	{@const isExpanded = expandedNodes.has(key)}
	{@const hasChildren = node.children.length > 0}
	{@const isSelected = selectedNodeId !== null && node.id === selectedNodeId}
	{@const flatIdx = flatIndexMap.get(key) ?? -1}
	{@const isHighlighted = highlightedNodeIds.has(flatIdx)}
	{@const label = displayLabel(node)}

	<div class="select-none">
		<!-- Node row -->
		<button
			type="button"
			class="w-full flex items-center gap-1 py-[3px] pr-2 text-left hover:bg-white/[0.04] transition-colors
				{isSelected ? 'bg-primary/15 text-primary' : isHighlighted ? 'bg-[#00e5ff]/10 text-[#00e5ff]' : 'text-on-surface-variant'}"
			style="padding-left: {depth * 16 + 4}px"
			onclick={() => onNodeClick?.(node)}
			onmouseenter={() => onNodeHover?.(node)}
			onmouseleave={() => onNodeHover?.(null)}
		>
			<!-- Expand/collapse toggle -->
			{#if hasChildren}
				<span
					class="material-symbols-outlined text-sm shrink-0 cursor-pointer transition-transform {isExpanded ? 'rotate-90' : ''} {isSelected ? 'text-primary' : 'text-on-surface-variant/50'}"
					role="button"
					tabindex="-1"
					onclick={(e) => toggleExpand(key, e)}
				>
					chevron_right
				</span>
			{:else}
				<span class="w-[18px] shrink-0"></span>
			{/if}

			<!-- Type label -->
			<span class="truncate {isSelected ? 'text-primary font-medium' : isHighlighted ? 'text-[#00e5ff]' : 'text-on-surface'}">
				{label}
			</span>

			<!-- Text/ID preview -->
			{#if node.text}
				<span class="truncate text-on-surface-variant/50 ml-1">"{node.text}"</span>
			{:else if node.id}
				<span class="truncate text-on-surface-variant/40 ml-1">#{node.id.split('/').pop()}</span>
			{/if}
		</button>

		<!-- Children (if expanded) -->
		{#if hasChildren && isExpanded}
			{#each node.children as child}
				{@render treeNode(child, depth + 1)}
			{/each}
		{/if}
	</div>
{/snippet}
