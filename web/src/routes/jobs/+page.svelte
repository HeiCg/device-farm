<script lang="ts">
	import { onMount } from 'svelte';
	import { listJobs } from '$lib/api/jobs.js';
	import type { Job } from '$lib/api/types.js';
	import JobCard from '$lib/components/jobs/JobCard.svelte';
	import Pagination from '$lib/components/shared/Pagination.svelte';
	import ReportTabs from '$lib/components/reports/ReportTabs.svelte';
	import SuitesTable from '$lib/components/reports/SuitesTable.svelte';
	import TrendsCharts from '$lib/components/reports/TrendsCharts.svelte';
	import { fetchSuites, fetchTrends, type SuiteAggregate, type TrendsOutput } from '$lib/api/reports.js';

	let jobs: Job[] = $state([]);
	let nextCursor: string | null = $state(null);
	let hasMore = $state(false);
	let loading = $state(true);
	let loadingMore = $state(false);
	let error: string | null = $state(null);
	let statusFilter = $state('');
	let platformFilter = $state('');

	let activeTab = $state<'list' | 'suites' | 'history' | 'trends'>('list');
	let suites = $state<SuiteAggregate[]>([]);
	let trends = $state<TrendsOutput | null>(null);

	$effect(() => {
		if (activeTab === 'suites' && suites.length === 0) {
			fetchSuites(7).then((r) => (suites = r)).catch(() => {});
		}
		if (activeTab === 'trends' && !trends) {
			fetchTrends(7).then((r) => (trends = r)).catch(() => {});
		}
	});

	async function loadJobs(cursor?: string) {
		try {
			if (cursor) {
				loadingMore = true;
			} else {
				loading = true;
			}

			const result = await listJobs({
				status: statusFilter || undefined,
				platform: platformFilter || undefined,
				cursor
			});

			if (cursor) {
				jobs = [...jobs, ...result.data];
			} else {
				jobs = result.data;
			}

			nextCursor = result.cursor;
			hasMore = result.hasMore;
			error = null;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load jobs';
		} finally {
			loading = false;
			loadingMore = false;
		}
	}

	function handleFilterChange(filters: { status: string; platform: string }) {
		statusFilter = filters.status;
		platformFilter = filters.platform;
		loadJobs();
	}

	function handleLoadMore() {
		if (nextCursor) {
			loadJobs(nextCursor);
		}
	}

	onMount(() => {
		loadJobs();
	});
</script>

