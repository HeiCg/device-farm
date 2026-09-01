/**
 * Render results/SUMMARY.md (Part C) — the interpreted companion to RESULTS.md.
 *
 * Unlike RESULTS.md (numbers + method only), this document is allowed to draw
 * conclusions: it feeds the upstream PR body. It reads the same computed metrics
 * and states the fork-vs-upstream multipliers per platform, the per-step cost
 * profile, a one-paragraph method, and the honest caveats.
 */
import type { ConfigCapture, ConfigMetrics } from './types.js';
import type { AdapterConfig } from '../adapters.js';
import { computeMetrics } from './metrics.js';
import { roundTripCount } from '../adapters.js';
import type { RunMeta } from './report.js';

export interface SummaryInput {
  adapter: AdapterConfig;
  capture: ConfigCapture;
}

function metricsFor(input: SummaryInput): ConfigMetrics | null {
  if (!input.capture.live || input.capture.calls.length === 0) return null;
  return computeMetrics(input.capture.configId, input.capture.fixed.totalTokens, input.capture.calls, 10);
}

/** `x` formatted as a multiplier, or `—` if either side is missing. */
function mult(numer: number | null, denom: number | null): string {
  if (numer === null || denom === null || denom === 0) return '—';
  return `${(numer / denom).toFixed(2)}×`;
}

