<!--
  Phase 35 Plan 35-05 — ScreenNode (xyflow custom node).

  Port of `_reference/app-explorer/frontend/src/components/ScreenNode.tsx`
  (~72 LoC React → ~80 LoC Svelte 5). Renders a full-bleed screenshot
  thumbnail with a title above and a colored border that shifts to
  purple `#9D61FF` when the node is selected.

  Data shape (set by `layout-graph.ts`):
    - label: string         (screen title)
    - screenshot: string    (artifact UUID — composed into URL via screenshotBase)
    - elementCount: number  (badge in the corner)
    - platform: string      (unused in render, retained for parity)
    - notes?: string|null   (unused at node level, surfaced in ScreenPanel)
-->
<script lang="ts">
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';

  interface ScreenNodeData extends Record<string, unknown> {
    label: string;
    screenshot: string;
    elementCount: number;
    notes?: string | null;
    platform?: string;
    /**
     * Optional override — when set, `${screenshotBase}/${artifactId}/raw` is
     * used. Defaults to the device-farm artifacts endpoint. The page-level
     * AtlasGraph component passes the base via context (see Plan 35-05
     * note: we keep the URL composition inside the node so xyflow can
     * pass the data prop through unchanged from layoutGraph).
     */
    screenshotBase?: string;
  }

  let { data, selected }: { data: ScreenNodeData; selected?: boolean } =
    $props() as unknown as NodeProps & { data: ScreenNodeData; selected?: boolean };

  let imgLoaded = $state(false);

  const base = $derived(data.screenshotBase ?? '/api/artifacts');
  const src = $derived(`${base}/${data.screenshot}/raw`);
</script>

<div class="atlas-screen-node" class:is-selected={selected}>
  <Handle type="target" position={Position.Top} class="atlas-screen-node-handle" />

  <div class="atlas-screen-node-title">{data.label}</div>

  <div class="atlas-screen-node-frame">
    {#if !imgLoaded}
      <div class="atlas-screen-node-loading" aria-hidden="true"></div>
    {/if}
    <img
      src={src}
      alt={data.label}
      class="atlas-screen-node-img"
      class:loaded={imgLoaded}
      loading="lazy"
      draggable="false"
      onload={() => (imgLoaded = true)}
    />
    <div class="atlas-screen-node-badge">
      {data.elementCount} el
    </div>
  </div>

  <Handle type="source" position={Position.Bottom} class="atlas-screen-node-handle" />
</div>

<style>
  .atlas-screen-node {
    display: flex;
    flex-direction: column;
    align-items: center;
    cursor: pointer;
    width: 175px;
  }
  .atlas-screen-node-title {
    font-size: 11px;
    font-weight: 600;
    text-align: center;
    margin-bottom: 6px;
    line-height: 1.2;
    word-break: break-word;
    max-width: 180px;
    color: rgb(243 244 246);
  }
  .atlas-screen-node-frame {
    position: relative;
    border: 3px solid rgb(59 130 246);
    background: rgb(59 130 246 / 0.1);
    padding: 4px;
    height: 300px;
    width: 100%;
    box-sizing: border-box;
    transition: border-color 0.2s, background 0.2s;
  }
  .atlas-screen-node.is-selected .atlas-screen-node-frame {
    border-color: rgb(157 97 255);
    background: rgb(157 97 255 / 0.1);
  }
  .atlas-screen-node-img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: rgb(0 0 0);
    opacity: 0;
    transition: opacity 0.3s;
  }
  .atlas-screen-node-img.loaded {
    opacity: 1;
  }
  .atlas-screen-node-loading {
    position: absolute;
    inset: 4px;
    background: linear-gradient(
      90deg,
      rgb(31 41 55) 0%,
      rgb(55 65 81) 50%,
      rgb(31 41 55) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.4s ease-in-out infinite;
  }
  .atlas-screen-node-badge {
    position: absolute;
    top: 8px;
    right: 8px;
    background: rgb(0 0 0 / 0.6);
    color: rgb(229 231 235);
    font-size: 9px;
    font-family: 'JetBrains Mono', monospace;
    padding: 2px 5px;
    border-radius: 2px;
  }
  :global(.atlas-screen-node-handle) {
    opacity: 0 !important;
    width: 12px !important;
    height: 12px !important;
  }
  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
</style>
