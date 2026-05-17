<!--
  Phase 37 Plan 37-02 — PreflightChecklist component.

  Renders a PreflightReport with:
    - Status banner (red/yellow/green per status)
    - Rules version stamp in header (Pitfall 6 — operators MUST see the rule
      pack date so they know when the preflight was last updated)
    - Blockers grouped at top with rule_id + message + remediation
    - Warnings below

  Receives `report: PreflightReport` (see server/preflight/schemas.ts).
-->
<script lang="ts">
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

  let { report }: { report: Report } = $props();

  const statusLabel = $derived(
    report.status === 'blocked'
      ? 'Blocked — must fix before submission'
      : report.status === 'pass_with_warnings'
        ? 'Pass with warnings'
        : 'Pass',
  );

  const statusClass = $derived(
    report.status === 'blocked'
      ? 'bg-red-100 text-red-900 border-red-300'
      : report.status === 'pass_with_warnings'
        ? 'bg-yellow-100 text-yellow-900 border-yellow-300'
        : 'bg-green-100 text-green-900 border-green-300',
  );
</script>

<div class="mt-6 space-y-4">
  <header class="rounded-lg border px-4 py-3 {statusClass}">
    <div class="flex items-center justify-between">
      <div>
        <p class="text-sm font-semibold uppercase tracking-wide">Status</p>
        <p class="text-lg font-bold">{statusLabel}</p>
      </div>
      <div class="text-right text-xs">
        <p>Platform: <span class="font-mono">{report.platform}</span></p>
        <p>Rules updated: <span class="font-mono">{report.rules_version}</span></p>
      </div>
    </div>
  </header>

  {#if report.blockers.length > 0}
    <section>
      <h2 class="mb-2 text-base font-semibold text-red-800">
        Blockers ({report.blockers.length})
      </h2>
      <ul class="space-y-2">
        {#each report.blockers as b (b.rule_id)}
          <li class="rounded-md border border-red-200 bg-red-50 p-3">
            <p class="font-mono text-xs text-red-700">{b.rule_id}</p>
            <p class="mt-1 text-sm text-red-900">{b.message}</p>
            {#if b.remediation}
              <p class="mt-2 text-xs text-red-700"><strong>Fix:</strong> {b.remediation}</p>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if report.warnings.length > 0}
    <section>
      <h2 class="mb-2 text-base font-semibold text-yellow-800">
        Warnings ({report.warnings.length})
      </h2>
      <ul class="space-y-2">
        {#each report.warnings as w (w.rule_id)}
          <li class="rounded-md border border-yellow-200 bg-yellow-50 p-3">
            <p class="font-mono text-xs text-yellow-700">{w.rule_id}</p>
            <p class="mt-1 text-sm text-yellow-900">{w.message}</p>
            {#if w.remediation}
              <p class="mt-2 text-xs text-yellow-700"><strong>Fix:</strong> {w.remediation}</p>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if report.blockers.length === 0 && report.warnings.length === 0}
    <p class="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">
      No issues detected. Ready to submit.
    </p>
  {/if}
</div>
