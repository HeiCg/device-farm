<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { apiFetch } from '$lib/api/client.js';
	import type { Job, JobStep, Artifact } from '$lib/api/types.js';
	import { extractMaestroOptions } from '$lib/api/types.js';
	import { createJobStream } from '$lib/ws/job-stream.svelte.js';
	import DevicePreview from '$lib/components/devices/DevicePreview.svelte';
	import LogViewer from '$lib/components/jobs/LogViewer.svelte';
	import StepList from '$lib/components/jobs/StepList.svelte';
	import VideoPlayer from '$lib/components/jobs/VideoPlayer.svelte';
	import MetricsPanel from '$lib/components/jobs/MetricsPanel.svelte';
	import MaestroOptionsPanel from '$lib/components/jobs/MaestroOptionsPanel.svelte';
	import DebugArtifacts from '$lib/components/jobs/DebugArtifacts.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';

	const TERMINAL_STATUSES = new Set(['passed', 'failed', 'cancelled', 'timeout']);

	let jobId = $derived(page.params.id as string);

	interface FlakyFlow {
		flowName: string;
		totalRuns: number;
		passCount: number;
		failCount: number;
		passRate: number;
	}

	let job = $state<Job | null>(null);
	let jobSteps = $state<JobStep[]>([]);
	let artifacts = $state<Artifact[]>([]);
	let restLogs = $state<string[]>([]);
	let flakyMap = $state<Map<string, number>>(new Map());
	let loading = $state(true);
	let error = $state<string | null>(null);
	let activeTab = $state<'logs' | 'steps' | 'preview' | 'debug'>('logs');

	let stream = $state<ReturnType<typeof createJobStream> | null>(null);

	let isRunning = $derived(job?.status === 'running');
	let isTerminal = $derived(job ? TERMINAL_STATUSES.has(job.status) : false);
	let videoArtifact = $derived(artifacts.find((a) => a.type === 'video') ?? null);

	let maestroOptions = $derived(extractMaestroOptions(job?.metadata ?? null));
	let hasScreenshots = $derived(artifacts.some((a) => a.type === 'screenshot'));

	async function fetchJob() {
		const data = await apiFetch<Job & { steps?: JobStep[] }>(`/jobs/${jobId}`);
		job = data;
		if (data.steps) {
			jobSteps = data.steps;
		}
	}

	async function fetchArtifacts() {
		try {
			artifacts = await apiFetch<Artifact[]>(`/jobs/${jobId}/artifacts`);
		} catch {
			artifacts = [];
		}
	}

	async function fetchLogs() {
		try {
			const data = await apiFetch<{ logs: string }>(`/jobs/${jobId}/logs`);
			restLogs = data.logs ? data.logs.split('\n') : [];
		} catch {
			restLogs = [];
		}
	}

	async function fetchFlaky() {
		try {
			const data = await apiFetch<FlakyFlow[]>('/flows/flaky?window=10');
			const map = new Map<string, number>();
			for (const f of data) {
				map.set(f.flowName, f.passRate);
			}
			flakyMap = map;
		} catch {
			flakyMap = new Map();
		}
	}

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleString();
	}

	function formatDuration(job: Job): string {
		if (!job.startedAt) return '--';
		const start = new Date(job.startedAt).getTime();
		const end = job.finishedAt ? new Date(job.finishedAt).getTime() : Date.now();
		const seconds = Math.floor((end - start) / 1000);
		if (seconds < 60) return `${seconds}s`;
		return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
	}

	$effect(() => {
		if (stream?.status && TERMINAL_STATUSES.has(stream.status)) {
			fetchJob();
			fetchArtifacts();
			fetchLogs();
		}
	});

	onMount(() => {
		(async () => {
			try {
				await fetchJob();
				await fetchArtifacts();
				fetchFlaky();

				if (job && job.status === 'running') {
					stream = createJobStream(jobId);
					stream.connect();
				} else if (job && TERMINAL_STATUSES.has(job.status)) {
					await fetchLogs();
				}
			} catch (e) {
				error = e instanceof Error ? e.message : 'Failed to load job';
			} finally {
				loading = false;
			}
		})();

		return () => {
			stream?.disconnect();
		};
	});
</script>

