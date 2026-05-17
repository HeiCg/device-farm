<script lang="ts">
	import type { Job } from '$lib/api/types.js';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import { formatRelativeTime, formatDuration, platformLabel } from '$lib/utils/format.js';

	const borderStyles: Record<string, string> = {
		passed: 'border-secondary',
		failed: 'border-tertiary',
		running: 'border-primary',
		queued: 'border-outline',
		cancelled: 'border-outline',
		timeout: 'border-tertiary',
		error: 'border-tertiary',
	};

	let { job }: { job: Job } = $props();

	let borderClass = $derived(borderStyles[job.status] ?? 'border-outline');
</script>

<a
	href="/jobs/{job.id}"
	class="block bg-surface-container-low rounded-lg border-l-2 p-4 hover:bg-surface-container transition-colors {borderClass}"
>
	<div class="flex items-center gap-2 mb-3">
		<StatusBadge status={job.status} />
		<span class="font-mono text-sm text-on-surface">{job.id.slice(0, 8)}</span>
	</div>

	<div class="flex items-center gap-4 text-on-surface-variant text-xs mb-3">
		<span class="inline-flex items-center gap-1">
			<span class="material-symbols-outlined text-sm">smartphone</span>
			{platformLabel(job.platform)}
		</span>
		<span class="inline-flex items-center gap-1 tabular-nums">
			<span class="material-symbols-outlined text-sm">schedule</span>
			{formatDuration(job.startedAt, job.finishedAt)}
		</span>
	</div>

	<div class="flex justify-end">
		<span class="text-on-surface-variant text-xs tabular-nums">{formatRelativeTime(job.createdAt)}</span>
	</div>
</a>
