<script lang="ts">
	import type { StepData } from '$lib/api/types.js';
	import FlakeyBadge from '$lib/components/FlakeyBadge.svelte';

	let { steps, flakyMap = new Map() }: { steps: StepData[]; flakyMap?: Map<string, number> } = $props();

	let passed = $derived(steps.filter((s) => s.status === 'passed').length);
	let failed = $derived(steps.filter((s) => s.status === 'failed').length);
	let running = $derived(steps.filter((s) => s.status === 'running').length);

	const stepBorderStyles: Record<string, string> = {
		passed: 'border-l-2 border-secondary',
		failed: 'border-l-2 border-tertiary',
		running: 'border-l-2 border-primary',
		pending: 'border-l-2 border-outline',
	};

	function formatDuration(ms: number | null): string {
		if (ms === null) return '';
		if (ms < 1000) return `${ms}ms`;
		return `${(ms / 1000).toFixed(1)}s`;
	}
</script>

<div class="rounded-lg border border-outline-variant/10 overflow-hidden">
	<!-- Summary header -->
	<div class="flex items-center gap-3 px-4 py-2.5 bg-surface-container-high text-[12px]">
		<span class="font-medium text-on-surface">{steps.length} steps</span>
		{#if passed > 0}
			<span class="flex items-center gap-1 text-secondary">
				<span class="material-symbols-outlined text-sm">check_circle</span>
				{passed}
			</span>
		{/if}
		{#if failed > 0}
			<span class="flex items-center gap-1 text-tertiary">
				<span class="material-symbols-outlined text-sm">cancel</span>
				{failed}
			</span>
		{/if}
		{#if running > 0}
			<span class="flex items-center gap-1 text-primary">
				<span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
				{running}
			</span>
		{/if}
	</div>

	<!-- Step rows -->
	<div class="bg-surface-container-low">
		{#each steps as step, i}
			{@const borderClass = stepBorderStyles[step.status] ?? 'border-l-2 border-outline'}
			<div class="flex items-center gap-3 px-4 py-2 hover:bg-surface-container transition-colors {borderClass}">
				{#if step.status === 'passed'}
					<span class="w-6 h-6 rounded-full flex items-center justify-center bg-secondary/10 shrink-0">
						<span class="material-symbols-outlined text-sm text-secondary">check_circle</span>
					</span>
				{:else if step.status === 'failed'}
					<span class="w-6 h-6 rounded-full flex items-center justify-center bg-tertiary/10 shrink-0">
						<span class="material-symbols-outlined text-sm text-tertiary">cancel</span>
					</span>
				{:else if step.status === 'running'}
					<span class="w-6 h-6 rounded-full flex items-center justify-center bg-primary/10 shrink-0">
						<span class="material-symbols-outlined text-sm text-primary animate-spin">progress_activity</span>
					</span>
				{:else}
					<span class="w-6 h-6 rounded-full flex items-center justify-center bg-outline/10 shrink-0">
						<span class="material-symbols-outlined text-sm text-outline">remove_circle</span>
					</span>
				{/if}

				<div class="flex-1 min-w-0">
					<div class="flex items-center gap-2">
						<span class="text-[13px] font-medium text-on-surface truncate">{step.flowName}</span>
						{#if flakyMap.has(step.flowName)}
							<FlakeyBadge passRate={flakyMap.get(step.flowName) ?? 0} />
						{/if}
					</div>
					{#if step.command}
						<div class="text-[12px] text-on-surface-variant truncate mt-0.5">{step.command}</div>
					{/if}
				</div>

				<span class="text-[12px] text-on-surface-variant tabular-nums shrink-0">{formatDuration(step.durationMs)}</span>
				<span class="material-symbols-outlined text-sm text-outline-variant shrink-0">chevron_right</span>
			</div>
		{/each}
	</div>

	{#if steps.length === 0}
		<div class="px-4 py-6 text-[13px] text-on-surface-variant text-center">No steps yet...</div>
	{/if}
</div>