<div>
	<!-- Header -->
	<div class="mb-6">
		<h1 class="text-xl font-headline text-on-surface">Build History</h1>
		<p class="text-sm text-on-surface-variant mt-1">Recent test executions</p>
	</div>

	<!-- Filter Tabs -->
	<div class="flex flex-wrap items-center gap-3 mb-6">
		<!-- Status tabs -->
		<div class="flex gap-1 bg-surface-container rounded-lg p-1">
			{#if statusFilter === ''}
				<button
					class="rounded-md px-3 py-1.5 text-xs font-medium bg-surface-container-high text-on-surface"
					onclick={() => handleFilterChange({ status: '', platform: platformFilter })}
				>
					All Runs
				</button>
			{:else}
				<button
					class="rounded-md px-3 py-1.5 text-xs font-medium text-on-surface-variant hover:text-on-surface transition-colors"
					onclick={() => handleFilterChange({ status: '', platform: platformFilter })}
				>
					All Runs
				</button>
			{/if}

			{#if statusFilter === 'passed'}
				<button
					class="rounded-md px-3 py-1.5 text-xs font-medium bg-surface-container-high text-on-surface"
					onclick={() => handleFilterChange({ status: 'passed', platform: platformFilter })}
				>
					Success
				</button>
			{:else}
				<button
					class="rounded-md px-3 py-1.5 text-xs font-medium text-on-surface-variant hover:text-on-surface transition-colors"
					onclick={() => handleFilterChange({ status: 'passed', platform: platformFilter })}
				>
					Success
				</button>
			{/if}

			{#if statusFilter === 'failed'}
				<button
					class="rounded-md px-3 py-1.5 text-xs font-medium bg-surface-container-high text-on-surface"
					onclick={() => handleFilterChange({ status: 'failed', platform: platformFilter })}
				>
					Failures
				</button>
			{:else}
				<button
					class="rounded-md px-3 py-1.5 text-xs font-medium text-on-surface-variant hover:text-on-surface transition-colors"
					onclick={() => handleFilterChange({ status: 'failed', platform: platformFilter })}
				>
					Failures
				</button>
			{/if}
		</div>

		<!-- Platform toggle -->
		<div class="flex gap-1 bg-surface-container rounded-lg p-1">
			{#if platformFilter === ''}
				<button
					class="rounded-md px-3 py-1.5 text-xs font-medium bg-surface-container-high text-on-surface"
					onclick={() => handleFilterChange({ status: statusFilter, platform: '' })}
				>
					All
				</button>
			{:else}
				<button
					class="rounded-md px-3 py-1.5 text-xs font-medium text-on-surface-variant hover:text-on-surface transition-colors"
					onclick={() => handleFilterChange({ status: statusFilter, platform: '' })}
				>
					All
				</button>
			{/if}

			{#if platformFilter === 'android'}
				<button
					class="rounded-md px-3 py-1.5 text-xs font-medium bg-surface-container-high text-on-surface"
					onclick={() => handleFilterChange({ status: statusFilter, platform: '' })}
				>
					Android
				</button>
			{:else}
				<button
					class="rounded-md px-3 py-1.5 text-xs font-medium text-on-surface-variant hover:text-on-surface transition-colors"
					onclick={() => handleFilterChange({ status: statusFilter, platform: 'android' })}
				>
					Android
				</button>
			{/if}

			{#if platformFilter === 'ios'}
				<button
					class="rounded-md px-3 py-1.5 text-xs font-medium bg-surface-container-high text-on-surface"
					onclick={() => handleFilterChange({ status: statusFilter, platform: '' })}
				>
					iOS
				</button>
			{:else}
				<button
					class="rounded-md px-3 py-1.5 text-xs font-medium text-on-surface-variant hover:text-on-surface transition-colors"
					onclick={() => handleFilterChange({ status: statusFilter, platform: 'ios' })}
				>
					iOS
				</button>
			{/if}
		</div>
	</div>

	<ReportTabs active={activeTab} onSelect={(t) => (activeTab = t)} />

	<!-- Content -->
	{#if activeTab === 'list'}
		{#if error}
			<div class="bg-tertiary/10 border border-tertiary/20 rounded-lg px-4 py-3 text-tertiary text-sm">
				{error}
			</div>
		{:else if loading}
			<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
				{#each Array(6) as _}
					<div class="bg-surface-container-low rounded-lg p-4 animate-pulse">
						<div class="flex items-center gap-2 mb-3">
							<div class="w-12 h-4 rounded bg-surface-container"></div>
							<div class="w-16 h-4 rounded bg-surface-container"></div>
						</div>
						<div class="flex items-center gap-4 mb-3">
							<div class="w-16 h-3 rounded bg-surface-container"></div>
							<div class="w-12 h-3 rounded bg-surface-container"></div>
						</div>
						<div class="flex justify-end">
							<div class="w-20 h-3 rounded bg-surface-container"></div>
						</div>
					</div>
				{/each}
			</div>
		{:else if jobs.length === 0}
			<div class="bg-surface-container-low rounded-lg px-4 py-16 text-center">
				<span class="material-symbols-outlined text-4xl text-primary/40 mb-3 block">inbox</span>
				<p class="text-sm font-medium text-on-surface-variant">No builds found</p>
				<p class="text-xs text-on-surface-variant/70 mt-1">Try adjusting your filters.</p>
			</div>
		{:else}
			<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
				{#each jobs as job (job.id)}
					<JobCard {job} />
				{/each}
			</div>

			<Pagination {hasMore} loading={loadingMore} onloadmore={handleLoadMore} />
		{/if}
	{:else if activeTab === 'suites'}
		<SuitesTable {suites} />
	{:else if activeTab === 'history'}
		<div class="text-[13px] text-on-surface-variant">History view — uses the same job list with <code>?flowName=</code> filter dropdown (Phase 4.11 polish).</div>
	{:else if activeTab === 'trends' && trends}
		<TrendsCharts {trends} />
	{:else if activeTab === 'trends'}
		<div class="text-[13px] text-on-surface-variant">Loading trends…</div>
	{/if}
</div>
