<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { Device } from '$lib/api/types.js';
	import { DeviceState } from '$lib/api/types.js';
	import { listDevices, restartDevice, refreshDeviceInfo } from '$lib/api/devices.js';
	import DeviceCard from '$lib/components/devices/DeviceCard.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';

	let devices: Device[] = $state([]);
	let loading = $state(true);
	let error: string | null = $state(null);
	let intervalId: ReturnType<typeof setInterval> | null = null;

	async function fetchDevices() {
		try {
			devices = await listDevices();
			error = null;
		} catch (err: any) {
			error = err.detail ?? err.message ?? 'Failed to fetch devices';
		} finally {
			loading = false;
		}
	}

	async function handleRestart(id: string) {
		try {
			await restartDevice(id);
			await fetchDevices();
		} catch (err: any) {
			error = err.detail ?? err.message ?? 'Failed to restart device';
		}
	}

	async function handleRefresh(id: string) {
		try {
			await refreshDeviceInfo(id);
			await fetchDevices();
		} catch (err: any) {
			error = err.detail ?? err.message ?? 'Failed to refresh device info';
		}
	}

	function getDevicesByPlatform(platform: 'android' | 'ios'): Device[] {
		return devices.filter((d) => d.platform === platform);
	}

	function countByState(state: DeviceState): number {
		return devices.filter((d) => d.state === state).length;
	}

	const stateIndicators: Array<{ state: DeviceState; label: string }> = [
		{ state: DeviceState.Idle, label: 'Idle' },
		{ state: DeviceState.Running, label: 'Running' },
		{ state: DeviceState.Booting, label: 'Booting' },
		{ state: DeviceState.Error, label: 'Error' },
		{ state: DeviceState.Offline, label: 'Offline' },
	];

	const counterBorderStyles: Record<string, string> = {
		[DeviceState.Idle]: 'border-l-secondary/40',
		[DeviceState.Running]: 'border-l-primary/40',
		[DeviceState.Booting]: 'border-l-primary/30',
		[DeviceState.Error]: 'border-l-tertiary/40',
		[DeviceState.Offline]: 'border-l-outline-variant/30',
	};

	const counterTextStyles: Record<string, string> = {
		[DeviceState.Idle]: 'text-secondary',
		[DeviceState.Running]: 'text-primary',
		[DeviceState.Booting]: 'text-primary/70',
		[DeviceState.Error]: 'text-tertiary',
		[DeviceState.Offline]: 'text-outline-variant',
	};

	onMount(() => {
		fetchDevices();
		intervalId = setInterval(fetchDevices, 5000);
	});

	onDestroy(() => {
		if (intervalId) {
			clearInterval(intervalId);
			intervalId = null;
		}
	});
</script>

<div>
	<!-- Header -->
	<div class="mb-6">
		<h1 class="font-headline text-lg font-bold text-on-surface tracking-wide">FLEET_MANAGEMENT</h1>
		{#if !loading}
			<p class="text-xs text-on-surface-variant mt-1">{devices.length} device{devices.length !== 1 ? 's' : ''} registered</p>
		{/if}
	</div>

	<!-- Summary counters -->
	{#if !loading && devices.length > 0}
		<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-8">
			{#each stateIndicators as ind}
				{@const count = countByState(ind.state)}
				{@const borderClass = counterBorderStyles[ind.state] ?? 'border-l-outline-variant/30'}
				{@const textClass = counterTextStyles[ind.state] ?? 'text-outline-variant'}
				<div class="bg-surface-container-low p-4 rounded-lg border-l-2 {borderClass}">
					<p class="text-2xl font-bold {textClass}">{count}</p>
					<p class="text-[10px] text-on-surface-variant tracking-widest uppercase mt-1">{ind.label}</p>
				</div>
			{/each}
		</div>
	{/if}

	{#if loading}
		<!-- Loading skeleton -->
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each Array(3) as _}
				<div class="bg-surface-container-high rounded-lg p-4 animate-pulse">
					<div class="flex items-center justify-between mb-3">
						<div class="h-4 w-24 rounded bg-surface-container-low"></div>
						<div class="h-4 w-16 rounded bg-surface-container-low"></div>
					</div>
					<div class="h-3 w-16 rounded bg-surface-container-low mb-3"></div>
					<div class="h-3 w-32 rounded bg-surface-container-low"></div>
				</div>
			{/each}
		</div>
	{:else if error}
		<div class="rounded-lg bg-tertiary/10 border border-tertiary/20 px-4 py-3 text-sm text-tertiary">
			{error}
		</div>
	{:else if devices.length === 0}
		<div class="rounded-lg bg-surface-container-low px-4 py-16 text-center">
			<p class="text-sm font-medium text-on-surface-variant">No devices registered</p>
			<p class="text-xs text-on-surface-variant/70 mt-1">Devices will appear once the pool is configured.</p>
		</div>
	{:else}
		{@const androidDevices = getDevicesByPlatform('android')}
		{@const iosDevices = getDevicesByPlatform('ios')}

		{#if androidDevices.length > 0}
			<div class="mb-8">
				<div class="flex items-center gap-3 mb-4">
					<div class="p-2 bg-primary/10 rounded-lg">
						<span class="material-symbols-outlined text-primary">android</span>
					</div>
					<h2 class="font-headline font-bold text-sm tracking-widest text-on-surface">ANDROID_ECOSYSTEM</h2>
					<span class="text-xs text-on-surface-variant">({androidDevices.length})</span>
				</div>
				<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
					{#each androidDevices as device (device.id)}
						<DeviceCard {device} onrestart={handleRestart} onrefresh={handleRefresh} />
					{/each}
				</div>
			</div>
		{/if}

		{#if iosDevices.length > 0}
			<div class="mb-8">
				<div class="flex items-center gap-3 mb-4">
					<div class="p-2 bg-primary/10 rounded-lg">
						<span class="material-symbols-outlined text-primary">phone_iphone</span>
					</div>
					<h2 class="font-headline font-bold text-sm tracking-widest text-on-surface">IOS_SUITE</h2>
					<span class="text-xs text-on-surface-variant">({iosDevices.length})</span>
				</div>
				<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
					{#each iosDevices as device (device.id)}
						<DeviceCard {device} onrestart={handleRestart} onrefresh={handleRefresh} />
					{/each}
				</div>
			</div>
		{/if}
	{/if}
</div>
