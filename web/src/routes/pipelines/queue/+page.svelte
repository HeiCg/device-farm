<script lang="ts">
	let snapshot = $state<any>(null);
	let error = $state<string | null>(null);

	async function refresh() {
		try {
			const r = await fetch('/api/pipelines/queue');
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			snapshot = await r.json();
			error = null;
		} catch (e) {
			error = e instanceof Error ? e.message : 'unknown';
		}
	}

	$effect(() => {
		refresh();
		const id = setInterval(refresh, 3000);
		return () => clearInterval(id);
	});
</script>

<div class="space-y-6 p-6">
	<h1 class="text-xl font-headline font-bold">Pipeline Queue</h1>

	{#if error}
		<div class="bg-tertiary/10 border border-tertiary/20 rounded-lg px-4 py-3 text-tertiary text-sm">{error}</div>
	{/if}

	{#if snapshot}
		<section>
			<h2 class="text-sm font-headline tracking-wider text-on-surface-variant mb-2">Capacity</h2>
			<div class="grid grid-cols-3 gap-2 text-xs">
				<div class="bg-surface-container-low rounded-lg p-3">
					<div class="text-on-surface-variant">Active</div>
					<div class="text-on-surface text-lg">{snapshot.capacity.active} / {snapshot.capacity.max_concurrent}</div>
				</div>
				<div class="bg-surface-container-low rounded-lg p-3">
					<div class="text-on-surface-variant">Android available</div>
					<div class="text-on-surface text-lg">{snapshot.capacity.available_devices_android}</div>
				</div>
				<div class="bg-surface-container-low rounded-lg p-3">
					<div class="text-on-surface-variant">iOS available</div>
					<div class="text-on-surface text-lg">{snapshot.capacity.available_devices_ios}</div>
				</div>
			</div>
		</section>

		<section>
			<h2 class="text-sm font-headline tracking-wider text-on-surface-variant mb-2">Running ({snapshot.running.length})</h2>
			{#if snapshot.running.length === 0}
				<div class="text-on-surface-variant text-xs">No runs in progress.</div>
			{:else}
				<ul class="space-y-1">
					{#each snapshot.running as r}
						<li class="bg-surface-container-low rounded-lg px-4 py-2 text-xs flex items-center gap-3">
							<a href={`/pipeline-runs/${r.runId}`} class="text-primary">{r.runId.slice(0, 8)}</a>
							<span class="text-on-surface-variant">{r.trigger}</span>
							{#if r.pr}<span class="text-on-surface-variant">PR #{r.pr}</span>{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section>
			<h2 class="text-sm font-headline tracking-wider text-on-surface-variant mb-2">Pending ({snapshot.pending.length})</h2>
			{#if snapshot.pending.length === 0}
				<div class="text-on-surface-variant text-xs">Queue is empty.</div>
			{:else}
				<ul class="space-y-1">
					{#each snapshot.pending as r}
						<li class="bg-surface-container-low rounded-lg px-4 py-2 text-xs flex items-center gap-3">
							<span class="text-on-surface-variant">#{r.position}</span>
							<a href={`/pipeline-runs/${r.runId}`} class="text-primary">{r.runId.slice(0, 8)}</a>
							<span class="text-on-surface-variant">{r.trigger}</span>
							{#if r.pr}<span class="text-on-surface-variant">PR #{r.pr}</span>{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{:else}
		<div class="text-on-surface-variant text-xs">Loading…</div>
	{/if}
</div>
