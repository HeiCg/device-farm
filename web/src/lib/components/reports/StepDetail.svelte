<script lang="ts">
  import type { ReportStepLite } from '$lib/api/types.js';
  import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
  import FailureFocusPanel from './FailureFocusPanel.svelte';

  let { step, logTailLines, onJumpToVideo }: {
    step: ReportStepLite;
    logTailLines?: string[];
    onJumpToVideo?: (offsetMs: number) => void;
  } = $props();

  function fmtDuration(ms: number | null): string {
    if (ms == null) return '—';
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  }

  function fmtTime(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString();
  }
</script>

<div class="space-y-4">
  <div class="flex items-center gap-3">
    <StatusBadge status={step.status} />
    <code class="font-mono text-[15px] text-on-surface">{step.command ?? step.flowName}</code>
    <span class="text-[12px] text-on-surface-variant">· {fmtDuration(step.durationMs)}</span>
  </div>

  <div class="text-[12px] text-on-surface-variant">
    Started {fmtTime(step.startedAt)} · ended {fmtTime(step.finishedAt)}
  </div>

  {#if step.screenshotPath}
    <img src={step.screenshotPath} alt="Step screenshot" class="rounded border border-outline-variant/20 max-w-full" />
  {:else}
    <div data-testid="screenshot-placeholder" class="aspect-[9/16] max-w-xs bg-surface-variant/30 rounded flex items-center justify-center text-on-surface-variant text-[12px]">
      <span class="material-symbols-outlined">broken_image</span>
    </div>
  {/if}

  {#if step.status === 'failed' && step.error}
    <FailureFocusPanel
      error={step.error}
      logTailLines={logTailLines ?? []}
      videoOffsetMs={step.videoOffsetMs}
      {onJumpToVideo}
    />
  {/if}
</div>
