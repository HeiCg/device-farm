<script lang="ts">
	import { page } from '$app/state';
	import { onMount, onDestroy } from 'svelte';
	import { getHealth } from '$lib/api/health.js';
	import type { HealthResponse, Device } from '$lib/api/types.js';
	import { DeviceState } from '$lib/api/types.js';

	const links = [
		{ href: '/', label: 'Dashboard', icon: 'dashboard' },
		{ href: '/jobs', label: 'Jobs', icon: 'terminal' },
		{ href: '/pipelines', label: 'Pipelines', icon: 'account_tree' },
		{ href: '/devices', label: 'Devices', icon: 'developer_board' },
		{ href: '/settings', label: 'Settings', icon: 'tune' }
	];

	function isActive(href: string, pathname: string): boolean {
		if (href === '/') return pathname === '/';
		return pathname.startsWith(href);
	}

	let health: HealthResponse | null = $state(null);
	let intervalId: ReturnType<typeof setInterval> | null = null;

	async function fetchHealth() {
		try {
			health = await getHealth();
		} catch {
			// Silent — sidebar degrades gracefully
		}
	}

	let queueDepth = $derived(health ? health.queue.android + health.queue.ios : 0);

	let executorDevices = $derived(health?.devices?.slice(0, 5) ?? []);

	let healthPercent = $derived.by(() => {
		if (!health?.devices?.length) return 0;
		const healthy = health.devices.filter(
			(d) => d.state === DeviceState.Idle || d.state === DeviceState.Running || d.state === DeviceState.Allocated
		).length;
		return Math.round((healthy / health.devices.length) * 100);
	});

	function deviceStateLabel(device: Device): { text: string; class: string } {
		switch (device.state) {
			case DeviceState.Running:
				return {
					text: device.currentJobId ? `Running ${device.currentJobId.slice(0, 8)}...` : 'Running...',
					class: 'text-secondary font-medium'
				};
			case DeviceState.Idle:
				return { text: 'Idle', class: 'text-on-surface-variant italic' };
			case DeviceState.Booting:
				return { text: 'Booting...', class: 'text-primary' };
			case DeviceState.Allocated:
				return { text: 'Allocated', class: 'text-primary' };
			case DeviceState.Cleanup:
				return { text: 'Cleanup', class: 'text-primary/70' };
			case DeviceState.Error:
				return { text: 'Error', class: 'text-tertiary font-medium' };
			case DeviceState.Offline:
				return { text: 'Offline', class: 'text-outline-variant italic' };
			default:
				return { text: device.state, class: 'text-on-surface-variant' };
		}
	}

	onMount(() => {
		fetchHealth();
		intervalId = setInterval(fetchHealth, 5000);
	});

	onDestroy(() => {
		if (intervalId) {
			clearInterval(intervalId);
			intervalId = null;
		}
	});
</script>

<aside class="fixed left-0 top-16 h-[calc(100vh-4rem)] w-64 bg-background border-r border-primary/10 hidden md:flex flex-col z-40">
	<!-- Brand Header -->
	<div class="px-6 py-4 border-b border-outline-variant/10">
		<div class="flex items-center gap-2">
			<div class="w-2 h-2 rounded-full bg-secondary animate-pulse"></div>
			<span class="font-headline font-bold text-primary text-sm tracking-wider">Device Farm</span>
		</div>
		<div class="text-[10px] text-on-surface-variant font-mono mt-1">v1.0</div>
	</div>

	<!-- Nav Items -->
	<nav class="flex flex-col py-2">
		{#each links as link}
			{#if isActive(link.href, page.url.pathname)}
				<a href={link.href}
					class="flex items-center px-6 py-3 gap-3 bg-primary/10 text-primary border-r-4 border-primary transition-colors">
					<span class="material-symbols-outlined text-lg">{link.icon}</span>
					<span class="text-sm font-medium">{link.label}</span>
				</a>
			{:else}
				<a href={link.href}
					class="flex items-center px-6 py-3 gap-3 text-on-surface-variant hover:bg-white/5 transition-colors group">
					<span class="material-symbols-outlined text-lg group-hover:translate-x-1 transition-transform">{link.icon}</span>
					<span class="text-sm font-medium">{link.label}</span>
				</a>
			{/if}
		{/each}
	</nav>

	<!-- Build Queue -->
	<div class="px-6 mt-4">
		<h4 class="font-headline text-[10px] tracking-[0.2em] uppercase text-on-surface-variant mb-2 flex items-center justify-between">
			Build Queue
			<button class="material-symbols-outlined text-xs cursor-pointer hover:text-primary transition-colors text-on-surface-variant" onclick={fetchHealth} aria-label="Refresh queue">refresh</button>
		</h4>
		<div class="text-[11px] text-on-surface-variant bg-surface-container-low rounded-lg p-3 italic">
			{#if queueDepth > 0}
				{queueDepth} job{queueDepth !== 1 ? 's' : ''} in the queue.
			{:else}
				No builds in the queue.
			{/if}
		</div>
	</div>

	<!-- Build Executor Status -->
	{#if executorDevices.length > 0}
		<div class="px-6 mt-4">
			<h4 class="font-headline text-[10px] tracking-[0.2em] uppercase text-on-surface-variant mb-2">Build Executor Status</h4>
			<table class="w-full text-xs">
				<tbody>
					{#each executorDevices as device, i}
						{@const state = deviceStateLabel(device)}
						<tr class={i < executorDevices.length - 1 ? 'border-b border-outline-variant/10' : ''}>
							<td class="py-1.5 w-4 text-on-surface-variant">{i + 1}</td>
							<td class="py-1.5 {state.class}">
								{#if device.state === DeviceState.Running && device.currentJobId}
									<a href="/jobs/{device.currentJobId}" class="hover:underline">{state.text}</a>
								{:else}
									{state.text}
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<!-- Node Health -->
	<div class="mt-auto px-6 py-4 border-t border-outline-variant/10">
		<div class="flex items-center gap-2 text-xs text-on-surface-variant">
			<span class="material-symbols-outlined text-sm">cloud</span>
			<span>Node Health: <strong class="text-secondary">{healthPercent}.0%</strong></span>
		</div>
		<div class="w-full bg-surface-container-highest h-1.5 rounded-full mt-2">
			<div class="bg-secondary h-full rounded-full transition-all duration-500" style="width: {healthPercent}%" title="{healthPercent}% Healthy"></div>
		</div>
	</div>
</aside>