export function renderSummary(inputs: SummaryInput[], meta: RunMeta): string {
  const byId = new Map(inputs.map((i) => [i.capture.configId, i]));
  const L: string[] = [];
  const m = (id: string): ConfigMetrics | null => {
    const i = byId.get(id);
    return i ? metricsFor(i) : null;
  };
  const fixedOf = (id: string): number | null => byId.get(id)?.capture.fixed.totalTokens ?? null;
  const cachedOf = (id: string): number | null => m(id)?.billedCached ?? null;
  const uncachedOf = (id: string): number | null => m(id)?.billedUncached ?? null;
  const rtOf = (id: string): number | null => {
    const i = byId.get(id);
    if (!i) return null;
    const mm = metricsFor(i);
    return mm ? mm.roundTrips : roundTripCount(i.adapter);
  };
  const liveOf = (id: string): boolean => byId.get(id)?.capture.live ?? false;
  const num = (v: number | null): string => (v === null ? 'pending' : String(v));

  L.push('# Token benchmark — fork run-script vs upstream argent (summary)');
  L.push('');
  L.push(
    'Interpretation of the Layer-1 mechanical capture in `RESULTS.md`. This document draws the ' +
      'comparisons the raw results file deliberately does not. Numbers are the transcript-token cost of the ' +
      'same 10-step Settings interaction driven three ways on each platform: argent atomic tools per call ' +
      '(A1 / A1-ios), argent `run-sequence` best-case amortization (A4 / A4-ios), and the fork `run-script` ' +
      'tool that collapses the whole flow into one agent-authored call (F1 Android / F2 iOS).',
  );
  L.push('');

  // --- method ---
  L.push('## Method (one paragraph)');
  L.push('');
  L.push(
    'A harness acts as an MCP client, drives each server against a real device, and sizes every byte that ' +
      `would enter a model's context — no LLM in the loop. \`billedCached = fixed + Σ added\` is the ` +
      'perfect-prompt-caching lower bound (it favours the tool-per-call servers); `billedUncached` is the ' +
      'no-caching quadratic upper bound. Tokens are counted with ' +
      `\`${meta.counter}\`${meta.counterApproximate ? ' (an APPROXIMATION — not Claude\'s tokenizer; set ANTHROPIC_API_KEY to recount via the Anthropic count_tokens API)' : ''}. ` +
      'Fork and upstream share base commit a2ed83e0; the upstream `tools/list` is byte-identical at that ' +
      'base and at the original benchmark SHA b835de2, so the pre-existing A-config Android numbers stand ' +
      'unchanged (see RESULTS.md fairness note).',
  );
  L.push('');

  // --- side-by-side tables ---
  const table = (title: string, ids: string[]): void => {
    L.push(`### ${title}`);
    L.push('');
    L.push('| config | what | fixed | billedCached | billedUncached | round-trips | live |');
    L.push('|--------|------|------:|-------------:|---------------:|------------:|:----:|');
    for (const id of ids) {
      const i = byId.get(id);
      if (!i) continue;
      L.push(
        `| ${id} | ${i.adapter.description} | ${num(fixedOf(id))} | ${num(cachedOf(id))} | ${num(uncachedOf(id))} | ${num(rtOf(id))} | ${liveOf(id) ? 'yes' : 'no'} |`,
      );
    }
    L.push('');
  };
  L.push('## Side-by-side');
  L.push('');
  table('Android', ['A1', 'A4', 'F1', 'FX']);
  table('iOS simulator', ['A1-ios', 'A4-ios', 'F2', 'FX-ios']);

  // --- multipliers ---
  L.push('## Multipliers (lower is cheaper for the fork run-script path)');
  L.push('');
  L.push(
    'How many times more transcript tokens the upstream path costs than the fork `run-script` path for the ' +
      'same flow. `>1×` means the fork is cheaper by that factor. `F` = the run-script config on each row ' +
      '(F1/F2 = standalone run-script fork; FX/FX-ios = the integration branch with both flags on).',
  );
  L.push('');
  L.push('| platform | fork config | metric | upstream A1 ÷ F | upstream A4 ÷ F |');
  L.push('|----------|-------------|--------|----------------:|----------------:|');
  const multRows = (platform: string, a1: string, a4: string, f: string): void => {
    L.push(`| ${platform} | ${f} | billedCached | ${mult(cachedOf(a1), cachedOf(f))} | ${mult(cachedOf(a4), cachedOf(f))} |`);
    L.push(`| ${platform} | ${f} | billedUncached | ${mult(uncachedOf(a1), uncachedOf(f))} | ${mult(uncachedOf(a4), uncachedOf(f))} |`);
    L.push(`| ${platform} | ${f} | round-trips | ${mult(rtOf(a1), rtOf(f))} | ${mult(rtOf(a4), rtOf(f))} |`);
  };
  multRows('Android', 'A1', 'A4', 'F1');
  multRows('Android', 'A1', 'A4', 'FX');
  multRows('iOS', 'A1-ios', 'A4-ios', 'F2');
  multRows('iOS', 'A1-ios', 'A4-ios', 'FX-ios');
  L.push('');

  // --- open-device-server describe backend (FX Android) ---
  const fx = byId.get('FX');
  if (fx?.capture.describeSource) {
    L.push('## Android describe backend (FX open-device-server)');
    L.push('');
    const f1d = byId.get('F1')?.capture.describeSize;
    const fxd = fx.capture.describeSize;
    L.push(
      `- FX drove the Android hierarchy through the open-source on-device server: describe \`Source: ${fx.capture.describeSource}\`` +
        `${fxd ? ` (${fxd.bytes} B / ${fxd.tokens} tok on the Settings root)` : ''}.`,
    );
    if (f1d) {
      L.push(
        `- For comparison, the uiautomator/android-devtools path (F1, same emulator + screen) measured ${f1d.bytes} B / ${f1d.tokens} tok. ` +
          'The open-device-server tree is larger because it settles with waitForIdle and emits more per-node metadata; ' +
          'it trades a bigger single describe for the ~40% busy-UI `uiautomator dump` flakiness it removes.',
      );
    }
    L.push('');
  }

  // --- per-step cost profile ---
  L.push('## Per-step cost profile');
  L.push('');
  L.push(
    'Where the tokens go. Under the atomic path (A1 / A1-ios) each of the 10 steps pays for the action plus ' +
      "argent's auto-appended screenshot + element tree; under `run-script` the agent pays one describe for " +
      'orientation and one script round-trip whose result carries a single end-of-run auto-capture.',
  );
  L.push('');
  const profile = (label: string, atomic: string, fork: string): void => {
    const ma = m(atomic);
    const mf = m(fork);
    if (!ma && !mf) return;
    L.push(`- **${label}** — atomic (${atomic}): fixed ${num(fixedOf(atomic))} + flow ${num(ma?.flowAdded ?? null)} across ${num(rtOf(atomic))} round-trips = ${num(cachedOf(atomic))} cached. run-script (${fork}): fixed ${num(fixedOf(fork))} + flow ${num(mf?.flowAdded ?? null)} across ${num(rtOf(fork))} round-trips = ${num(cachedOf(fork))} cached.`);
  };
  profile('Android', 'A1', 'F1');
  profile('iOS', 'A1-ios', 'F2');
  L.push('');

  // --- caveats ---
  L.push('## Caveats');
  L.push('');
  L.push(
    `- **Approximate counter.** Token counts use ${meta.counter}${meta.counterApproximate ? ' (an approximation of Claude\'s tokenizer)' : ''}; absolute values shift under the authoritative Anthropic count_tokens API, but the fork-vs-upstream ratio is stable because both sides are counted identically.`,
  );
  L.push('- **Single scenario, single device class.** One 10-step Settings flow on one Android emulator (API 35) and one iOS 26.4 simulator. This is a mechanical payload measurement, not a task-success or latency benchmark.');
  L.push('- **iOS scenario is a navigation mirror.** iOS 26 simulator Settings exposes no shallow toggle switch and no describe-visible search field, so the Android "search + toggle Battery Saver" steps are realised on iOS as "navigate into a section + assert the new screen". The interaction shape the token benchmark measures (one agent action + one assert per logical step) is preserved; the deviation is documented in `scenario-ios.json`.');
  L.push('- **iOS accommodations.** argent `launch-app` returns init_failed on this host (the RN native-devtools dylib is not in the published package), so Settings is foregrounded via `simctl launch` and the flow resets to root by tapping the BackButton element; iOS taps are fire-and-forget (argent #547) so every tap is verified. These affect wall-clock reliability, not the measured token payloads.');
  L.push('- **run-sequence caveat carries to iOS.** A4 / A4-ios amortize best-case by issuing one `run-sequence` of blind coordinate taps; run-sequence\'s own description forbids dependent steps and it cannot re-describe mid-sequence, so it is argent\'s theoretical floor, reported as such — `run-script` reaches a comparable round-trip count while still observing and branching between steps.');
  L.push('- **Fork fixed context is the conservative choice.** F1/F2/FX count the run-script tool def and the `ui` `.d.ts` authoring surface in the fixed context, exactly as C1 counts the dsl `.d.ts`. Both are progressively loaded from the skill body under argent\'s real loading model, so including them overstates the fork\'s always-on cost rather than understating it.');
  const fxCav = byId.get('FX');
  if (fxCav) {
    L.push('- **FX differs from F1 on Android by scenario path, not shape.** The open-device-server accessibility tree flattens Settings search results into non-clickable StaticText + standalone Switch nodes, so FX navigates directly to the Battery Saver screen (rich selectors: `contains` / `caseInsensitive`) instead of F1\'s search-result tap. Same 10 logical steps and the same two round-trips, so billing stays comparable.');
    L.push('- **Integration packaging bug (worked around for FX).** On `integration/device-stream` @ its head, the open-device-server\'s `serverManifest()` and the android-devtools `helperManifest()` read the SAME bundled `packages/argent/assets/manifest.json`, which `bundle-tools.cjs` fills with the android-devtools (SnapshotInstrumentation) manifest — so an as-built `open-device-server` describe spawns the wrong instrumentation and fails with `Unknown method: getAccessibilityTree`, silently falling back to android-devtools. FX numbers were taken after correcting that bundled manifest to the device-control server in the bench clone (a build-asset fix, no source/commit change) and building + installing the device-control APK; with that, describe reports `Source: open-device-server`. This is a real Part-1 packaging defect to fix upstream (bundle the device-server manifest to its own path, or have `serverManifest()` read it).');
  }
  L.push('');

  return L.join('\n') + '\n';
}
