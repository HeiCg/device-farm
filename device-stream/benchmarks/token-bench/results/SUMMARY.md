# Token benchmark — fork run-script vs upstream argent (summary)

Interpretation of the Layer-1 mechanical capture in `RESULTS.md`. This document draws the comparisons the raw results file deliberately does not. Numbers are the transcript-token cost of the same 10-step Settings interaction driven three ways on each platform: argent atomic tools per call (A1 / A1-ios), argent `run-sequence` best-case amortization (A4 / A4-ios), and the fork `run-script` tool that collapses the whole flow into one agent-authored call (F1 Android / F2 iOS).

## Method (one paragraph)

A harness acts as an MCP client, drives each server against a real device, and sizes every byte that would enter a model's context — no LLM in the loop. `billedCached = fixed + Σ added` is the perfect-prompt-caching lower bound (it favours the tool-per-call servers); `billedUncached` is the no-caching quadratic upper bound. Tokens are counted with `js-tiktoken/o200k_base` (an APPROXIMATION — not Claude's tokenizer; set ANTHROPIC_API_KEY to recount via the Anthropic count_tokens API). Fork and upstream share base commit a2ed83e0; the upstream `tools/list` is byte-identical at that base and at the original benchmark SHA b835de2, so the pre-existing A-config Android numbers stand unchanged (see RESULTS.md fairness note).

## Side-by-side

### Android

| config | what | fixed | billedCached | billedUncached | round-trips | live |
|--------|------|------:|-------------:|---------------:|------------:|:----:|
| A1 | argent, defaults (auto-describe + auto-screenshot on) | 14977 | 23690 | 241547 | 12 | yes |
| A4 | argent run-sequence (10 steps as one sequence call) | 14977 | 16133 | 16133 | 1 | yes |
| F1 | argent fork run-script, Android (1 orientation describe + 1 run-script round-trip) | 16106 | 18167 | 35243 | 2 | yes |
| FX | argent integration branch run-script, Android (both flags on: run-script + open-device-server) | 16877 | 20734 | 39887 | 2 | yes |

### iOS simulator

| config | what | fixed | billedCached | billedUncached | round-trips | live |
|--------|------|------:|-------------:|---------------:|------------:|:----:|
| A1-ios | argent defaults, iOS simulator (auto-describe + auto-screenshot on) | 14977 | 28230 | 275460 | 12 | yes |
| A4-ios | argent run-sequence, iOS simulator (10 steps as one sequence call) | 14977 | 16887 | 16887 | 1 | yes |
| F2 | argent fork run-script, iOS simulator (1 orientation describe + 1 run-script round-trip) | 16106 | 19321 | 36958 | 2 | yes |
| FX-ios | argent integration branch run-script, iOS simulator (both flags on; open-device-server is Android-only) | 16877 | 20096 | 38506 | 2 | yes |

## Multipliers (lower is cheaper for the fork run-script path)

How many times more transcript tokens the upstream path costs than the fork `run-script` path for the same flow. `>1×` means the fork is cheaper by that factor. `F` = the run-script config on each row (F1/F2 = standalone run-script fork; FX/FX-ios = the integration branch with both flags on).

| platform | fork config | metric | upstream A1 ÷ F | upstream A4 ÷ F |
|----------|-------------|--------|----------------:|----------------:|
| Android | F1 | billedCached | 1.30× | 0.89× |
| Android | F1 | billedUncached | 6.85× | 0.46× |
| Android | F1 | round-trips | 6.00× | 0.50× |
| Android | FX | billedCached | 1.14× | 0.78× |
| Android | FX | billedUncached | 6.06× | 0.40× |
| Android | FX | round-trips | 6.00× | 0.50× |
| iOS | F2 | billedCached | 1.46× | 0.87× |
| iOS | F2 | billedUncached | 7.45× | 0.46× |
| iOS | F2 | round-trips | 6.00× | 0.50× |
| iOS | FX-ios | billedCached | 1.40× | 0.84× |
| iOS | FX-ios | billedUncached | 7.15× | 0.44× |
| iOS | FX-ios | round-trips | 6.00× | 0.50× |

