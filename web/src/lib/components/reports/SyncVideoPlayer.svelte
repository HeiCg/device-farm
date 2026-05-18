<script lang="ts">
  import { markerPositionsPercent } from './sync-video-logic.js';

  let { src, markersMs, durationMs, onRef }: {
    src: string;
    markersMs: number[];
    durationMs: number | null;
    onRef?: (h: { seekTo: (ms: number) => void }) => void;
  } = $props();

  let videoEl: HTMLVideoElement | undefined = $state(undefined);

  let markerPercents = $derived(markerPositionsPercent(markersMs, durationMs));

  $effect(() => {
    if (videoEl && onRef) {
      onRef({ seekTo: (ms: number) => { videoEl!.currentTime = ms / 1000; } });
    }
  });
</script>

<div class="relative">
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={videoEl} {src} controls class="w-full rounded border border-outline-variant/20"></video>

  {#if markerPercents.length > 0}
    <div class="relative h-2 mt-1 bg-surface-variant/30 rounded">
      {#each markerPercents as pct}
        <span
          class="absolute top-0 bottom-0 w-[2px] bg-primary"
          style="left: {pct}%"
        ></span>
      {/each}
    </div>
  {/if}
</div>
