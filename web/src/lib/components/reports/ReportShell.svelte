<script lang="ts">
  import type { ReportBundle } from '$lib/api/types.js';
  import ReportHeader from './ReportHeader.svelte';
  import FlowStepTree from './FlowStepTree.svelte';
  import StepDetail from './StepDetail.svelte';
  import SyncVideoPlayer from './SyncVideoPlayer.svelte';
  import HistoryStrip from './HistoryStrip.svelte';
  import ShareLinkDialog from './ShareLinkDialog.svelte';
  import { mintShareToken } from '$lib/api/reports.js';
  import { onMount } from 'svelte';

  let { bundle }: { bundle: ReportBundle } = $props();

  const MIN_TREE = 200;
  const MAX_TREE = 640;
  const STORAGE_KEY = 'reportShell.treeWidth';

  let activeStepId = $state<string | null>(bundle.failureFocus?.stepId ?? bundle.steps[0]?.id ?? null);
  let shareOpen = $state(false);
  let videoHandle = $state<{ seekTo: (ms: number) => void } | null>(null);
  let treeWidth = $state(280);
  let dragging = $state(false);
  let dragStartX = 0;
  let dragStartWidth = 0;

  onMount(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const n = parseInt(saved, 10);
        if (Number.isFinite(n) && n >= MIN_TREE && n <= MAX_TREE) treeWidth = n;
      }
    }
  });

  let activeStep = $derived(bundle.steps.find((s) => s.id === activeStepId) ?? null);
  let video = $derived(bundle.artifacts.find((a) => a.type === 'video') ?? null);
  let markersMs = $derived(
    bundle.steps.map((s) => s.videoOffsetMs).filter((m): m is number => m != null),
  );
  let hasHistory = $derived(!!bundle.history && bundle.history.runs.length > 0);
  let hasRightPane = $derived(!!video || hasHistory);

  let gridStyle = $derived(
    hasRightPane
      ? `grid-template-columns: ${treeWidth}px 4px minmax(0, 1fr) 420px;`
      : `grid-template-columns: ${treeWidth}px 4px minmax(0, 1fr);`,
  );

  function jumpToVideo(offsetMs: number) {
    videoHandle?.seekTo(offsetMs);
  }

  function onPointerDown(e: PointerEvent) {
    dragging = true;
    dragStartX = e.clientX;
    dragStartWidth = treeWidth;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const delta = e.clientX - dragStartX;
    const next = Math.min(MAX_TREE, Math.max(MIN_TREE, dragStartWidth + delta));
    treeWidth = next;
  }

  function onPointerUp(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, String(treeWidth));
    }
  }
</script>

<ReportHeader
  job={bundle.job}
  reportLinks={bundle.reportLinks}
  onShareClick={() => (shareOpen = true)}
/>

<div class="hidden xl:grid gap-0" style={gridStyle}>
  <aside class="sticky top-28 self-start max-h-[calc(100vh-9rem)] overflow-y-auto pr-2">
    <FlowStepTree
      steps={bundle.steps}
      {activeStepId}
      onSelect={(id) => (activeStepId = id)}
    />
  </aside>

  <!-- Resize handle -->
  <div
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize step list"
    tabindex="0"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    class="group relative cursor-col-resize select-none"
    class:dragging
  >
    <div
      class="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-outline-variant/20 group-hover:bg-primary/60 transition-colors"
      class:bg-primary={dragging}
    ></div>
  </div>

  <section class="px-4">
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

  {#if hasRightPane}
    <aside class="space-y-4 pl-4">
      {#if video}
        <SyncVideoPlayer
          src={video.downloadUrl}
          {markersMs}
          durationMs={bundle.job.durationMs}
          onRef={(h) => (videoHandle = h)}
        />
      {/if}
      {#if hasHistory}
        <HistoryStrip history={bundle.history} />
      {/if}
    </aside>
  {/if}
</div>

<!-- Mobile fallback: stacked -->
<div class="xl:hidden space-y-4">
  <FlowStepTree
    steps={bundle.steps}
    {activeStepId}
    onSelect={(id) => (activeStepId = id)}
  />
  {#if activeStep}
    <StepDetail
      step={activeStep}
      logTailLines={bundle.failureFocus?.stepId === activeStep.id ? bundle.failureFocus.logTailLines : []}
      onJumpToVideo={jumpToVideo}
    />
  {/if}
  {#if video}
    <SyncVideoPlayer
      src={video.downloadUrl}
      {markersMs}
      durationMs={bundle.job.durationMs}
      onRef={(h) => (videoHandle = h)}
    />
  {/if}
  {#if hasHistory}
    <HistoryStrip history={bundle.history} />
  {/if}
</div>

<ShareLinkDialog
  jobId={bundle.job.id}
  open={shareOpen}
  mintFn={mintShareToken}
  onClose={() => (shareOpen = false)}
/>
