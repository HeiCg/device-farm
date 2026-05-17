<script lang="ts">
	import { onMount } from 'svelte';
	import { getHealth } from '$lib/api/health.js';
	import { listJobs } from '$lib/api/jobs.js';
	import type { HealthResponse, Job } from '$lib/api/types.js';
	import { DeviceState } from '$lib/api/types.js';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import AlertBanner from '$lib/components/shared/AlertBanner.svelte';
	import { formatRelativeTime, platformLabel, statusStyle } from '$lib/utils/format.js';

	let health: HealthResponse | null = $state(null);
	let recentJobs: Job[] = $state([]);
	let loading = $state(true);
	let error: string | null = $state(null);

	onMount(async () => {
		try {
			const [healthData, jobsData] = await Promise.all([
				getHealth(),
				listJobs(),
			]);
			health = healthData;
			recentJobs = jobsData.data;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load dashboard data';
		} finally {
			loading = false;
		}
	});

	let totalDevices = $derived(health ? health.devices.length : 0);

	let onlineCount = $derived(
		health
			? health.devices.filter(
					(d) => d.state === DeviceState.Idle || d.state === DeviceState.Running || d.state === DeviceState.Allocated
				).length
			: 0
	);

	let maintenanceCount = $derived(
		health
			? health.devices.filter(
					(d) => d.state === DeviceState.Booting || d.state === DeviceState.Cleanup
				).length
			: 0
	);

	let errorCount = $derived(
		health
			? health.devices.filter(
					(d) => d.state === DeviceState.Error || d.state === DeviceState.Offline
				).length
			: 0
	);

	let healthPercent = $derived(
		totalDevices > 0 ? Math.round((onlineCount / totalDevices) * 100) : 0
	);

	let errorDevices = $derived(
		health
			? health.devices.filter((d) => d.state === DeviceState.Error || d.state === DeviceState.Offline)
			: []
	);

	let queueDepth = $derived(health ? health.queue.android + health.queue.ios : 0);

	const jobBorderStyles: Record<string, string> = {
		passed: 'border-l-secondary',
		failed: 'border-l-tertiary',
		error: 'border-l-tertiary',
		timeout: 'border-l-tertiary',
		running: 'border-l-primary',
		queued: 'border-l-surface-variant',
		cancelled: 'border-l-surface-variant',
	};
</script>

