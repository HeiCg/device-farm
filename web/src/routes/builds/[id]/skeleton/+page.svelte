<!--
  Phase 37 Plan 37-01 — iOS skeleton viewer page.

  Loads the analysis via +page.ts; renders SkeletonReport when present,
  empty-state with copy-paste CLI command when not.
-->
<script lang="ts">
	import SkeletonReport from '$lib/components/SkeletonReport.svelte';
	import type { SkeletonPageData } from './+page.js';

	let { data }: { data: SkeletonPageData } = $props();
</script>

<svelte:head>
	<title>Skeleton — Build {data.buildId} · Device Farm</title>
</svelte:head>

<div class="container">
	<h1>Skeleton — Build {data.buildId}</h1>

	{#if data.notFound || !data.skeleton}
		<div class="empty-state">
			<p>No skeleton uploaded yet.</p>
			<p class="hint">
				Run the analyze command and upload to attach an iOS screen skeleton to this build:
			</p>
			<code class="cli-cmd">
				device-farm analyze &lt;ipa&gt; --upload-to-build {data.buildId}
			</code>
		</div>
	{:else}
		<SkeletonReport payload={data.skeleton.payload} buildId={data.buildId} />
	{/if}
</div>

<style>
	.container {
		max-width: 80rem;
		margin: 2rem auto;
		padding: 0 1.5rem;
	}
	h1 {
		font-size: 1.5rem;
		font-weight: 700;
		margin-bottom: 1rem;
	}
	.empty-state {
		border: 1px solid #d1d5db;
		background: #f9fafb;
		border-radius: 0.5rem;
		padding: 1.5rem;
	}
	.empty-state p {
		margin: 0 0 0.5rem;
		color: #374151;
	}
	.hint {
		font-size: 0.875rem;
		color: #6b7280;
	}
	.cli-cmd {
		display: block;
		margin-top: 0.5rem;
		padding: 0.625rem 0.75rem;
		background: #1f2937;
		color: #f3f4f6;
		font-family: ui-monospace, monospace;
		font-size: 0.85rem;
		border-radius: 0.375rem;
		overflow-x: auto;
	}
</style>
