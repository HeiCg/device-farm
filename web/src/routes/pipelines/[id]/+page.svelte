<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { getPipeline, updatePipeline, listPipelineRuns, listSchedules, createSchedule, deleteSchedule, triggerRun, type Pipeline, type PipelineRun, type PipelineSchedule } from '$lib/api/pipelines.js';
	import { formatDistanceToNow } from 'date-fns';

	let pipeline: Pipeline | null = $state(null);
	let runs: PipelineRun[] = $state([]);
	let schedules: PipelineSchedule[] = $state([]);
	let loading = $state(true);
	let error: string | null = $state(null);
	let activeTab = $state<'yaml' | 'schedules' | 'runs'>('yaml');
	let yamlContent = $state('');
	let saving = $state(false);
	let saveSuccess = $state(false);
	let triggering = $state(false);

	// Schedule form
	let newCron = $state('');
	let addingSchedule = $state(false);

	let pipelineId = $derived(page.params.id);

	async function loadData() {
		try {
			loading = true;
			const p = await getPipeline(pipelineId);
			pipeline = p;
			yamlContent = p.yamlContent;

			const [runList, scheduleList] = await Promise.all([
				listPipelineRuns(p.id),
				listSchedules(p.id),
			]);
			runs = runList;
			schedules = scheduleList;
			error = null;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load pipeline';
		} finally {
			loading = false;
		}
	}

	async function handleSave() {
		if (!pipeline) return;
		try {
			saving = true;
			saveSuccess = false;
			await updatePipeline(pipeline.id, yamlContent);
			saveSuccess = true;
			setTimeout(() => { saveSuccess = false; }, 2000);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to save';
		} finally {
			saving = false;
		}
	}

	async function handleTrigger() {
		if (!pipeline) return;
		try {
			triggering = true;
			const result = await triggerRun(pipeline.id);
			window.location.href = `/pipeline-runs/${result.run_id}`;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to trigger run';
			triggering = false;
		}
	}

	async function handleAddSchedule() {
		if (!pipeline || !newCron.trim()) return;
		try {
			addingSchedule = true;
			await createSchedule(pipeline.id, newCron.trim());
			newCron = '';
			schedules = await listSchedules(pipeline.id);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to create schedule';
		} finally {
			addingSchedule = false;
		}
	}

	async function handleDeleteSchedule(id: string) {
		if (!pipeline) return;
		try {
			await deleteSchedule(id);
			schedules = await listSchedules(pipeline.id);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to delete schedule';
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

	onMount(() => { loadData(); });
</script>

<div class="space-y-6">
	{#if loading}
		<div class="animate-pulse space-y-4">
			<div class="w-1/3 h-6 rounded bg-surface-container"></div>
			<div class="w-full h-64 rounded bg-surface-container-low"></div>
		</div>
	{:else if !pipeline}
		<div class="text-center py-16">
			<p class="text-on-surface-variant">Pipeline not found</p>
			<a href="/pipelines" class="text-primary text-sm mt-2 inline-block">Back to pipelines</a>
		</div>
	{:else}
		<!-- Header -->
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				<a href="/pipelines" class="material-symbols-outlined text-on-surface-variant hover:text-on-surface transition-colors">arrow_back</a>
				<div>
					<h1 class="text-xl font-headline font-bold text-on-surface tracking-wide">{pipeline.name}</h1>
					{#if pipeline.description}
						<p class="text-xs text-on-surface-variant mt-1">{pipeline.description}</p>
					{/if}
				</div>
			</div>
			<button onclick={handleTrigger} disabled={triggering}
				class="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-secondary text-background text-xs font-headline tracking-wider hover:bg-secondary/90 transition-colors disabled:opacity-50">
				<span class="material-symbols-outlined text-sm">{triggering ? 'hourglass_empty' : 'play_arrow'}</span>
				{triggering ? 'TRIGGERING...' : 'RUN NOW'}
			</button>
		</div>

		{#if error}
			<div class="bg-tertiary/10 border border-tertiary/20 rounded-lg px-4 py-3 text-tertiary text-sm">
				{error}
			</div>
		{/if}

		<!-- Tabs -->
		<div class="flex items-center gap-0 border-b border-outline-variant/10">
			<button
				class="px-4 py-2 text-[13px] font-medium border-b-2 -mb-px transition-colors {activeTab === 'yaml' ? 'text-on-surface border-primary' : 'text-on-surface-variant border-transparent hover:text-on-surface'}"
				onclick={() => (activeTab = 'yaml')}>
				YAML
			</button>
			<button
				class="px-4 py-2 text-[13px] font-medium border-b-2 -mb-px transition-colors {activeTab === 'schedules' ? 'text-on-surface border-primary' : 'text-on-surface-variant border-transparent hover:text-on-surface'}"
				onclick={() => (activeTab = 'schedules')}>
				Schedules ({schedules.length})
			</button>
			<button
				class="px-4 py-2 text-[13px] font-medium border-b-2 -mb-px transition-colors {activeTab === 'runs' ? 'text-on-surface border-primary' : 'text-on-surface-variant border-transparent hover:text-on-surface'}"
				onclick={() => (activeTab = 'runs')}>
				Runs ({runs.length})
			</button>
		</div>

		<!-- YAML Tab -->
		{#if activeTab === 'yaml'}
			<div class="bg-surface-container-low rounded-lg border border-white/5 overflow-hidden">
				<div class="px-4 py-2 bg-surface-container border-b border-white/5 flex items-center justify-between">
					<div class="flex items-center gap-2">
						<span class="material-symbols-outlined text-sm text-on-surface-variant">code</span>
						<span class="text-xs text-on-surface-variant font-mono">pipeline.yaml</span>
					</div>
					<button onclick={handleSave} disabled={saving}
						class="flex items-center gap-1 px-3 py-1 rounded text-xs {saveSuccess ? 'bg-secondary/20 text-secondary' : 'bg-primary/20 text-primary hover:bg-primary/30'} transition-colors disabled:opacity-50">
						<span class="material-symbols-outlined text-sm">{saveSuccess ? 'check' : 'save'}</span>
						{saving ? 'Saving...' : saveSuccess ? 'Saved' : 'Save'}
					</button>
				</div>
				<textarea
					bind:value={yamlContent}
					class="w-full h-[50vh] bg-transparent text-on-surface text-sm font-mono p-4 resize-none focus:outline-none"
					spellcheck="false"
				></textarea>
			</div>
		{/if}

		<!-- Schedules Tab -->
		{#if activeTab === 'schedules'}
			<div class="space-y-4">
				<!-- Add schedule form -->
				<div class="flex gap-2 items-center">
					<input
						type="text"
						bind:value={newCron}
						placeholder="Cron expression (e.g. 0 2 * * *)"
						class="flex-1 bg-surface-container-low border border-white/5 rounded-lg px-3 py-2 text-sm text-on-surface font-mono placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50"
					/>
					<button onclick={handleAddSchedule} disabled={addingSchedule || !newCron.trim()}
						class="px-4 py-2 rounded-lg bg-primary text-on-primary text-xs font-headline tracking-wider hover:bg-primary/90 transition-colors disabled:opacity-50">
						ADD
					</button>
				</div>

				{#if schedules.length === 0}
					<div class="bg-surface-container-low rounded-lg px-4 py-8 text-center border border-white/5">
						<span class="material-symbols-outlined text-2xl text-primary/40 mb-2 block">schedule</span>
						<p class="text-xs text-on-surface-variant">No schedules configured</p>
					</div>
				{:else}
					{#each schedules as schedule (schedule.id)}
						<div class="bg-surface-container-low rounded-lg p-4 border border-white/5 flex items-center justify-between">
							<div>
								<span class="text-sm font-mono text-on-surface">{schedule.cronExpression}</span>
								<div class="flex items-center gap-3 mt-1 text-[11px] text-on-surface-variant/50">
									<span>{schedule.enabled ? 'Enabled' : 'Disabled'}</span>
									{#if schedule.lastRunAt}
										<span>Last run: {formatDistanceToNow(new Date(schedule.lastRunAt), { addSuffix: true })}</span>
									{/if}
								</div>
							</div>
							<button onclick={() => handleDeleteSchedule(schedule.id)}
								class="material-symbols-outlined text-sm text-on-surface-variant/50 hover:text-tertiary transition-colors">
								delete
							</button>
						</div>
					{/each}
				{/if}
			</div>
		{/if}

		<!-- Runs Tab -->
		{#if activeTab === 'runs'}
			{#if runs.length === 0}
				<div class="bg-surface-container-low rounded-lg px-4 py-8 text-center border border-white/5">
					<span class="material-symbols-outlined text-2xl text-primary/40 mb-2 block">play_circle</span>
					<p class="text-xs text-on-surface-variant">No runs yet. Click "Run Now" to trigger one.</p>
				</div>
			{:else}
				<div class="space-y-2">
					{#each runs as run (run.id)}
						<a href="/pipeline-runs/{run.id}" class="block bg-surface-container-low rounded-lg p-4 border border-white/5 hover:bg-surface-container transition-colors">
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-3">
									<span class="{statusColor(run.status)} text-sm font-medium">{run.status}</span>
									<span class="text-xs text-on-surface-variant/50">{run.id.slice(0, 8)}</span>
									<span class="text-[10px] px-2 py-0.5 rounded bg-surface-container text-on-surface-variant">{run.triggerType}</span>
								</div>
								{#if run.startedAt}
									<span class="text-[11px] text-on-surface-variant/40">
										{formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })}
									</span>
								{/if}
							</div>
							{#if run.sourceBranch}
								<div class="text-[11px] text-on-surface-variant/50 mt-1">
									<span class="material-symbols-outlined text-xs align-middle">fork_right</span>
									{run.sourceBranch}
								</div>
							{/if}
						</a>
					{/each}
				</div>
			{/if}
		{/if}
	{/if}
</div>