<div>
	<!-- Page Header -->
	<div class="mb-8">
		<h2 class="text-2xl font-headline font-bold text-on-surface mb-1">Fleet Overview</h2>
		<p class="text-sm text-on-surface-variant">Real-time status of your device testing infrastructure.</p>
	</div>

	{#if error}
		<AlertBanner variant="critical" message={error ?? 'Unknown error'} />
	{:else if loading}
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
			{#each Array(4) as _}
				<div class="animate-pulse glass-card rounded-xl p-6">
					<div class="h-3 w-24 rounded bg-surface-container mb-4"></div>
					<div class="h-10 w-16 rounded bg-surface-container"></div>
				</div>
			{/each}
		</div>
	{:else}
		<!-- Alert Banners -->
		{#if errorDevices.length > 0 || queueDepth > 3}
			<div class="mb-6 flex flex-col gap-2">
				{#each errorDevices as device}
					<AlertBanner variant="critical" message="{device.name} ({device.id.slice(0, 8)}) is in {device.state} state." href="/devices" />
				{/each}
				{#if queueDepth > 3}
					<AlertBanner variant="warning" message="Queue depth is {queueDepth} — consider scaling up." />
				{/if}
			</div>
		{/if}

		<!-- Bento Grid -->
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

			<!-- Infrastructure Health -->
			<div class="glass-card rounded-xl p-6 lg:col-span-2">
				<div class="text-on-surface-variant text-[10px] font-headline tracking-[0.2em] uppercase mb-4">Infrastructure Health</div>
				<div class="flex items-end gap-6 mb-6">
					<div class="text-5xl font-headline font-bold text-secondary">{healthPercent}%</div>
					<div class="text-sm text-on-surface-variant pb-1">{onlineCount} of {totalDevices} devices online</div>
				</div>
				<!-- Segmented bar -->
				<div class="flex gap-0.5 h-2 rounded-full overflow-hidden bg-surface-container">
					{#if totalDevices > 0}
						<div class="bg-secondary health-bar rounded-l-full" style="width: {onlineCount / totalDevices * 100}%"></div>
						<div class="bg-primary health-bar" style="width: {maintenanceCount / totalDevices * 100}%"></div>
						<div class="bg-tertiary health-bar rounded-r-full" style="width: {errorCount / totalDevices * 100}%"></div>
					{/if}
				</div>
				<div class="flex gap-6 mt-3 text-xs">
					<div class="flex items-center gap-1.5">
						<span class="w-2 h-2 rounded-full bg-secondary"></span>
						<span class="text-on-surface-variant">Online {onlineCount}</span>
					</div>
					<div class="flex items-center gap-1.5">
						<span class="w-2 h-2 rounded-full bg-primary"></span>
						<span class="text-on-surface-variant">Maintenance {maintenanceCount}</span>
					</div>
					<div class="flex items-center gap-1.5">
						<span class="w-2 h-2 rounded-full bg-tertiary"></span>
						<span class="text-on-surface-variant">Error {errorCount}</span>
					</div>
				</div>
			</div>

			<!-- Queue Android -->
			<div class="glass-card rounded-xl p-6">
				<div class="text-on-surface-variant text-[10px] font-headline tracking-[0.2em] uppercase mb-4">Queue Android</div>
				<div class="text-4xl font-headline font-bold text-on-surface">{health?.queue.android ?? 0}</div>
				<div class="text-xs text-on-surface-variant mt-2">
					{#if (health?.queue.android ?? 0) === 0}
						No builds waiting
					{:else}
						builds in queue
					{/if}
				</div>
			</div>

			<!-- Queue iOS — red tint via if/else block when overloaded (D016) -->
			{#if (health?.queue.ios ?? 0) > 3}
				<div class="glass-card rounded-xl p-6 ring-1 ring-tertiary/20">
					<div class="text-on-surface-variant text-[10px] font-headline tracking-[0.2em] uppercase mb-4">Queue iOS</div>
					<div class="text-4xl font-headline font-bold text-tertiary">{health?.queue.ios ?? 0}</div>
					<div class="text-xs text-tertiary/80 mt-2">Queue backlog — consider scaling</div>
				</div>
			{:else}
				<div class="glass-card rounded-xl p-6">
					<div class="text-on-surface-variant text-[10px] font-headline tracking-[0.2em] uppercase mb-4">Queue iOS</div>
					<div class="text-4xl font-headline font-bold text-on-surface">{health?.queue.ios ?? 0}</div>
					<div class="text-xs text-on-surface-variant mt-2">
						{#if (health?.queue.ios ?? 0) === 0}
							No builds waiting
						{:else}
							builds in queue
						{/if}
					</div>
				</div>
			{/if}

			<!-- Active Fleet Status -->
			{#if health && health.devices.length > 0}
				<div class="lg:col-span-2">
					<div class="text-on-surface-variant text-[10px] font-headline tracking-[0.2em] uppercase mb-3">Active Fleet Status</div>
					<div class="bg-surface-container-low rounded-xl border border-white/5 overflow-hidden">
						<table class="w-full text-sm">
							<thead>
								<tr class="bg-surface-container-high/50 border-b border-white/5">
									<th class="text-left px-4 py-2.5 text-[10px] font-headline tracking-[0.2em] uppercase text-on-surface-variant">Device</th>
									<th class="text-left px-4 py-2.5 text-[10px] font-headline tracking-[0.2em] uppercase text-on-surface-variant">Platform</th>
									<th class="text-left px-4 py-2.5 text-[10px] font-headline tracking-[0.2em] uppercase text-on-surface-variant">Status</th>
									<th class="text-left px-4 py-2.5 text-[10px] font-headline tracking-[0.2em] uppercase text-on-surface-variant">Current Session</th>
									<th class="text-left px-4 py-2.5 text-[10px] font-headline tracking-[0.2em] uppercase text-on-surface-variant">Actions</th>
								</tr>
							</thead>
							<tbody>
								{#each health.devices as device}
									<tr class="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
										<td class="px-4 py-3 text-on-surface">{device.name}</td>
										<td class="px-4 py-3">
											<span class="text-[10px] font-headline uppercase tracking-wider text-on-surface-variant">{platformLabel(device.platform)}</span>
										</td>
										<td class="px-4 py-3"><StatusBadge status={device.state} /></td>
										<td class="px-4 py-3">
											{#if device.currentJobId}
												<a class="text-primary hover:underline" href="/jobs/{device.currentJobId}">{device.currentJobId.slice(0, 8)}</a>
											{:else}
												<span class="text-on-surface-variant">—</span>
											{/if}
										</td>
										<td class="px-4 py-3">
											<a href="/devices" class="text-on-surface-variant hover:text-on-surface transition-colors">
												<span class="material-symbols-outlined text-base">open_in_new</span>
											</a>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			{/if}

			<!-- Recent Builds -->
			{#if recentJobs.length > 0}
				<div>
					<div class="text-on-surface-variant text-[10px] font-headline tracking-[0.2em] uppercase mb-3">Recent Builds</div>
					<div class="flex flex-col gap-3">
						{#each recentJobs.slice(0, 5) as job (job.id)}
							{@const borderClass = jobBorderStyles[job.status] ?? 'border-l-surface-variant'}
							{@const style = statusStyle(job.status)}
							<a href="/jobs/{job.id}" class="p-4 rounded-xl border-l-4 border-y border-r border-white/5 hover:bg-white/[0.02] transition-colors {borderClass}">
								<div class="flex justify-between items-start mb-1">
									<span class="text-sm font-headline text-on-surface">{job.id.slice(0, 8)}</span>
									<span class="text-[10px] text-on-surface-variant">{formatRelativeTime(job.createdAt)}</span>
								</div>
								<div class="flex justify-between items-center">
									<span class="text-xs text-on-surface-variant">{platformLabel(job.platform)}</span>
									<span class="text-xs font-bold uppercase {style.color}">{style.label}</span>
								</div>
							</a>
						{/each}
					</div>
				</div>
			{/if}

		</div>
	{/if}
</div>
