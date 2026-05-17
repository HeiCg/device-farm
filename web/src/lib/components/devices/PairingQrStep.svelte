<!--
  Phase 36 Plan 36-04 — PairingQrStep.

  Step 2 of the wizard. Renders the QR image (data URL from
  /api/devices/pair/start), the 6-digit fallback PIN, and a 60-second
  countdown ring. When the countdown hits 0, calls onExpire so the
  parent can transition to error state.

  The countdown uses $effect + setInterval(250) to nudge a `now`
  $state value; a $derived expression then computes remaining seconds
  via computeRemainingSec().
-->
<script lang="ts">
  import { onMount } from 'svelte';

  import { computeRemainingSec } from './pairing-wizard-logic.js';

  let {
    qrDataUrl,
    pin,
    expiresAt,
    onCancel,
    onExpire,
  }: {
    qrDataUrl: string;
    pin: string;
    expiresAt: number;
    onCancel: () => void;
    onExpire: () => void;
  } = $props();

  let now = $state(Date.now());
  let expired = $state(false);

  // 60s TTL: $derived chain updates every ~250ms as `now` advances.
  const remainingSec = $derived(computeRemainingSec(expiresAt, now));
  const remainingPct = $derived(Math.max(0, Math.min(1, remainingSec / 60)));
  // SVG ring: stroke-dasharray=2π*r; offset = (1-pct)*dasharray to shrink.
  const ringRadius = 28;
  const ringCirc = $derived(2 * Math.PI * ringRadius);
  const ringOffset = $derived((1 - remainingPct) * ringCirc);

  onMount(() => {
    const id = setInterval(() => {
      now = Date.now();
      if (!expired && remainingSec <= 0) {
        expired = true;
        onExpire();
      }
    }, 250);
    return () => clearInterval(id);
  });
</script>

<div class="flex flex-col gap-4 max-w-xl">
  <h2 class="text-lg font-medium text-on-surface">2. Scan the QR code</h2>
  <p class="text-sm text-on-surface-variant">
    Point your phone's camera at the QR code below. If your phone prompts for
    a PIN instead, enter <span class="font-mono font-bold text-on-surface">{pin}</span>.
  </p>

  <div class="flex items-start gap-6">
    <div class="bg-white p-3 rounded-lg shadow-sm">
      {#if qrDataUrl}
        <img src={qrDataUrl} alt="ADB pairing QR code" class="w-56 h-56 block" />
      {:else}
        <div class="w-56 h-56 flex items-center justify-center text-sm text-gray-500">
          QR unavailable
        </div>
      {/if}
    </div>

    <div class="flex flex-col items-center gap-2">
      <div class="relative w-16 h-16">
        <svg viewBox="0 0 64 64" class="w-full h-full -rotate-90">
          <circle
            cx="32"
            cy="32"
            r={ringRadius}
            fill="none"
            stroke="currentColor"
            stroke-width="4"
            class="text-surface-container-low"
          />
          <circle
            cx="32"
            cy="32"
            r={ringRadius}
            fill="none"
            stroke="currentColor"
            stroke-width="4"
            stroke-dasharray={ringCirc}
            stroke-dashoffset={ringOffset}
            stroke-linecap="round"
            class={remainingSec < 10 ? 'text-tertiary' : 'text-primary'}
            style="transition: stroke-dashoffset 250ms linear;"
          />
        </svg>
        <div class="absolute inset-0 flex items-center justify-center">
          <span
            class="text-sm font-mono font-bold"
            class:text-tertiary={remainingSec < 10}
            class:text-on-surface={remainingSec >= 10}
          >
            {remainingSec}
          </span>
        </div>
      </div>
      <span class="text-[10px] uppercase tracking-widest text-on-surface-variant">Seconds</span>

      <div class="mt-2 flex flex-col items-center">
        <span class="text-[10px] uppercase tracking-widest text-on-surface-variant">PIN</span>
        <span class="text-lg font-mono tracking-widest text-on-surface">{pin}</span>
      </div>
    </div>
  </div>

  <div class="flex items-center gap-3 pt-2">
    <button
      onclick={onCancel}
      class="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-on-surface bg-surface-container-high border border-outline-variant rounded-lg hover:bg-surface-container-highest transition-colors"
    >
      Cancel
    </button>
    <span class="text-xs text-on-surface-variant">
      Waiting for your phone to scan…
    </span>
  </div>
</div>
