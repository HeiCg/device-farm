<script lang="ts">
  import { fmtOffset } from './failure-focus-logic.js';

  let { error, logTailLines, videoOffsetMs, onJumpToVideo }: {
    error: string;
    logTailLines: string[];
    videoOffsetMs: number | null;
    onJumpToVideo?: (offsetMs: number) => void;
  } = $props();
</script>

<div class="rounded-lg border border-tertiary/30 bg-tertiary/5 p-4">
  <div class="flex items-center gap-2 mb-2 text-tertiary">
    <span class="material-symbols-outlined">error</span>
    <span class="font-semibold text-[14px]">FAILURE</span>
  </div>
  <pre class="text-[12px] font-mono whitespace-pre-wrap text-on-surface mb-3">{error}</pre>

  <button
    type="button"
    class="inline-flex items-center gap-1 rounded bg-primary text-on-primary px-3 py-1.5 text-[12px] font-medium disabled:opacity-40 disabled:cursor-not-allowed"
    disabled={videoOffsetMs == null}
    title={videoOffsetMs == null ? 'Sync unavailable for this run' : ''}
    onclick={() => onJumpToVideo && videoOffsetMs != null && onJumpToVideo(videoOffsetMs)}
  >
    <span class="material-symbols-outlined text-[16px]">play_arrow</span>
    Jump to video {videoOffsetMs != null ? `at ${fmtOffset(videoOffsetMs)}` : ''}
  </button>

  {#if logTailLines.length > 0}
    <div class="mt-3 pt-3 border-t border-tertiary/20">
      <div class="text-[11px] uppercase tracking-wide text-on-surface-variant mb-1">Log tail</div>
      <pre class="text-[12px] font-mono whitespace-pre-wrap text-on-surface">{logTailLines.join('\n')}</pre>
    </div>
  {/if}
</div>
