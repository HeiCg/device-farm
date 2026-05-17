<script lang="ts">
	import type { Artifact } from '$lib/api/types.js';

	let { jobId, artifacts }: { jobId: string; artifacts: Artifact[] } = $props();

	interface ScreenshotEntry {
		artifact: Artifact;
		stepIndex: number;
		src: string;
	}

	let screenshotArtifacts = $derived.by(() => {
		const stepPattern = /step-(\d+)/;
		const entries: ScreenshotEntry[] = [];
		for (const a of artifacts) {
			if (a.type !== 'screenshot') continue;
			const match = a.fileName.match(stepPattern);
			const stepIndex = match ? parseInt(match[1], 10) : 0;
			entries.push({
				artifact: a,
				stepIndex,
				src: '/api/jobs/' + jobId + '/artifacts/' + a.id
			});
		}
		entries.sort((a, b) => a.stepIndex - b.stepIndex);
		return entries;
	});

	let selectedIndex = $state<number | null>(null);

	let selectedEntry = $derived(
		selectedIndex !== null ? screenshotArtifacts[selectedIndex] ?? null : null
	);

	function openLightbox(index: number) {
		selectedIndex = index;
	}

	function closeLightbox() {
		selectedIndex = null;
	}

	function navigatePrev() {
		if (selectedIndex !== null && selectedIndex > 0) {
			selectedIndex = selectedIndex - 1;
		}
	}

	function navigateNext() {
		if (selectedIndex !== null && selectedIndex < screenshotArtifacts.length - 1) {
			selectedIndex = selectedIndex + 1;
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (selectedIndex === null) return;
		if (event.key === 'Escape') {
			closeLightbox();
		} else if (event.key === 'ArrowLeft') {
			navigatePrev();
		} else if (event.key === 'ArrowRight') {
			navigateNext();
		}
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			closeLightbox();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if screenshotArtifacts.length === 0}
	<div class="rounded-lg border border-outline-variant/10 bg-surface-container-low px-6 py-10 text-center">
		<span class="material-symbols-outlined text-3xl text-outline-variant mb-2">photo_library</span>
		<p class="text-[13px] text-on-surface-variant">No debug screenshots available for this job.</p>
	</div>
{:else}
	<!-- Screenshot count header -->
	<div class="flex items-center gap-2 mb-4">
		<span class="material-symbols-outlined text-sm text-primary">bug_report</span>
		<span class="text-[13px] font-medium text-on-surface">{screenshotArtifacts.length} debug screenshot{screenshotArtifacts.length === 1 ? '' : 's'}</span>
	</div>

	<!-- Thumbnail grid -->
	<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
		{#each screenshotArtifacts as entry, i}
			<button
				type="button"
				class="group rounded-lg border border-outline-variant/10 bg-surface-container-low overflow-hidden text-left transition-all hover:border-primary/30 hover:ring-1 hover:ring-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
				onclick={() => openLightbox(i)}
			>
				<div class="relative aspect-video bg-black/40 overflow-hidden">
					<img
						src={entry.src}
						alt="Debug screenshot for step {entry.stepIndex}"
						loading="lazy"
						class="w-full h-full object-contain transition-transform group-hover:scale-105"
					/>
					<!-- Hover overlay with expand icon -->
					<div class="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
						<span class="material-symbols-outlined text-white/0 group-hover:text-white/90 text-2xl transition-colors">
							zoom_in
						</span>
					</div>
				</div>
				<div class="px-2.5 py-2 flex items-center justify-between">
					<span class="text-[12px] font-medium text-on-surface-variant">Step {entry.stepIndex}</span>
					<span class="text-[11px] text-outline-variant font-mono truncate ml-2">{entry.artifact.fileName}</span>
				</div>
			</button>
		{/each}
	</div>
{/if}

<!-- Lightbox modal -->
{#if selectedIndex !== null && selectedEntry}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_interactive_supports_focus -->
	<div
		class="fixed inset-0 z-50 bg-black/85 flex items-center justify-center"
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
		role="dialog"
		aria-modal="true"
		aria-label="Debug screenshot viewer"
		tabindex="-1"
	>
		<!-- Top bar: step label + close -->
		<div class="absolute top-0 left-0 right-0 flex items-center justify-between px-5 py-4 z-10">
			<div class="flex items-center gap-2">
				<span class="material-symbols-outlined text-sm text-white/70">bug_report</span>
				<span class="text-[14px] font-medium text-white/90">Step {selectedEntry.stepIndex}</span>
				<span class="text-[12px] text-white/50 font-mono ml-2">{selectedEntry.artifact.fileName}</span>
			</div>
			<div class="flex items-center gap-2">
				<span class="text-[12px] text-white/50 tabular-nums">{selectedIndex + 1} / {screenshotArtifacts.length}</span>
				<button
					type="button"
					class="w-8 h-8 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 transition-colors text-white/80 hover:text-white"
					onclick={closeLightbox}
					aria-label="Close lightbox"
				>
					<span class="material-symbols-outlined text-lg">close</span>
				</button>
			</div>
		</div>

		<!-- Navigation arrows -->
		{#if selectedIndex > 0}
			<button
				type="button"
				class="absolute left-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 transition-colors text-white/80 hover:text-white"
				onclick={navigatePrev}
				aria-label="Previous screenshot"
			>
				<span class="material-symbols-outlined text-xl">chevron_left</span>
			</button>
		{/if}
		{#if selectedIndex < screenshotArtifacts.length - 1}
			<button
				type="button"
				class="absolute right-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 transition-colors text-white/80 hover:text-white"
				onclick={navigateNext}
				aria-label="Next screenshot"
			>
				<span class="material-symbols-outlined text-xl">chevron_right</span>
			</button>
		{/if}

		<!-- Full-size image -->
		<img
			src={selectedEntry.src}
			alt="Debug screenshot for step {selectedEntry.stepIndex}"
			class="max-w-[90vw] max-h-[85vh] object-contain rounded-md"
		/>
	</div>
{/if}
