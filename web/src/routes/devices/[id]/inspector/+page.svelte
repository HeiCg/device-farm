<script lang="ts">
	import { page } from '$app/state';
	import DevicePreview from '$lib/components/devices/DevicePreview.svelte';

	let deviceId = $derived(page.params.id as string);
</script>

<!-- Header -->
<div class="mb-4">
	<div class="flex items-center gap-2 mb-3">
		<a
			href="/devices"
			class="inline-flex items-center gap-1 text-xs text-on-surface-variant hover:text-on-surface transition-colors"
		>
			<span class="material-symbols-outlined text-sm">arrow_back</span>
			Devices
		</a>
		<span class="text-on-surface-variant/30">/</span>
		<span class="text-xs text-on-surface-variant font-mono">{deviceId.slice(0, 8)}</span>
		<span class="text-on-surface-variant/30">/</span>
		<span class="text-xs text-on-surface font-medium">Live view</span>
	</div>

	<h1 class="font-headline text-lg font-bold text-on-surface tracking-wide">LIVE_VIEW</h1>
</div>

<div class="max-w-[480px] mx-auto">
	<DevicePreview {deviceId} />
</div>
