<script lang="ts">
	import type { Device } from '$lib/api/types.js';
	import { DeviceState } from '$lib/api/types.js';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';

	let { device, onrestart, onrefresh }: { device: Device; onrestart?: (id: string) => void; onrefresh?: (id: string) => void } = $props();

	let refreshing = $state(false);

	const cardBorderStyles: Record<string, string> = {
		running: 'border-primary/30',
		error: 'border-tertiary/30',
		booting: 'border-primary/20',
		idle: 'border-outline-variant/10',
		allocated: 'border-primary/20',
		cleanup: 'border-primary/20',
		offline: 'border-outline-variant/10',
	};

	const wrapperStyles: Record<string, string> = {
		offline: 'opacity-60 grayscale',
	};

	let borderClass = $derived(cardBorderStyles[device.state] ?? 'border-outline-variant/10');
	let wrapperClass = $derived(wrapperStyles[device.state] ?? '');

	let hasMetadata = $derived(device.metadata != null);
	let displayOs = $derived(device.metadata?.osVersion ?? '—');
	let displayResolution = $derived(
		device.metadata?.screenWidth != null && device.metadata?.screenHeight != null
			? `${device.metadata.screenWidth}×${device.metadata.screenHeight}`
			: '—'
	);
	let displayRam = $derived(device.metadata?.ramMb != null ? `${device.metadata.ramMb} MB` : '—');
	let displayModel = $derived(device.metadata?.model ?? '—');
	let displayAbi = $derived(device.metadata?.abi ?? '—');

	async function handleRefreshClick() {
		if (refreshing || !onrefresh) return;
		refreshing = true;
		try {
			await onrefresh(device.id);
		} finally {
			refreshing = false;
		}
	}
</script>

<div class="bg-surface-container-high p-4 rounded-lg border {borderClass} {wrapperClass} transition-colors">
	<!-- Header row: name + StatusBadge -->
	<div class="flex items-center justify-between mb-3">
		<span class="text-sm font-medium text-on-surface">{device.name}</span>
		<StatusBadge status={device.state} />
	</div>

	<!-- Platform badge -->
	<div class="mb-3">
		<span class="text-[10px] px-2 py-0.5 rounded bg-surface-container-low text-on-surface-variant font-headline tracking-widest uppercase">
			{device.platform === 'android' ? 'Android' : 'iOS'}
		</span>
	</div>

	<!-- Metadata section (shared across all states where device has booted) -->
	{#if hasMetadata}
		<div class="mb-3 grid grid-cols-2 gap-x-3 gap-y-1">
			<span class="text-xs text-on-surface-variant">OS</span>
			<span class="text-xs text-on-surface font-mono">{displayOs}</span>

			<span class="text-xs text-on-surface-variant">Resolution</span>
			<span class="text-xs text-on-surface font-mono">{displayResolution}</span>

			<span class="text-xs text-on-surface-variant">RAM</span>
			<span class="text-xs text-on-surface font-mono">{displayRam}</span>

			<span class="text-xs text-on-surface-variant">Model</span>
			<span class="text-xs text-on-surface font-mono">{displayModel}</span>

			<span class="text-xs text-on-surface-variant">ABI</span>
			<span class="text-xs text-on-surface font-mono">{displayAbi}</span>
		</div>
	{/if}

	<!-- State-specific content -->
	{#if device.state === DeviceState.Running || device.state === DeviceState.Allocated || device.state === DeviceState.Cleanup}
		<div class="text-xs text-on-surface-variant space-y-1">
			<p class="font-mono text-on-surface-variant/70">{device.emulatorId}</p>
			{#if device.currentJobId}
				<p>Job: <a href="/jobs/{device.currentJobId}" class="text-primary hover:text-primary/80 font-mono">{device.currentJobId.slice(0, 8)}</a></p>
			{/if}
		</div>
		<div class="mt-2 flex items-center gap-2 flex-wrap">
			<a
				href="/devices/{device.id}/inspector"
				class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-primary bg-primary/10 border border-primary/20 rounded-lg hover:bg-primary/15 transition-colors"
			>
				<span class="material-symbols-outlined text-sm">search</span>
				Inspect
			</a>
			{#if onrefresh}
				<button
					onclick={handleRefreshClick}
					disabled={refreshing}
					class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-primary bg-primary/10 border border-primary/20 rounded-lg hover:bg-primary/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
				>
					<span class="material-symbols-outlined text-sm" class:animate-spin={refreshing}>refresh</span>
					{refreshing ? 'Refreshing…' : 'Refresh'}
				</button>
			{/if}
		</div>
	{:else if device.state === DeviceState.Error}
		<div class="space-y-2">
			<p class="text-xs font-mono text-on-surface-variant/70">{device.emulatorId}</p>
			{#if onrestart}
				<button
					onclick={() => onrestart?.(device.id)}
					class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-tertiary bg-tertiary/10 border border-tertiary/20 rounded-lg hover:bg-tertiary/15 transition-colors"
				>
					<span class="material-symbols-outlined text-sm">restart_alt</span>
					RESTART
				</button>
			{/if}
		</div>
	{:else if device.state === DeviceState.Booting}
		<div class="space-y-1">
			<p class="text-xs font-mono text-on-surface-variant/70">{device.emulatorId}</p>
			<div class="flex items-center gap-2">
				<div class="h-1 flex-1 bg-surface-container-low rounded-full overflow-hidden">
					<div class="h-full w-1/2 bg-primary/40 rounded-full animate-pulse"></div>
				</div>
				<span class="text-[10px] text-primary tracking-widest">BOOTING</span>
			</div>
		</div>
	{:else if device.state === DeviceState.Offline}
		<div class="space-y-1">
			<p class="text-xs font-mono text-on-surface-variant/70">{device.emulatorId}</p>
			<span class="text-[10px] text-outline-variant tracking-widest uppercase">MAINTENANCE</span>
		</div>
	{:else}
		<!-- Idle and other states: show emulator info -->
		<div class="text-xs text-on-surface-variant space-y-1">
			<p class="font-mono text-on-surface-variant/70">{device.emulatorId}</p>
		</div>
		{#if device.state === DeviceState.Idle}
			<div class="mt-2 flex items-center gap-2 flex-wrap">
				<a
					href="/devices/{device.id}/inspector"
					class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-primary bg-primary/10 border border-primary/20 rounded-lg hover:bg-primary/15 transition-colors"
				>
					<span class="material-symbols-outlined text-sm">search</span>
					Inspect
				</a>
				{#if onrefresh}
					<button
						onclick={handleRefreshClick}
						disabled={refreshing}
						class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-primary bg-primary/10 border border-primary/20 rounded-lg hover:bg-primary/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
					>
						<span class="material-symbols-outlined text-sm" class:animate-spin={refreshing}>refresh</span>
						{refreshing ? 'Refreshing…' : 'Refresh'}
					</button>
				{/if}
			</div>
		{/if}
	{/if}
</div>
