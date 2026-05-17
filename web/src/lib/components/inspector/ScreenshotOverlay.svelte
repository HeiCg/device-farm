<script lang="ts">
	import type { HierarchyNode } from '$lib/api/types.js';
	import { flattenTree, mapBoundsToSVG } from '$lib/utils/coordinate-mapping.js';

	let {
		screenshotUrl,
		nodes,
		selectedNodeId = null,
		highlightedNodeIds = new Set<number>(),
		onNodeClick
	}: {
		screenshotUrl: string;
		nodes: HierarchyNode[];
		selectedNodeId?: string | null;
		highlightedNodeIds?: Set<number>;
		onNodeClick?: (node: HierarchyNode) => void;
	} = $props();

	/**
	 * D016-compliant static color array — no template interpolation.
	 * Each entry is a full Tailwind class for the rect stroke.
	 */
	const RECT_COLORS = [
		'stroke-[#4fc3f7]', // light blue
		'stroke-[#81c784]', // green
		'stroke-[#ffb74d]', // orange
		'stroke-[#ce93d8]', // purple
		'stroke-[#e57373]', // red
		'stroke-[#4dd0e1]', // cyan
		'stroke-[#fff176]', // yellow
		'stroke-[#a1887f]'  // brown
	] as const;

	/** Matching fill colors for selected-node highlight (low alpha hex). */
	const RECT_FILLS = [
		'fill-[#4fc3f71a]',
		'fill-[#81c7841a]',
		'fill-[#ffb74d1a]',
		'fill-[#ce93d81a]',
		'fill-[#e573731a]',
		'fill-[#4dd0e11a]',
		'fill-[#fff1761a]',
		'fill-[#a1887f1a]'
	] as const;

	/** D016-compliant static highlight colors for search matches. */
	const HIGHLIGHT_STROKE = 'stroke-[#00e5ff]';
	const HIGHLIGHT_FILL = 'fill-[#00e5ff4d]';

	let naturalWidth = $state(0);
	let naturalHeight = $state(0);
	let imageLoaded = $state(false);
	let imageError = $state(false);

	/**
	 * Flatten tree and filter to nodes with drawable bounds.
	 * Each entry tracks its original index in the full flattenTree() output
	 * so highlighted-node lookups match the search filter's index space.
	 */
	let visibleNodes = $derived(
		flattenTree(nodes)
			.map((n, flatIndex) => ({ node: n, flatIndex }))
			.filter(
				(entry): entry is { node: HierarchyNode & { bounds: [number, number, number, number] }; flatIndex: number } =>
					entry.node.bounds !== null
			)
	);

	function handleImageLoad(event: Event) {
		const img = event.currentTarget as HTMLImageElement;
		naturalWidth = img.naturalWidth;
		naturalHeight = img.naturalHeight;
		imageLoaded = true;
		imageError = false;
	}

	function handleImageError() {
		imageError = true;
		imageLoaded = false;
	}
</script>

<div class="relative w-full">
	{#if imageError}
		<!-- Error state -->
		<div class="aspect-[9/16] bg-surface-container-low rounded-lg border border-outline-variant/20 flex items-center justify-center">
			<div class="text-center space-y-2">
				<span class="material-symbols-outlined text-3xl text-outline-variant">broken_image</span>
				<p class="text-sm text-on-surface-variant">Screenshot unavailable</p>
			</div>
		</div>
	{:else}
		<!-- Image (hidden while loading to show skeleton) -->
		<img
			src={screenshotUrl}
			alt="Device screenshot"
			class="w-full h-auto rounded-lg"
			class:invisible={!imageLoaded}
			onload={handleImageLoad}
			onerror={handleImageError}
		/>

		{#if !imageLoaded}
			<!-- Loading skeleton -->
			<div class="aspect-[9/16] bg-surface-container-low rounded-lg border border-outline-variant/10 animate-pulse">
				<div class="absolute inset-0 flex items-center justify-center">
					<span class="text-xs text-on-surface-variant/50 tracking-widest uppercase">Loading screenshot…</span>
				</div>
			</div>
		{/if}

		<!-- SVG overlay — only render once image dimensions are known -->
		{#if imageLoaded && naturalWidth > 0}
			<svg
				class="absolute inset-0 w-full h-full rounded-lg"
				viewBox="0 0 {naturalWidth} {naturalHeight}"
				preserveAspectRatio="xMidYMid meet"
				xmlns="http://www.w3.org/2000/svg"
			>
				{#each visibleNodes as { node, flatIndex }, index}
					{@const svgRect = mapBoundsToSVG(node.bounds)}
					{@const colorIdx = index % RECT_COLORS.length}
					{@const isSelected = selectedNodeId !== null && node.id === selectedNodeId}
					{@const isHighlighted = !isSelected && highlightedNodeIds.has(flatIndex)}
					<rect
						x={svgRect.x}
						y={svgRect.y}
						width={svgRect.width}
						height={svgRect.height}
						class="{isHighlighted ? HIGHLIGHT_STROKE : RECT_COLORS[colorIdx]} {isSelected ? RECT_FILLS[colorIdx] : isHighlighted ? HIGHLIGHT_FILL : 'fill-none'}"
						stroke-width={isSelected || isHighlighted ? 3 : 2}
						opacity={isSelected || isHighlighted ? 1 : 0.7}
						pointer-events="visible"
						role="button"
						tabindex="-1"
						data-highlighted={isHighlighted ? 'true' : undefined}
						onclick={() => onNodeClick?.(node)}
					/>
				{/each}
			</svg>
		{/if}
	{/if}
</div>
