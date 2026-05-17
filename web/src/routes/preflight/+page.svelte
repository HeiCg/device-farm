<!--
  Phase 37 Plan 37-02 — Preflight UI.

  Drag-drop .ipa or .apk → POST /api/preflight → render checklist.
-->
<script lang="ts">
  import PreflightChecklist from '$lib/components/PreflightChecklist.svelte';

  interface Finding {
    rule_id: string;
    message: string;
    severity?: 'blocker' | 'warning';
    remediation?: string;
  }
  interface Report {
    status: 'pass' | 'pass_with_warnings' | 'blocked';
    rules_version: string;
    platform: 'ios' | 'android';
    blockers: Finding[];
    warnings: Finding[];
  }

  let report = $state<Report | null>(null);
  let uploading = $state(false);
  let error = $state<string | null>(null);
  let dragOver = $state(false);

  async function uploadFile(file: File) {
    error = null;
    report = null;
    uploading = true;
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/preflight', { method: 'POST', body: form });
      if (!res.ok) {
        const text = await res.text();
        let body: { title?: string } = {};
        try { body = JSON.parse(text); } catch { /* not JSON */ }
        throw new Error(body.title ?? `Upload failed: HTTP ${res.status}`);
      }
      report = (await res.json()) as Report;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Upload failed';
    } finally {
      uploading = false;
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) void uploadFile(file);
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    dragOver = true;
  }

  function onDragLeave() {
    dragOver = false;
  }

  function onFileChange(e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) void uploadFile(file);
  }
</script>

<svelte:head>
  <title>Preflight · Device Farm</title>
</svelte:head>

<div class="container mx-auto max-w-4xl p-6">
  <h1 class="text-2xl font-bold">Preflight</h1>
  <p class="mt-1 text-sm text-gray-600">
    Drop an <code class="font-mono">.ipa</code> or <code class="font-mono">.apk</code>
    to scan against the App Store rule pack.
  </p>

  <div
    role="region"
    aria-label="Drop zone for IPA or APK files"
    ondrop={onDrop}
    ondragover={onDragOver}
    ondragleave={onDragLeave}
    class="mt-6 rounded-lg border-2 border-dashed p-12 text-center transition-colors {dragOver
      ? 'border-blue-500 bg-blue-50'
      : 'border-gray-300 bg-white'}"
  >
    {#if uploading}
      <p class="text-gray-700">Scanning…</p>
    {:else}
      <p class="text-gray-700">Drag IPA or APK here, or</p>
      <label class="mt-3 inline-block cursor-pointer rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
        Choose file
        <input type="file" accept=".ipa,.apk" class="hidden" onchange={onFileChange} />
      </label>
    {/if}
  </div>

  {#if error}
    <p class="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      {error}
    </p>
  {/if}

  {#if report}
    <PreflightChecklist {report} />
  {/if}
</div>
