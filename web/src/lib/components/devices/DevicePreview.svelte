<script lang="ts">
	import { onMount } from 'svelte';
	import { createDevicePreview } from '$lib/ws/device-preview.svelte.js';

	let { deviceId }: { deviceId: string } = $props();

	// IMPORTANT: must NOT be `$derived` — that recreates the preview on every
	// reactive update, leaving the WebSocket/decoder orphaned. Single instance
	// per component mount; deviceId changes are handled by remount of the
	// component via keyed parent (or full reload).
	const preview = createDevicePreview(deviceId);
	let canvas: HTMLCanvasElement | null = $state(null);

	$effect(() => {
		preview.setCanvas(canvas);
	});

	onMount(() => {
		preview.connect();
		return () => preview.disconnect();
	});
</script>

<div class="relative aspect-[9/16] bg-[#0d1117] rounded-md border border-[#30363d] overflow-hidden">
	<canvas bind:this={canvas} class="w-full h-full object-contain"></canvas>

	{#if preview.error}
		<div class="absolute inset-0 flex items-center justify-center bg-black/60">
			<span class="text-[13px] text-red-400 px-3 text-center">{preview.error}</span>
		</div>
	{:else if preview.frameSrc}
		<img
			src={preview.frameSrc}
			alt="Live device preview"
			class="absolute inset-0 w-full h-full object-contain"
		/>
	{:else if !preview.connected}
		<div class="absolute inset-0 flex items-center justify-center">
			<span class="text-[13px] text-[#484f58]">Connecting...</span>
		</div>
	{:else if preview.width === 0}
		<div class="absolute inset-0 flex items-center justify-center">
			<span class="text-[13px] text-[#7d8590]">Waiting for stream...</span>
		</div>
	{/if}
</div>
