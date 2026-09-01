/**
 * Render RESULTS.md from captured data. Pure: takes fully-computed records and
 * emits markdown. Numbers and method only — zero prose conclusions (the RFC
 * narrative is a separate document). A configuration with no live flow is shown
 * with its live fixed context and structural round-trip count, and its per-step /
 * billing cells marked `pending` with the reason footnoted.
 */
import type { ConfigCapture, ConfigMetrics } from './types.js';
import type { AdapterConfig } from '../adapters.js';
import { computeMetrics } from './metrics.js';
import { roundTripCount } from '../adapters.js';

export interface RunMeta {
  counter: string;
  counterApproximate: boolean;
  counterDisclaimer: string | null;
  argentSha: string;
  argentVersion: string;
  /** Fork HEAD (feat/run-script). */
  forkSha?: string;
  forkBranch?: string;
  /** Integration branch HEAD (integration/device-stream). */
  integrationSha?: string;
  integrationBranch?: string;
  /** Original upstream benchmark SHA, before moving the vendor clone to the fork base. */
  upstreamOriginalSha?: string;
  /** The recorded fork-vs-upstream fairness decision (numbers + method). */
  fairnessNote?: string;
  emulatorImage: string;
  iosImage?: string;
  scenarioName: string;
  iosScenarioName?: string;
  generatedAt: string;
  stepCount: number;
}

export interface ConfigReportInput {
  adapter: AdapterConfig;
  capture: ConfigCapture;
}

function metricsFor(input: ConfigReportInput): ConfigMetrics | null {
  if (!input.capture.live || input.capture.calls.length === 0) return null;
  return computeMetrics(input.capture.configId, input.capture.fixed.totalTokens, input.capture.calls, 10);
}

function cell(v: number | null): string {
  return v === null ? 'pending' : String(v);
}

