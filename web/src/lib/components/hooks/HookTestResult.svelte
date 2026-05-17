<script lang="ts">
	import type { HookResult } from '$lib/api/types.js';

	let { result }: { result: HookResult } = $props();

	const statusStyles: Record<string, string> = {
		success: 'bg-secondary/10 text-secondary border-secondary/20',
		failed: 'bg-tertiary/10 text-tertiary border-tertiary/20',
	};

	let statusKey = $derived(result.success ? 'success' : 'failed');
	let statusClass = $derived(statusStyles[statusKey] ?? statusStyles.failed);
	let statusLabel = $derived(result.success ? 'SUCCESS' : 'FAILED');

	let formattedDuration = $derived(() => {
		if (result.durationMs >= 1000) {
			return `${(result.durationMs / 1000).toFixed(1)}s`;
		}
		return `${result.durationMs}ms`;
	});
</script>

<div class="bg-surface-container-low rounded-lg border border-white/5 p-4 mt-2">
	<!-- Header: status badge + exit code + duration -->
	<div class="flex items-center gap-3 mb-3">
		<span class="text-[10px] font-headline tracking-widest px-2 py-0.5 rounded border {statusClass}">
			{statusLabel}
		</span>
		<span class="text-xs text-on-surface-variant">
			Exit: <span class="font-mono text-on-surface">{result.exitCode ?? '-'}</span>
		</span>
		<span class="text-xs text-on-surface-variant">
			Duration: <span class="font-mono text-on-surface">{formattedDuration()}</span>
		</span>
	</div>

	<!-- Executed command -->
	<div class="mb-3">
		<p class="text-[10px] text-on-surface-variant tracking-widest uppercase mb-1">EXECUTED_COMMAND</p>
		<code class="block bg-surface-container rounded-lg p-3 font-mono text-xs text-on-surface break-all">
			{result.command}
		</code>
	</div>

	<!-- Stdout -->
	{#if result.stdout}
		<div class="mb-3">
			<p class="text-[10px] text-on-surface-variant tracking-widest uppercase mb-1">STDOUT</p>
			<pre class="bg-surface-container rounded-lg p-3 font-mono text-xs text-on-surface max-h-40 overflow-auto whitespace-pre-wrap">{result.stdout}</pre>
		</div>
	{/if}

	<!-- Stderr -->
	{#if result.stderr}
		<div class="mb-3">
			<p class="text-[10px] text-on-surface-variant tracking-widest uppercase mb-1">STDERR</p>
			<pre class="bg-surface-container rounded-lg p-3 font-mono text-xs text-tertiary max-h-40 overflow-auto whitespace-pre-wrap">{result.stderr}</pre>
		</div>
	{/if}

	<!-- Error -->
	{#if result.error}
		<div class="bg-tertiary/10 border border-tertiary/20 text-tertiary rounded-lg px-4 py-3 text-sm">
			{result.error}
		</div>
	{/if}
</div>
