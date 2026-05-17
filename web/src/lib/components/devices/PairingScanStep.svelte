<!--
  Phase 36 Plan 36-04 — PairingScanStep.

  Step 1 of the wizard. Renders the operator-facing instructions for
  enabling Wireless Debugging on the Android phone and exposes a single
  "Start pairing" button that triggers the parent's startPairing()
  handler (which POSTs /api/devices/pair/start and opens the WS).
-->
<script lang="ts">
  let { onStart, disabled = false }: { onStart: () => void; disabled?: boolean } = $props();
</script>

<div class="flex flex-col gap-4 max-w-xl">
  <h2 class="text-lg font-medium text-on-surface">1. Enable Wireless Debugging</h2>
  <ol class="list-decimal list-inside text-sm text-on-surface-variant space-y-1">
    <li>
      On your Android phone: <strong>Settings → System → Developer Options →
      Wireless debugging</strong> and toggle it <em>on</em>.
    </li>
    <li>Tap <strong>"Pair device with QR code"</strong>. The phone's camera will open.</li>
    <li>Ensure the phone and this machine are on the <strong>same Wi-Fi network</strong> (no VPN, no guest VLAN).</li>
    <li>Click <strong>Start pairing</strong> below — you'll have <em>60 seconds</em> to scan the QR.</li>
  </ol>

  <div class="flex items-center gap-3 pt-2">
    <button
      onclick={onStart}
      {disabled}
      class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-on-primary bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <span class="material-symbols-outlined text-base">qr_code_2</span>
      Start pairing
    </button>
    {#if disabled}
      <span class="text-xs text-on-surface-variant">Starting…</span>
    {/if}
  </div>
</div>
