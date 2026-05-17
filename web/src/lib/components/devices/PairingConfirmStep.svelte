<!--
  Phase 36 Plan 36-04 — PairingConfirmStep.

  Step 3 of the wizard. Renders the success message once the WS `done`
  frame arrives. Operator can click "Done" to reset to idle (so they
  can pair another device) or navigate elsewhere.
-->
<script lang="ts">
  let {
    deviceName,
    deviceId,
    onDone,
  }: { deviceName: string; deviceId: string; onDone: () => void } = $props();
</script>

<div class="flex flex-col gap-4 max-w-xl">
  <div class="flex items-center gap-3">
    <span class="material-symbols-outlined text-3xl text-primary">check_circle</span>
    <h2 class="text-lg font-medium text-on-surface">Successfully paired {deviceName || 'device'}</h2>
  </div>

  <p class="text-sm text-on-surface-variant">
    The device is now connected over wireless ADB. It will appear in your
    device list within ~5 seconds (discovery poll) and is ready to receive
    Maestro jobs.
  </p>

  {#if deviceId}
    <div class="text-xs text-on-surface-variant">
      <span class="opacity-70">Device ID:</span>
      <span class="font-mono">{deviceId}</span>
    </div>
  {/if}

  <div class="flex items-center gap-3 pt-2">
    <button
      onclick={onDone}
      class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-on-primary bg-primary rounded-lg hover:bg-primary/90 transition-colors"
    >
      Pair another device
    </button>
    <a
      href="/"
      class="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-on-surface bg-surface-container-high border border-outline-variant rounded-lg hover:bg-surface-container-highest transition-colors"
    >
      Back to dashboard
    </a>
  </div>
</div>
