<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { getPipelineRun, cancelPipelineRun, type PipelineRun, type PipelineStageRun } from '$lib/api/pipelines.js';
	import { formatDistanceToNow } from 'date-fns';

	let run: PipelineRun | null = $state(null);
	let loading = $state(true);
	let error: string | null = $state(null);
	let expandedStage: string | null = $state(null);
	let pollInterval: ReturnType<typeof setInterval> | null = null;

	let runId = $derived(page.params.id);

	let isTerminal = $derived(
		run?.status === 'passed' || run?.status === 'failed' || run?.status === 'cancelled'
	);

	let duration = $derived.by(() => {
		if (!run?.startedAt) return null;
		const start = new Date(run.startedAt).getTime();
		const end = run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now();
		const secs = Math.round((end - start) / 1000);
		if (secs < 60) return `${secs}s`;
		return `${Math.floor(secs / 60)}m ${secs % 60}s`;
	});

	async function loadRun() {
		try {
			run = await getPipelineRun(runId);
			error = null;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load run';
		} finally {
			loading = false;
		}
	}

	async function handleCancel() {
		try {
			await cancelPipelineRun(runId);
			await loadRun();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to cancel run';
		}
	}

	function startPolling() {
		pollInterval = setInterval(async () => {
			if (isTerminal && pollInterval) {
				clearInterval(pollInterval);
				pollInterval = null;
				return;
			}
			await loadRun();
		}, 3000);
	}

	function statusIcon(status: string): string {
		switch (status) {
			case 'passed': return 'check_circle';
			case 'failed': return 'cancel';
			case 'running': return 'pending';
			case 'skipped': return 'skip_next';
			case 'pending': return 'radio_button_unchecked';
			default: return 'help';
		}
	}

	function statusColor(status: string): string {
		switch (status) {
			case 'passed': return 'text-secondary';
			case 'failed': return 'text-tertiary';
			case 'running': return 'text-primary animate-pulse';
			case 'skipped': return 'text-on-surface-variant/50';
			case 'pending': return 'text-on-surface-variant/30';
			default: return 'text-on-surface-variant';
		}
	}

	function statusBg(status: string): string {
		switch (status) {
			case 'passed': return 'bg-secondary/10 border-secondary/20';
			case 'failed': return 'bg-tertiary/10 border-tertiary/20';
			case 'running': return 'bg-primary/10 border-primary/20';
			default: return 'bg-surface-container border-white/5';
		}
	}

	onMount(async () => {
		await loadRun();
		startPolling();
	});

	onDestroy(() => {
		if (pollInterval) {
			clearInterval(pollInterval);
			pollInterval = null;
		}
	});
</script>

<div class="space-y-6">
	{#if loading}
		<div class="animate-pulse space-y-4">
			<div class="w-1/3 h-6 rounded bg-surface-container"></div>
			<div class="w-full h-32 rounded bg-surface-container-low"></div>
		</div>
	{:else if !run}
		<div class="text-center py-16">
			<p class="text-on-surface-variant">Pipeline run not found</p>
		</div>
	{:else}
		<!-- Header -->
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				<a href="/pipelines" class="material-symbols-outlined text-on-surface-variant hover:text-on-surface transition-colors">arrow_back</a>
				<div>
					<h1 class="text-xl font-headline font-bold text-on-surface tracking-wide flex items-center gap-2">
						Pipeline Run
						<span class="text-sm font-mono text-on-surface-variant">{run.id.slice(0, 8)}</span>
					</h1>
					<div class="flex items-center gap-3 mt-1 text-xs text-on-surface-variant">
						<span class="px-2 py-0.5 rounded bg-surface-container">{run.triggerType}</span>
						{#if run.sourceBranch}
							<span class="flex items-center gap-1">
								<span class="material-symbols-outlined text-xs">fork_right</span>
								{run.sourceBranch}
							</span>
						{/if}
						{#if duration}
							<span class="flex items-center gap-1">
								<span class="material-symbols-outlined text-xs">timer</span>
								{duration}
							</span>
						{/if}
					</div>
				</div>
			</div>
			<div class="flex items-center gap-3">
				<span class="{statusColor(run.status)} text-lg font-headline font-bold uppercase tracking-wider">{run.status}</span>
				{#if run.status === 'running' || run.status === 'pending'}
					<button onclick={handleCancel}
						class="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-tertiary/20 text-tertiary text-xs hover:bg-tertiary/30 transition-colors">
						<span class="material-symbols-outlined text-sm">stop</span>
						Cancel
					</button>
				{/if}
			</div>
		</div>

		{#if error}
			<div class="bg-tertiary/10 border border-tertiary/20 rounded-lg px-4 py-3 text-tertiary text-sm">{error}</div>
		{/if}

		{#if run.errorMessage}
			<div class="bg-tertiary/10 border border-tertiary/20 rounded-lg px-4 py-3 text-tertiary text-sm">
				{run.errorMessage}
			</div>
		{/if}

		<!-- Stage Timeline -->
		<div class="space-y-2">
			{#each (run.stages ?? []).sort((a, b) => a.stageIndex - b.stageIndex) as stage (stage.id)}
				<div class="rounded-lg border {statusBg(stage.status)} overflow-hidden">
					<!-- Stage header -->
					<button
						class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors"
						onclick={() => (expandedStage = expandedStage === stage.id ? null : stage.id)}>
						<span class="material-symbols-outlined text-lg {statusColor(stage.status)}">{statusIcon(stage.status)}</span>
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2">
								<span class="text-sm font-medium text-on-surface">{stage.stageName}</span>
								<span class="text-[10px] px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant">{stage.type}</span>
							</div>
						</div>
						{#if stage.startedAt && stage.finishedAt}
							{@const stageDuration = Math.round((new Date(stage.finishedAt).getTime() - new Date(stage.startedAt).getTime()) / 1000)}
							<span class="text-[11px] text-on-surface-variant/50">{stageDuration}s</span>
						{/if}
						<span class="material-symbols-outlined text-sm text-on-surface-variant/50 transition-transform {expandedStage === stage.id ? 'rotate-180' : ''}">expand_more</span>
					</button>

					<!-- Expanded logs -->
					{#if expandedStage === stage.id}
						<div class="border-t border-white/5 bg-surface-container-lowest">
							{#if stage.errorMessage}
								<div class="px-4 py-2 text-xs text-tertiary bg-tertiary/5">
									{stage.errorMessage}
								</div>
							{/if}
							{#if stage.logs}
								<pre class="px-4 py-3 text-xs font-mono text-on-surface-variant overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap">{stage.logs}</pre>
							{:else}
								<div class="px-4 py-3 text-xs text-on-surface-variant/40 italic">No logs available</div>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>

		{#if !run.stages?.length}
			<div class="bg-surface-container-low rounded-lg px-4 py-8 text-center border border-white/5">
				{#if run.status === 'pending' || run.status === 'running'}
					<span class="material-symbols-outlined text-2xl text-primary animate-pulse mb-2 block">hourglass_empty</span>
					<p class="text-xs text-on-surface-variant">Waiting for stages to start...</p>
				{:else}
					<p class="text-xs text-on-surface-variant">No stage data available</p>
				{/if}
			</div>
		{/if}
	{/if}
</div>
