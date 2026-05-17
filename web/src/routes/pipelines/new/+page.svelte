<script lang="ts">
	import { onMount } from 'svelte';
	import { createPipeline } from '$lib/api/pipelines.js';

	let yamlContent = $state(`name: "my-pipeline"
description: "A new pipeline"
trigger:
  - api
stages:
  - name: setup
    script: echo "Setting up..."
    timeout: 60

  - name: test
    type: maestro
    platform: android
    flows: "maestro-flows/"
    timeout: 1800

  - name: teardown
    script: echo "Cleaning up..."
    when: always
`);
	let saving = $state(false);
	let error: string | null = $state(null);

	async function handleCreate() {
		try {
			saving = true;
			error = null;
			const result = await createPipeline(yamlContent);
			window.location.href = `/pipelines/${result.id}`;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to create pipeline';
		} finally {
			saving = false;
		}
	}
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-3">
			<a href="/pipelines" class="material-symbols-outlined text-on-surface-variant hover:text-on-surface transition-colors">arrow_back</a>
			<div>
				<h1 class="text-xl font-headline font-bold text-on-surface tracking-wide">New Pipeline</h1>
				<p class="text-xs text-on-surface-variant mt-1">Define your pipeline in YAML</p>
			</div>
		</div>
		<button onclick={handleCreate} disabled={saving}
			class="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-on-primary text-xs font-headline tracking-wider hover:bg-primary/90 transition-colors disabled:opacity-50">
			<span class="material-symbols-outlined text-sm">{saving ? 'hourglass_empty' : 'save'}</span>
			{saving ? 'CREATING...' : 'CREATE'}
		</button>
	</div>

	{#if error}
		<div class="bg-tertiary/10 border border-tertiary/20 rounded-lg px-4 py-3 text-tertiary text-sm">
			{error}
		</div>
	{/if}

	<!-- YAML Editor -->
	<div class="bg-surface-container-low rounded-lg border border-white/5 overflow-hidden">
		<div class="px-4 py-2 bg-surface-container border-b border-white/5 flex items-center gap-2">
			<span class="material-symbols-outlined text-sm text-on-surface-variant">code</span>
			<span class="text-xs text-on-surface-variant font-mono">pipeline.yaml</span>
		</div>
		<textarea
			bind:value={yamlContent}
			class="w-full h-[60vh] bg-transparent text-on-surface text-sm font-mono p-4 resize-none focus:outline-none"
			spellcheck="false"
		></textarea>
	</div>
</div>
