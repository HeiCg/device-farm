<script lang="ts">
  import type { ReportBundle } from '$lib/api/types.js';
  import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
  import DownloadMenu from './DownloadMenu.svelte';

  let { job, reportLinks, onShareClick }: {
    job: ReportBundle['job'];
    reportLinks: ReportBundle['reportLinks'];
    onShareClick: () => void;
  } = $props();

  function fmtDuration(ms: number | null): string {
    if (ms == null) return '—';
    const s = Math.floor(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  function fmtDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString();
  }
</script>

<header class="sticky top-16 z-20 bg-background border-b border-outline-variant/10 pb-3 pt-4 mb-4">
  <div class="flex items-center gap-3 mb-2">
    <StatusBadge status={job.status} />
    <h1 class="text-[18px] font-semibold font-mono">{job.id.slice(0, 8)}</h1>
    <span class="text-[13px] text-on-surface-variant capitalize">{job.status}</span>
    <div class="ml-auto flex items-center gap-2">
      <button
        type="button"
        onclick={onShareClick}
        class="rounded border border-outline-variant/30 px-3 py-1.5 text-[12px] font-medium hover:bg-surface-variant/30"
      >
        Share
      </button>
      <DownloadMenu junitXml={reportLinks.junitXml} logsRaw={reportLinks.logsRaw} />
    </div>
  </div>

  <!-- Device + run chips -->
  <div class="flex items-center gap-2 flex-wrap text-[12px]">
    <span class="inline-flex items-center gap-1 rounded-full bg-surface-variant/40 px-2.5 py-1">
      <span class="material-symbols-outlined text-[14px]">smartphone</span>
      {job.platform === 'android' ? 'Android' : job.platform === 'ios' ? 'iOS' : job.platform}
    </span>
    {#if job.deviceId}
      <span class="inline-flex items-center gap-1 rounded-full bg-surface-variant/40 px-2.5 py-1">
        <span class="material-symbols-outlined text-[14px]">memory</span>
        <span class="font-mono">{job.deviceId.slice(0, 8)}</span>
      </span>
    {/if}
    <span class="inline-flex items-center gap-1 rounded-full bg-surface-variant/40 px-2.5 py-1">
      <span class="material-symbols-outlined text-[14px]">schedule</span>
      {fmtDuration(job.durationMs)}
    </span>
    {#if job.finishedAt}
      <span class="inline-flex items-center gap-1 rounded-full bg-surface-variant/40 px-2.5 py-1">
        <span class="material-symbols-outlined text-[14px]">event</span>
        {fmtDate(job.finishedAt)}
      </span>
    {/if}
    <span class="ml-auto text-on-surface-variant">
      <span class="text-primary">{job.summary.passed}</span> passed ·
      <span class="text-tertiary">{job.summary.failed}</span> failed ·
      <span class="text-on-surface-variant">{job.summary.skipped}</span> skipped ·
      {job.summary.total} total
    </span>
  </div>
</header>
