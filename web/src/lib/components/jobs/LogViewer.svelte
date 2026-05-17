<script lang="ts">
	import type { LogData } from '$lib/api/types.js';

	let { logs }: { logs: LogData[] } = $props();

	let container: HTMLElement;

	let visibleLogs = $derived(logs.length > 1000 ? logs.slice(-1000) : logs);
	let startIndex = $derived(logs.length > 1000 ? logs.length - 1000 : 0);

	$effect(() => {
		if (logs.length > 0 && container) {
			requestAnimationFrame(() => {
				container.scrollTop = container.scrollHeight;
			});
		}
	});
</script>

<div class="flex flex-col rounded-md border border-outline-variant/20 overflow-hidden">
	<div class="flex items-center justify-between px-4 py-2 bg-surface-container-high border-b border-outline-variant/20">
		<div class="flex items-center">
			<div class="flex items-center gap-1.5 mr-3">
				<span class="w-2 h-2 rounded-full bg-tertiary"></span>
				<span class="w-2 h-2 rounded-full bg-primary"></span>
				<span class="w-2 h-2 rounded-full bg-secondary"></span>
			</div>
			<span class="text-[12px] font-medium text-on-surface">Output</span>
		</div>
		<span class="text-[11px] text-on-surface-variant tabular-nums">{logs.length} lines</span>
	</div>
	<div
		bind:this={container}
		class="log-viewer h-[600px] overflow-y-auto bg-[#0d1117] font-mono text-[13px] leading-[20px]"
	>
		{#if logs.length === 0}
			<div class="px-4 py-3 text-outline-variant italic">Waiting for output...</div>
		{/if}
		{#each visibleLogs as log, i}
			<div class="flex hover:bg-surface-container-high group">
				<span class="select-none w-[52px] shrink-0 text-right pr-3 py-0 text-[#484f58] text-[12px] leading-[20px]">{startIndex + i + 1}</span>
				<span
					class="flex-1 whitespace-pre-wrap break-all py-0 pr-4 {log.stream === 'stderr' ? 'text-[#f85149]' : 'text-[#e6edf3]'}"
				>{log.line}</span>
			</div>
		{/each}
	</div>
</div>
