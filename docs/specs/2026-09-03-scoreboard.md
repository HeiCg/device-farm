# Scoreboard — open driver vs argent proprietary (as of 2026-09-03, pre-3f/3g/C.1 benches)

Source of truth: `2026-09-02-open-vs-proprietary-results-v4.md` (v4, v5, v6,
v7 sections), `2026-09-02-open-vs-proprietary-results-v3.md` (fling
fidelity), `2026-09-02-screen-graph-results.md` (Phase C pass 1). Latency
numbers are like-for-like (same AVD bench-api35 API 35, same hold/duration,
N=20 per verb, OFF→ON→OFF blocks, 0 errors / 0 masked fallbacks). Numbers
from the v6 run carry the host-swap caveat (16 GB used per the report) and
OFF-1/OFF-2 drift. The screen-graph section does NOT share that methodology:
15 tasks × 3 reps (n=45 steps/config), no OFF/ON blocking, O3 success
97.8 %, one aborted re-run attempt (see its "Method & provenance").

## Per-verb latency, p50 ms

| verb | proprietary (OFF) | open (ON) | status | source |
|---|---|---|---|---|
| gesture-pinch (300 ms) | 355 | 329 | open faster (0.93×) | v4 |
| gesture-swipe (250 ms) | 298 | 278 | open faster | v4 |
| await-screen-idle | 515 | 478 | open faster at p50 (p95 524 vs 526, equal) | v4 |
| await-ui-element | 76 | 76 | equal | v4 |
| describe (idle) | 77 (v4) / 77–78 (v6) | 80 (v4) / 77 (v6) | equal; tokens identical 657/657 (o200k) | v4/v6 |
| paste | 78–101 | 63 | open faster (clipboard-unsupported cache) | v6 |
| gesture-tap | 53 | 61 | open +8 ms (UiAutomation inject; scrcpy path pending) | v6 |
| tap+describe, immediate read | ~138 (v5: 129/148) → 247/802 (v6, bimodal) | 286 (v5) → 185 (v6) | v5 measured 2.07× slower; v6 open is faster than both OFF readings but OFF is bimodal so no ratio is claimed; cause of 286→185 unattributed | v5/v6 |
| tap+describe, settled read | proprietary has no settled mode | 684 → 833 (regressed, unexplained) | open-only feature | v5/v6 |

## Correctness / footprint

| dimension | proprietary | open |
|---|---|---|
| freshness of describe right after a navigating tap | 15–25 % (v5), 45–55 % (v6) | immediate 0 %; settled 95–100 % |
| fling fidelity vs proprietary | — | 0.925 / 0.902 / 0.889 (±15 % pass; 3 of 6 cells reliable, 3 at the survivor-median floor) — v3 |
| host process per device | ~62 MB simulator-server | none (server on device) |
| closed binaries required | yes (`bin/simulator-server`, ADT apk, dylibs — LICENSE "proprietary binary components") | no |
| physical Android input | Android Studio's Apache-2.0 screen-sharing-agent (per 3f ticket; not benched) | UiAutomation today; scrcpy backend built, unbenched (v7) |

## Structural (screen-graph, Phase C pass 1 — tokens per agent step)

| config | tokens/step p50 | RTT/step |
|---|---|---|
| open, full describe (B2) | 629 | 2 |
| open + query/diff (O1) | 67 (0.107×) | 2 |
| open + screen graph, cold (O3) | 629 | 2 |
| open + screen graph, warm (O4) | 40 (0.064×) | 1 |

H1 PASS, H3 PASS, H2 FAIL on navigation-only tasks (re-stated over
same-screen steps in C.1), H4 NOT MEASURED (baseline oracle invalid; C.1).
No proprietary equivalent of O1/O4 was benched (B1/B2 are the only proprietary-path configs, and B1 is invalid).

## Retractions so far
- v2 "open wins tap/pinch" — hold/duration artifacts (retracted in v3).
- v6 "R2 window prune explains tap+describe gain" — prune never fired.
- CI run 4 "scrcpy tap 51 vs 52 beats proprietary" — tap never landed (0/20 effect); retracted 2026-09-03.
- Phase C "H4 PASS vs B1 33 %" — harness artifact (retracted).

## CI (GitHub Actions ubuntu-latest, KVM, x86_64, Android 14 API 34, swiftshader, animations off, N=20, p50/p95 ms) — run 33736918373

NOT comparable to the local arm64/HVF numbers above; only OFF vs ON within
this run is like-for-like. Single run. Adversarial review (2026-09-03)
findings applied below.

| verb | OFF-1 | ON-uiautomation | ON-scrcpy | OFF-2 | status |
|---|---|---|---|---|---|
| gesture-swipe | 306/317 | 288/326 | **258/259** | 297/303 | open wins (scrcpy) |
| gesture-pinch | 346/363 | 345/395 | **307/310** | 348/357 | open wins (scrcpy) |
| paste | 494/1241 | **288/756** | 317/760 | 434/1109 | open wins — open-server property (one typeText RPC vs clipboard + `adb shell input keyevent` spawn); ASCII-only, emoji falls back |
| cold start median (N=3) | 774 | 360 | **386** | 767 | open wins — open-server property (backend restart → first describe; no install either side; scrcpy not included) |
| await-screen-idle | 490/529 | 499/537 | 498/527 | 490/532 | equal |
| await-ui-element | 72/76 | 76/76 | 72/76 | 72/76 | equal |
| describe (idle) | 72/76 | 108/132 | 112/132 | 68/72 | **open loses**; server stages ≈ 22 ms, ~90 ms is host/transport in the open path |
| gesture-tap | 52/53 | 78/148 | 51/52 | 52/53 | **NOT REPORTED**: ON-scrcpy tap failed its on-device effect check in the same run (0/20 navigations, zero-pixel diff; hidden by `continue-on-error`) — timed injections that did not land |
| tap+describe | 568/1006 | 595/661 (settle:false) | 432/810 (settle:false) | 565/1151 | **NOT REPORTED** for ON-scrcpy (same reason); ON-uiautomation 595 vs OFF 565–568 ≈ equal |
| tokens (describe) | 657 | 657 | 657 | 657 | identical |

Review caveats: `fastInjectFallbacks == 0` proves no exception, not
delivery; the gesture-parity gate compares a shared constant (cannot detect
backend timeline drift; the in-script assert is skipped under BENCH_ONLY);
fling A/B scrcpy vs UiAutomation: 2 of 4 informative cells at 0.44× and
0.70× (fling fidelity NOT unchanged); block JSONs missing from this run's
artifact (dot-dir excluded; fixed later).

## Pending (blocked on host memory, then AVD queue C.1 → 3f → 3g)
- 3f bench: OFF / ON-uiautomation / ON-scrcpy — tap tail and per-event
  inject cost with the scrcpy backend.
- 3g: stage timings inside describe during transitions; popup/dialog
  window-filter safety; tap ordering fix.
- C.1: valid oracle, B1 baseline, H2 over same-screen steps, H4.