export function renderResults(inputs: ConfigReportInput[], meta: RunMeta): string {
  const lines: string[] = [];
  lines.push('# Token benchmark — results');
  lines.push('');
  lines.push('Layer 1 (mechanical payload capture). No LLM in the loop.');
  lines.push('');

  // --- method / provenance ---
  lines.push('## Method');
  lines.push('');
  lines.push(`- Token counter: \`${meta.counter}\`${meta.counterApproximate ? ' (APPROXIMATE)' : ''}`);
  if (meta.counterDisclaimer) lines.push(`  - ${meta.counterDisclaimer}`);
  lines.push(`- argent upstream: \`${meta.argentVersion}\` @ \`${meta.argentSha}\` (cloned read-only, unmodified)`);
  if (meta.forkSha) lines.push(`- argent fork: \`${meta.forkBranch ?? 'fork'}\` @ \`${meta.forkSha}\` (adds the run-script tool)`);
  if (meta.integrationSha) lines.push(`- argent integration: \`${meta.integrationBranch ?? 'integration/device-stream'}\` @ \`${meta.integrationSha}\` (run-script + rich-selectors + android-system-verbs + open-device-server; both flags default OFF)`);
  if (meta.upstreamOriginalSha) lines.push(`- original upstream benchmark SHA: \`${meta.upstreamOriginalSha}\``);
  if (meta.fairnessNote) lines.push(`- Fork-vs-upstream fairness: ${meta.fairnessNote}`);
  lines.push(`- device-stream: current working tree (WS1–WS5)`);
  lines.push(`- Emulator image: ${meta.emulatorImage}`);
  if (meta.iosImage) lines.push(`- iOS simulator image: ${meta.iosImage}`);
  lines.push(`- Scenario (Android): \`${meta.scenarioName}\` (${meta.stepCount} logical steps)`);
  if (meta.iosScenarioName) lines.push(`- Scenario (iOS): \`${meta.iosScenarioName}\` (${meta.stepCount} logical steps; navigation mirror, see scenario-ios.json)`);
  lines.push(`- Generated: ${meta.generatedAt}`);
  lines.push('- `added_i = requestTokens_i + resultTokens_i` (transcript growth per round-trip).');
  lines.push('- `billedCached = fixed + Σ added_i` (perfect prompt caching — RFC primary).');
  lines.push('- `billedUncached = Σ_t (fixed + Σ_{i≤t} added_i)` (no caching, quadratic bound).');
  lines.push('- Image blocks counted by the Anthropic formula `ceil(w·h/750)` on decoded PNG dimensions, NOT by tokenizing base64. base64 byte size recorded separately.');
  lines.push('');

  // --- comparison tables, one per platform ---
  const comparisonRow = (input: ConfigReportInput): string => {
    const m = metricsFor(input);
    const rt = m ? m.roundTrips : roundTripCount(input.adapter);
    return `| ${input.capture.configId} | ${input.capture.fixed.totalTokens} | ${cell(m?.flowAdded ?? null)} | ${cell(m?.billedCached ?? null)} | ${cell(m?.billedUncached ?? null)} | ${rt}${m ? '' : '*'} | ${input.capture.live ? 'yes' : 'no'} |`;
  };
  const platforms: Array<{ key: 'android' | 'ios'; label: string }> = [
    { key: 'android', label: 'Android' },
    { key: 'ios', label: 'iOS simulator' },
  ];
  for (const p of platforms) {
    const rows = inputs.filter((i) => i.adapter.platform === p.key);
    if (rows.length === 0) continue;
    lines.push(`## Comparison — ${p.label}`);
    lines.push('');
    lines.push('| config | fixed | flowAdded | billedCached | billedUncached | round-trips | live |');
    lines.push('|--------|------:|----------:|-------------:|---------------:|------------:|:----:|');
    for (const input of rows) lines.push(comparisonRow(input));
    lines.push('');
  }
  lines.push('`*` round-trips for a pending config are the structural count from the adapter table (device-independent).');
  lines.push('');

  // --- cross-platform summary table (numbers only; interpretation lives in SUMMARY.md) ---
  lines.push('## Cross-platform summary (fork run-script vs upstream)');
  lines.push('');
  lines.push('| platform | config | variant | fixed | billedCached | billedUncached | round-trips | live |');
  lines.push('|----------|--------|---------|------:|-------------:|---------------:|------------:|:----:|');
  const summaryOrder = ['A1', 'A4', 'F1', 'FX', 'A1-ios', 'A4-ios', 'F2', 'FX-ios'];
  const byId = new Map(inputs.map((i) => [i.capture.configId, i]));
  for (const id of summaryOrder) {
    const input = byId.get(id);
    if (!input) continue;
    const m = metricsFor(input);
    const rt = m ? m.roundTrips : roundTripCount(input.adapter);
    lines.push(
      `| ${input.adapter.platform} | ${id} | ${input.adapter.variant} | ${input.capture.fixed.totalTokens} | ${cell(m?.billedCached ?? null)} | ${cell(m?.billedUncached ?? null)} | ${rt}${m ? '' : '*'} | ${input.capture.live ? 'yes' : 'no'} |`,
    );
  }
  lines.push('');

  // --- per-step (live only) ---
  const liveInputs = inputs.filter((i) => metricsFor(i) !== null);
  if (liveInputs.length > 0) {
    lines.push('## Per-step added tokens (live configurations)');
    lines.push('');
    const header = ['step', ...liveInputs.map((i) => i.capture.configId)];
    lines.push(`| ${header.join(' | ')} |`);
    lines.push(`| ${header.map(() => '---:').join(' | ')} |`);
    for (let s = 0; s < meta.stepCount; s++) {
      const row = [String(s + 1), ...liveInputs.map((i) => String(metricsFor(i)!.perStep[s]))];
      lines.push(`| ${row.join(' | ')} |`);
    }
    lines.push('');
  }

  // --- measured describe sizes ---
  lines.push('## Measured describe sizes (Settings root list)');
  lines.push('');
  lines.push('| config | describe bytes | describe tokens | backend (Source) |');
  lines.push('|--------|---------------:|----------------:|------------------|');
  for (const input of inputs) {
    const d = input.capture.describeSize;
    const src = input.capture.describeSource ?? '';
    lines.push(`| ${input.capture.configId} | ${d ? d.bytes : 'pending'} | ${d ? d.tokens : 'pending'} | ${src} |`);
  }
  lines.push('');

  // --- fixed context breakdown ---
  lines.push('## Fixed-context breakdown');
  lines.push('');
  for (const input of inputs) {
    lines.push(`### ${input.capture.configId} — ${input.adapter.description}`);
    lines.push('');
    lines.push('| artifact | bytes | tokens | note |');
    lines.push('|----------|------:|-------:|------|');
    for (const a of input.capture.fixed.artifacts) {
      lines.push(`| ${a.name} | ${a.bytes} | ${a.tokens} | ${a.note ?? ''} |`);
    }
    lines.push(`| **total** | **${input.capture.fixed.totalBytes}** | **${input.capture.fixed.totalTokens}** | |`);
    lines.push('');
  }

  // --- adapter tables (fairness artifact) ---
  lines.push('## Per-model adapter tables (fairness audit)');
  lines.push('');
  lines.push('Each configuration expands the same 10 logical steps into these round-trips.');
  lines.push('');
  for (const input of inputs) {
    const a = input.adapter;
    lines.push(`### ${a.id} — ${a.description}`);
    lines.push('');
    lines.push(`- fixed context: ${a.fixed}`);
    lines.push(`- auto-screenshot: ${a.autoScreenshot} · auto-describe: ${a.autoDescribe}`);
    lines.push('');
    lines.push('| # | tool | origin | covers steps | note |');
    lines.push('|--:|------|--------|--------------|------|');
    a.plan.forEach((p, i) => {
      lines.push(`| ${i + 1} | ${p.tool} | ${p.origin} | ${p.coversSteps.join(',')} | ${p.note ?? ''} |`);
    });
    lines.push('');
  }

  // --- pending reasons ---
  const pending = inputs.filter((i) => !i.capture.live);
  if (pending.length > 0) {
    lines.push('## Pending live runs');
    lines.push('');
    for (const input of pending) {
      lines.push(`- **${input.capture.configId}**: ${input.capture.pendingReason ?? 'flow not driven against a device'}`);
    }
    lines.push('');
  }

  return lines.join('\n') + '\n';
}
