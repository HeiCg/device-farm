<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { fetchReport } from '$lib/api/reports.js';
	import { loadUiConfig } from '$lib/config.js';
	import type { ReportBundle } from '$lib/api/types.js';
	import ReportShell from '$lib/components/reports/ReportShell.svelte';
	import LegacyJobView from './LegacyJobView.svelte';

	let jobId = $derived(page.params.id as string);
	let shareToken = $derived(new URLSearchParams(page.url?.search ?? '').get('t') ?? undefined);

	let bundle = $state<ReportBundle | null>(null);
	let useReportShell = $state<boolean | null>(null);
	let error = $state<string | null>(null);

	onMount(async () => {
		const cfg = await loadUiConfig();
		useReportShell = cfg.useReportShell;
		if (cfg.useReportShell) {
			try {
				bundle = await fetchReport(jobId, shareToken);
			} catch (e) {
				error = e instanceof Error ? e.message : 'Failed to load report';
			}
		}
	});
</script>

{#if useReportShell === null}
	<div class="text-[13px] text-on-surface-variant">Loading…</div>
{:else if useReportShell && bundle}
	<div class="relative w-screen left-1/2 -translate-x-1/2 -mx-6">
		<div class="px-6 xl:px-8">
			<ReportShell {bundle} />
		</div>
	</div>
{:else if useReportShell && error}
	<div class="text-tertiary">{error}</div>
{:else}
	<LegacyJobView />
{/if}