## Android describe backend (FX open-device-server)

- FX drove the Android hierarchy through the open-source on-device server: describe `Source: open-device-server` (4307 B / 1916 tok on the Settings root).
- For comparison, the uiautomator/android-devtools path (F1, same emulator + screen) measured 1895 B / 657 tok. The open-device-server tree is larger because it settles with waitForIdle and emits more per-node metadata; it trades a bigger single describe for the ~40% busy-UI `uiautomator dump` flakiness it removes.

## Per-step cost profile

Where the tokens go. Under the atomic path (A1 / A1-ios) each of the 10 steps pays for the action plus argent's auto-appended screenshot + element tree; under `run-script` the agent pays one describe for orientation and one script round-trip whose result carries a single end-of-run auto-capture.

- **Android** — atomic (A1): fixed 14977 + flow 8713 across 12 round-trips = 23690 cached. run-script (F1): fixed 16106 + flow 2061 across 2 round-trips = 18167 cached.
- **iOS** — atomic (A1-ios): fixed 14977 + flow 13253 across 12 round-trips = 28230 cached. run-script (F2): fixed 16106 + flow 3215 across 2 round-trips = 19321 cached.

## Caveats

- **Approximate counter.** Token counts use js-tiktoken/o200k_base (an approximation of Claude's tokenizer); absolute values shift under the authoritative Anthropic count_tokens API, but the fork-vs-upstream ratio is stable because both sides are counted identically.
- **Single scenario, single device class.** One 10-step Settings flow on one Android emulator (API 35) and one iOS 26.4 simulator. This is a mechanical payload measurement, not a task-success or latency benchmark.
- **iOS scenario is a navigation mirror.** iOS 26 simulator Settings exposes no shallow toggle switch and no describe-visible search field, so the Android "search + toggle Battery Saver" steps are realised on iOS as "navigate into a section + assert the new screen". The interaction shape the token benchmark measures (one agent action + one assert per logical step) is preserved; the deviation is documented in `scenario-ios.json`.
- **iOS accommodations.** argent `launch-app` returns init_failed on this host (the RN native-devtools dylib is not in the published package), so Settings is foregrounded via `simctl launch` and the flow resets to root by tapping the BackButton element; iOS taps are fire-and-forget (argent #547) so every tap is verified. These affect wall-clock reliability, not the measured token payloads.
- **run-sequence caveat carries to iOS.** A4 / A4-ios amortize best-case by issuing one `run-sequence` of blind coordinate taps; run-sequence's own description forbids dependent steps and it cannot re-describe mid-sequence, so it is argent's theoretical floor, reported as such — `run-script` reaches a comparable round-trip count while still observing and branching between steps.
- **Fork fixed context is the conservative choice.** F1/F2/FX count the run-script tool def and the `ui` `.d.ts` authoring surface in the fixed context, exactly as C1 counts the dsl `.d.ts`. Both are progressively loaded from the skill body under argent's real loading model, so including them overstates the fork's always-on cost rather than understating it.
- **FX differs from F1 on Android by scenario path, not shape.** The open-device-server accessibility tree flattens Settings search results into non-clickable StaticText + standalone Switch nodes, so FX navigates directly to the Battery Saver screen (rich selectors: `contains` / `caseInsensitive`) instead of F1's search-result tap. Same 10 logical steps and the same two round-trips, so billing stays comparable.
- **Integration packaging bug (worked around for FX).** On `integration/device-stream` @ its head, the open-device-server's `serverManifest()` and the android-devtools `helperManifest()` read the SAME bundled `packages/argent/assets/manifest.json`, which `bundle-tools.cjs` fills with the android-devtools (SnapshotInstrumentation) manifest — so an as-built `open-device-server` describe spawns the wrong instrumentation and fails with `Unknown method: getAccessibilityTree`, silently falling back to android-devtools. FX numbers were taken after correcting that bundled manifest to the device-control server in the bench clone (a build-asset fix, no source/commit change) and building + installing the device-control APK; with that, describe reports `Source: open-device-server`. This is a real Part-1 packaging defect to fix upstream (bundle the device-server manifest to its own path, or have `serverManifest()` read it).

