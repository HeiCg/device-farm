<script lang="ts">
	import { onMount } from 'svelte';
	import type { HierarchySource } from '$lib/api/types.js';
	import { apiFetch } from '$lib/api/client.js';

	let {
		selected,
		onchange,
		disabled = false
	}: {
		selected: HierarchySource;
		onchange: (source: HierarchySource) => void;
		disabled?: boolean;
	} = $props();

	let appiumAvailable = $state<boolean | null>(null);

	onMount(async () => {
		try {
			const status = await apiFetch<{ available: boolean }>('/api/appium/status');
			appiumAvailable = status.available;
		} catch {
			appiumAvailable = false;
		}
	});

	function handleChange(event: Event) {
		const value = (event.currentTarget as HTMLSelectElement).value as HierarchySource;
		onchange(value);
	}
</script>

<div class="space-y-1.5">
	<label
		for="hierarchy-source"
		class="block text-xs text-on-surface-variant tracking-widest uppercase font-medium"
	>
		Hierarchy Source
	</label>
	<select
		id="hierarchy-source"
		value={selected}
		onchange={handleChange}
		{disabled}
		class="w-full bg-surface-container-high text-on-surface border border-outline-variant rounded-lg px-3 py-2 text-sm
			focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50
			transition-colors appearance-none
			{disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-outline'}"
	>
		<option value="maestro-cli">Maestro Driver</option>
		<option value="device-server">Device Server (APK)</option>
		<option value="native">ADB / idb (native)</option>
		<option value="appium" disabled={appiumAvailable === false}>
			Appium{appiumAvailable === false ? ' (not running)' : appiumAvailable === null ? ' (checking...)' : ''}
		</option>
	</select>
	{#if appiumAvailable === false}
		<p class="text-[9px] text-on-surface-variant/50 mt-0.5">
			Install: <code class="font-mono">npm i -g appium && appium driver install uiautomator2</code>
		</p>
	{/if}
</div>
