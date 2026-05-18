<script lang="ts">
  import type { ReportBundle } from '$lib/api/types.js';
  import ReportHeader from './ReportHeader.svelte';
  import FlowStepTree from './FlowStepTree.svelte';
  import StepDetail from './StepDetail.svelte';
  import SyncVideoPlayer from './SyncVideoPlayer.svelte';
  import HistoryStrip from './HistoryStrip.svelte';
  import ShareLinkDialog from './ShareLinkDialog.svelte';
  import { mintShareToken } from '$lib/api/reports.js';

  let { bundle }: { bundle: ReportBundle } = $props();

  let activeStepId = $state<string | null>(bundle.failureFocus?.stepId ?? bundle.steps[0]?.id ?? null);
  let shareOpen = $state(false);
  let videoHandle = $state<{ seekTo: (ms: number) => void } | null>(null);

  let activeStep = $derived(bundle.steps.find((s) => s.id === activeStepId) ?? null);
  let video = $derived(bundle.artifacts.find((a) => a.type === 'video') ?? null);
  let markersMs = $derived(
    bundle.steps.map((s) => s.videoOffsetMs).filter((m): m is number => m != null),
  );

  function jumpToVideo(offsetMs: number) {
    videoHandle?.seekTo(offsetMs);
  }
</script>

<ReportHeader
  job={bundle.job}
  reportLinks={bundle.reportLinks}
  onShareClick={() => (shareOpen = true)}
/>

<div class="grid grid-cols-1 xl:grid-cols-[240px_1fr_360px] gap-5">
  <aside class="hidden xl:block sticky top-44 self-start max-h-[calc(100vh-12rem)] overflow-y-auto pr-2">
    <FlowStepTree
      steps={bundle.steps}
      {activeStepId}
      onSelect={(id) => (activeStepId = id)}
    />
  </aside>

  <section>
    {#if activeStep}
      <StepDetail
        step={activeStep}
        logTailLines={bundle.failureFocus?.stepId === activeStep.id ? bundle.failureFocus.logTailLines : []}
        onJumpToVideo={jumpToVideo}
      />
    {:else}
      <div class="text-[13px] text-on-surface-variant">No steps</div>
    {/if}
  </section>

  <aside class="hidden xl:block space-y-4">
    {#if video}
      <SyncVideoPlayer
        src={video.downloadUrl}
        {markersMs}
        durationMs={bundle.job.durationMs}
        onRef={(h) => (videoHandle = h)}
      />
    {/if}
    <HistoryStrip history={bundle.history} />
  </aside>
</div>

<ShareLinkDialog
  jobId={bundle.job.id}
  open={shareOpen}
  mintFn={mintShareToken}
  onClose={() => (shareOpen = false)}
/>