{#if loading}
	<div class="flex items-center justify-center py-20">
		<div class="text-[13px] text-on-surface-variant">Loading...</div>
	</div>
{:else if error}
	<div class="rounded-lg border border-tertiary/20 bg-tertiary/10 px-4 py-3 text-[13px] text-tertiary">
		{error}
	</div>
{:else if job}
	<!-- Header -->
	<div class="pb-4 border-b border-outline-variant/10 mb-6">
		<div class="flex items-center gap-3 mb-2">
			<StatusBadge status={job.status} size={22} />
			<h1 class="text-[20px] font-semibold text-on-surface font-headline font-mono">{job.id.slice(0, 8)}</h1>
			<span class="text-[13px] text-on-surface-variant capitalize">{job.status}</span>
		</div>
		<div class="flex items-center gap-5 text-[12px] text-on-surface-variant">
			<span class="inline-flex items-center gap-1.5">
				<span class="material-symbols-outlined text-sm text-primary">smartphone</span>
				{job.platform === 'android' ? 'Android' : job.platform === 'ios' ? 'iOS' : job.platform}
			</span>
			<span class="inline-flex items-center gap-1.5">
				<span class="material-symbols-outlined text-sm text-primary">schedule</span>
				{formatDuration(job)}
			</span>
			<span>Created {formatDate(job.createdAt)}</span>
			{#if job.deviceId}
				<span class="inline-flex items-center gap-1.5">
					<span class="material-symbols-outlined text-sm text-primary">memory</span>
					<span class="font-mono">{job.deviceId.slice(0, 8)}</span>
				</span>
			{/if}
		</div>
	</div>

	<!-- Maestro Options (renders nothing when metadata has no Maestro keys) -->
	<MaestroOptionsPanel options={maestroOptions} />

	<!-- Tabs -->
	<div class="flex items-center gap-0 border-b border-outline-variant/10 mb-6">
		{#if activeTab === 'logs'}
			<button class="px-4 py-2 text-[13px] font-medium transition-colors border-b-2 -mb-px text-on-surface border-primary"
				onclick={() => (activeTab = 'logs')}>Logs</button>
		{:else}
			<button class="px-4 py-2 text-[13px] font-medium transition-colors border-b-2 -mb-px text-on-surface-variant border-transparent hover:text-on-surface hover:border-outline-variant/20"
				onclick={() => (activeTab = 'logs')}>Logs</button>
		{/if}
		{#if activeTab === 'steps'}
			<button class="px-4 py-2 text-[13px] font-medium transition-colors border-b-2 -mb-px text-on-surface border-primary"
				onclick={() => (activeTab = 'steps')}>Steps</button>
		{:else}
			<button class="px-4 py-2 text-[13px] font-medium transition-colors border-b-2 -mb-px text-on-surface-variant border-transparent hover:text-on-surface hover:border-outline-variant/20"
				onclick={() => (activeTab = 'steps')}>Steps</button>
		{/if}
		{#if (isRunning && job.deviceId) || (isTerminal && videoArtifact)}
			{#if activeTab === 'preview'}
				<button class="px-4 py-2 text-[13px] font-medium transition-colors border-b-2 -mb-px text-on-surface border-primary"
					onclick={() => (activeTab = 'preview')}>{isRunning ? 'Live Preview' : 'Recording'}</button>
			{:else}
				<button class="px-4 py-2 text-[13px] font-medium transition-colors border-b-2 -mb-px text-on-surface-variant border-transparent hover:text-on-surface hover:border-outline-variant/20"
					onclick={() => (activeTab = 'preview')}>{isRunning ? 'Live Preview' : 'Recording'}</button>
			{/if}
		{/if}
		{#if hasScreenshots}
			{#if activeTab === 'debug'}
				<button class="px-4 py-2 text-[13px] font-medium transition-colors border-b-2 -mb-px text-on-surface border-primary inline-flex items-center gap-1.5"
					onclick={() => (activeTab = 'debug')}>
					<span class="material-symbols-outlined text-sm">bug_report</span>
					Debug
				</button>
			{:else}
				<button class="px-4 py-2 text-[13px] font-medium transition-colors border-b-2 -mb-px text-on-surface-variant border-transparent hover:text-on-surface hover:border-outline-variant/20 inline-flex items-center gap-1.5"
					onclick={() => (activeTab = 'debug')}>
					<span class="material-symbols-outlined text-sm">bug_report</span>
					Debug
				</button>
			{/if}
		{/if}
	</div>

	<!-- Tab content -->
	{#if activeTab === 'logs'}
		<div class="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-5">
			<!-- Steps sidebar -->
			<div class="hidden xl:block">
				{#if isRunning && stream}
					<StepList steps={stream.steps} {flakyMap} />
				{:else}
					<StepList steps={jobSteps.map((s) => ({
						flowName: s.flowName,
						command: s.command,
						status: s.status,
						durationMs: s.durationMs
					}))} {flakyMap} />
				{/if}

				{#if isRunning && stream}
					<div class="mt-4">
						<MetricsPanel metrics={stream.metrics} />
					</div>
				{/if}
			</div>

			<!-- Log viewer -->
			<div>
				{#if isRunning && stream}
					<LogViewer logs={stream.logs} />
				{:else}
					<LogViewer logs={restLogs.map((line) => ({ line, stream: 'stdout' as const }))} />
				{/if}
			</div>
		</div>
	{:else if activeTab === 'steps'}
		<div class="max-w-3xl">
			{#if isRunning && stream}
				<StepList steps={stream.steps} {flakyMap} />
			{:else}
				<StepList steps={jobSteps.map((s) => ({
					flowName: s.flowName,
					command: s.command,
					status: s.status,
					durationMs: s.durationMs
				}))} {flakyMap} />
			{/if}
		</div>
	{:else if activeTab === 'preview'}
		<div class="max-w-lg mx-auto">
			{#if isRunning && job.deviceId}
				<DevicePreview deviceId={job.deviceId} />
			{:else if isTerminal && videoArtifact}
				<VideoPlayer jobId={job.id} artifactId={videoArtifact.id} />
			{/if}
		</div>
	{:else if activeTab === 'debug'}
		<DebugArtifacts jobId={job.id} {artifacts} />
	{/if}
{/if}
