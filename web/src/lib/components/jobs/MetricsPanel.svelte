<script lang="ts">
	import type { MetricsData } from '$lib/api/types.js';

	let { metrics }: { metrics: MetricsData[] } = $props();

	let latest = $derived(metrics.length > 0 ? metrics[metrics.length - 1] : null);

	let maxPss = $derived(Math.max(...metrics.map((m) => m.totalPss), 1));
	let maxNative = $derived(Math.max(...metrics.map((m) => m.nativeHeap), 1));
	let maxJava = $derived(Math.max(...metrics.map((m) => m.javaHeap), 1));

	function toMB(kb: number): string {
		return (kb / 1024).toFixed(1);
	}

	function pct(value: number, max: number): number {
		return Math.min(100, (value / max) * 100);
	}
</script>

<div class="border-l-2 border-primary bg-surface-container-low rounded-lg overflow-hidden">
	<div class="flex items-center justify-between px-4 py-2.5 bg-surface-container-high">
		<h3 class="text-[12px] font-semibold text-on-surface">Memory</h3>
		<span class="text-[11px] text-on-surface-variant tabular-nums">{metrics.length} samples</span>
	</div>

	<div class="p-4">
		{#if latest}
			<div class="space-y-3">
				<div>
					<div class="flex items-center justify-between text-[12px] mb-1">
						<span class="text-on-surface-variant">Total PSS</span>
						<span class="font-mono text-on-surface tabular-nums">{toMB(latest.totalPss)} MB</span>
					</div>
					<div class="h-1.5 bg-surface-variant rounded-full overflow-hidden">
						<div
							class="h-full bg-primary rounded-full transition-all duration-300 shadow-[0_0_8px_rgba(195,155,255,0.3)]"
							style="width: {pct(latest.totalPss, maxPss)}%"
						></div>
					</div>
				</div>

				<div>
					<div class="flex items-center justify-between text-[12px] mb-1">
						<span class="text-on-surface-variant">Native Heap</span>
						<span class="font-mono text-on-surface tabular-nums">{toMB(latest.nativeHeap)} MB</span>
					</div>
					<div class="h-1.5 bg-surface-variant rounded-full overflow-hidden">
						<div
							class="h-full bg-primary-dim rounded-full transition-all duration-300 shadow-[0_0_8px_rgba(145,76,242,0.3)]"
							style="width: {pct(latest.nativeHeap, maxNative)}%"
						></div>
					</div>
				</div>

				<div>
					<div class="flex items-center justify-between text-[12px] mb-1">
						<span class="text-on-surface-variant">Java Heap</span>
						<span class="font-mono text-on-surface tabular-nums">{toMB(latest.javaHeap)} MB</span>
					</div>
					<div class="h-1.5 bg-surface-variant rounded-full overflow-hidden">
						<div
							class="h-full bg-secondary rounded-full transition-all duration-300 shadow-[0_0_8px_rgba(0,253,147,0.3)]"
							style="width: {pct(latest.javaHeap, maxJava)}%"
						></div>
					</div>
				</div>
			</div>
		{:else}
			<div class="text-[12px] text-on-surface-variant text-center py-2">No metrics data yet</div>
		{/if}
	</div>
</div>
