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
</script>

<header class="sticky top-16 z-20 bg-background border-b border-outline-variant/10 pb-3 pt-4 mb-4">
  <div class="flex items-center gap-3 mb-1">
    <StatusBadge status={job.status} />
    <h1 class="text-[18px] font-semibold font-mono">{job.id.slice(0, 8)}</h1>
    <span class="text-[13px] text-on-surface-variant capitalize">{job.status}</span>
    <span class="text-[12px] text-on-surface-variant">· {job.platform} · {fmtDuration(job.durationMs)}</span>
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
  <div class="text-[12px] text-on-surface-variant">
    {job.summary.passed} passed · {job.summary.failed} failed · {job.summary.skipped} skipped · {job.summary.total} total
  </div>
</header>
