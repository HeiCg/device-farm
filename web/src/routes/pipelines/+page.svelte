<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { listPipelines, listPipelineRuns, deletePipeline, type Pipeline, type PipelineRun } from '$lib/api/pipelines.js';
	import { formatDistanceToNow } from 'date-fns';

	let pipelines: Pipeline[] = $state([]);
	let recentRuns = new SvelteMap<string, PipelineRun>();
	let loading = $state(true);
	let error: string | null = $state(null);
	let deleteConfirm: string | null = $state(null);

	async function loadData() {
		try {
			loading = true;
			const [pipelineList, runs] = await Promise.all([
				listPipelines(),
				listPipelineRuns(),
			]);
			pipelines = pipelineList;

			// Map latest run per pipeline
			recentRuns.clear();
			for (const run of runs) {
				if (!recentRuns.has(run.pipelineId)) {
					recentRuns.set(run.pipelineId, run);
				}
			}
			error = null;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load pipelines';
		} finally {
			loading = false;
		}
	}

	async function handleDelete(id: string) {
		try {
			await deletePipeline(id);
			deleteConfirm = null;
			await loadData();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to delete pipeline';
		}
	}

	function statusColor(status: string): string {
		switch (status) {
			case 'passed': return 'text-secondary';
			case 'failed': return 'text-tertiary';
			case 'running': return 'text-primary';
			case 'cancelled': return 'text-on-surface-variant';
			default: return 'text-on-surface-variant';
		}
	}

	function statusBorder(status: string | undefined): string {
		switch (status) {
			case 'passed': return 'border-secondary/30';
			case 'failed': return 'border-tertiary/30';
			case 'running': return 'border-primary/30';
			default: return 'border-outline-variant/10';
		}
	}

	onMount(() => { loadData(); });
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-xl font-headline font-bold text-on-surface tracking-wide">Pipelines</h1>
			<p class="text-xs text-on-surface-variant mt-1">CI/CD pipelines for automated test execution</p>
		</div>
		<a href="/pipelines/new"
			class="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-on-primary text-xs font-headline tracking-wider hover:bg-primary/90 transition-colors">
			<span class="material-symbols-outlined text-sm">add</span>
			NEW PIPELINE
		</a>
	</div>

	<!-- Error -->
	{#if error}
		<div class="bg-tertiary/10 border border-tertiary/20 rounded-lg px-4 py-3 text-tertiary text-sm">
			{error}
		</div>
	{/if}

	<!-- Loading -->
	{#if loading}
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each Array(6) as _, i (i)}
				<div class="bg-surface-container-low rounded-lg p-4 animate-pulse border border-white/5">
					<div class="w-3/4 h-4 rounded bg-surface-container mb-3"></div>
					<div class="w-1/2 h-3 rounded bg-surface-container mb-3"></div>
					<div class="w-1/3 h-3 rounded bg-surface-container"></div>
				</div>
			{/each}
		</div>
	{:else if pipelines.length === 0}
		<!-- Empty state -->
		<div class="bg-surface-container-low rounded-lg px-4 py-16 text-center border border-white/5">
			<span class="material-symbols-outlined text-4xl text-primary/40 mb-3 block">account_tree</span>
			<p class="text-sm font-medium text-on-surface-variant">No pipelines yet</p>
			<p class="text-xs text-on-surface-variant/70 mt-1">Create a pipeline to automate test execution with setup, test, and teardown stages.</p>
		</div>
	{:else}
		<!-- Pipeline cards -->
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each pipelines as pipeline (pipeline.id)}
				{@const latestRun = recentRuns.get(pipeline.id)}
				<div class="bg-surface-container-low rounded-lg border-l-2 p-4 hover:bg-surface-container transition-colors {statusBorder(latestRun?.status)}">
					<div class="flex items-start justify-between mb-2">
						<a href="/pipelines/{pipeline.id}" class="text-sm font-medium text-on-surface hover:text-primary transition-colors truncate">
							{pipeline.name}
						</a>
						{#if deleteConfirm === pipeline.id}
							<div class="flex gap-1">
								<button onclick={() => handleDelete(pipeline.id)} class="text-[10px] px-2 py-0.5 rounded bg-tertiary/20 text-tertiary hover:bg-tertiary/30">Delete</button>
								<button onclick={() => (deleteConfirm = null)} class="text-[10px] px-2 py-0.5 rounded bg-surface-container text-on-surface-variant hover:bg-surface-container-high">Cancel</button>
							</div>
						{:else}
							<button onclick={() => (deleteConfirm = pipeline.id)} class="material-symbols-outlined text-sm text-on-surface-variant/50 hover:text-tertiary transition-colors">delete</button>
						{/if}
					</div>

					{#if pipeline.description}
						<p class="text-xs text-on-surface-variant/70 mb-3 line-clamp-2">{pipeline.description}</p>
					{/if}

					{#if latestRun}
						<div class="flex items-center gap-2 text-[11px]">
							<span class="{statusColor(latestRun.status)} font-medium">{latestRun.status}</span>
							<span class="text-on-surface-variant/50">via {latestRun.triggerType}</span>
							{#if latestRun.startedAt}
								<span class="text-on-surface-variant/40">{formatDistanceToNow(new Date(latestRun.startedAt), { addSuffix: true })}</span>
							{/if}
						</div>
					{:else}
						<p class="text-[11px] text-on-surface-variant/40 italic">No runs yet</p>
					{/if}

					<div class="text-[10px] text-on-surface-variant/30 mt-2">
						Updated {formatDistanceToNow(new Date(pipeline.updatedAt), { addSuffix: true })}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
