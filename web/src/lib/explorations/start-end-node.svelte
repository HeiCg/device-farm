<!--
  Phase 35 Plan 35-05 — Start / End marker node.

  Port of `_reference/app-explorer/frontend/src/components/StartEndNode.tsx`
  (the reference file ships a minimal component shared by the two synthetic
  marker positions; we collapse it into a single Svelte component with a
  `nodeKind` discriminator on the data prop).

  Variants:
    - nodeKind === 'start'  → green pill with the app name
    - nodeKind === 'end'    → gray pill with the terminal screen title
-->
<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';

  interface StartEndData {
    label: string;
    nodeKind: 'start' | 'end';
  }

  let { data }: { data: StartEndData } = $props();

  const isStart = $derived(data.nodeKind === 'start');
</script>

<div
  class="atlas-marker"
  class:atlas-marker--start={isStart}
  class:atlas-marker--end={!isStart}
>
  {#if !isStart}
    <Handle type="target" position={Position.Top} class="atlas-marker-handle" />
  {/if}
  <span class="atlas-marker-label">{data.label}</span>
  {#if isStart}
    <Handle type="source" position={Position.Bottom} class="atlas-marker-handle" />
  {/if}
</div>

<style>
  .atlas-marker {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 8px 14px;
    border-radius: 999px;
    font-size: 11px;
    font-family: 'JetBrains Mono', monospace;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    border: 1px solid;
    min-width: 120px;
    text-align: center;
  }
  .atlas-marker--start {
    background: rgb(16 185 129 / 0.12);
    border-color: rgb(16 185 129 / 0.5);
    color: rgb(110 231 183);
  }
  .atlas-marker--end {
    background: rgb(156 163 175 / 0.1);
    border-color: rgb(156 163 175 / 0.4);
    color: rgb(209 213 219);
  }
  :global(.atlas-marker-handle) {
    opacity: 0;
  }
  .atlas-marker-label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 130px;
  }
</style>
