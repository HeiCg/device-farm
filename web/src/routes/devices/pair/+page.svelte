<!--
  Phase 36 / Plan 36-04 — /devices/pair route entry (PAIR-WIZARD-UI).

  Renders the 3-step PairingWizard. All state + WS lifecycle live inside
  the wizard component; this page just provides the page chrome.
-->
<script lang="ts">
  import PairingWizard from '$lib/components/devices/PairingWizard.svelte';
</script>

<svelte:head>
  <title>Pair Device · Device Farm</title>
</svelte:head>

<div class="max-w-4xl mx-auto p-6">
  <h1 class="text-2xl font-semibold mb-2 text-on-surface">Pair Device</h1>
  <p class="text-sm text-on-surface-variant mb-6">
    Wirelessly pair an Android phone (Android 11+) over your local Wi-Fi.
  </p>

  <PairingWizard />
</div>
