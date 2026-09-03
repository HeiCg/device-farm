# Scoreboard — open driver vs argent proprietary (as of 2026-09-03, pre-3f/3g/C.1 benches)

Source of truth: `2026-09-02-open-vs-proprietary-results-v4.md` (v4, v5, v6,
v7 sections), `2026-09-02-screen-graph-results.md` (Phase C pass 1). All
numbers like-for-like (same AVD bench-api35 API 35, same hold/duration, N=20
per verb, OFF→ON→OFF blocks, 0 errors / 0 masked fallbacks). Numbers from
the v6 run carry the host-swap caveat (18/19 GB used) and OFF-1/OFF-2 drift.

## Per-verb latency, p50 ms

| verb | proprietary (OFF) | open (ON) | status | source |
|---|---|---|---|---|
| gesture-pinch (300 ms) | 362 | 341 | open faster (0.93×) | v4 |
| gesture-swipe (250 ms) | 301 | 281 | open faster | v4 |
| await-screen-idle | 524 | 526 | equal | v4 |
| await-ui-element | 80 | 82 | equal | v4 |
| describe (idle) | 77–87 | 77–89 | equal; tokens identical 657/657 (o200k) | v4/v6 |
| paste | 78–101 | 63 | open faster (clipboard-unsupported cache) | v6 |
| gesture-tap | 53 | 61 | open +8 ms (UiAutomation inject; scrcpy path pending) | v6 |
| tap+describe, immediate read | 138 → 247/802 (unstable) | 286 → 185 | open ≈1.3× on a fresh host; cause of 286→185 unattributed | v5/v6 |
| tap+describe, settled read | proprietary has no settled mode | 684 → 833 (regressed, unexplained) | open-only feature | v5/v6 |

## Correctness / footprint

| dimension | proprietary | open |
|---|---|---|
| freshness of describe right after a navigating tap | 15–25 % (v5), 45–55 % (v6) | immediate 0 %; settled 95–100 % |
| fling fidelity vs proprietary (3 reliable cells) | — | 0.93 / 0.90 / 0.89 (±15 % pass) |
| host process per device | ~62 MB simulator-server | none (server on device) |
| closed binaries required | yes (Rust server, ADT apk, dylibs) | no |
| physical Android input | closed screen-sharing agent | UiAutomation today; scrcpy backend built, unbenched |

## Structural (screen-graph, Phase C pass 1 — tokens per agent step)

| config | tokens/step p50 | RTT/step |
|---|---|---|
| open, full describe (B2) | 629 | 2 |
| open + query/diff (O1) | 67 (0.107×) | 2 |
| open + screen graph, cold (O3) | 629 | 2 |
| open + screen graph, warm (O4) | 40 (0.064×) | 1 |

H1 PASS, H3 PASS, H2 FAIL on navigation-only tasks (re-stated over
same-screen steps in C.1), H4 NOT MEASURED (baseline oracle invalid; C.1).
The proprietary backend has no equivalent of O1/O4.

## Retractions so far
- v2 "open wins tap/pinch" — hold/duration artifacts (retracted in v3).
- v6 "R2 window prune explains tap+describe gain" — prune never fired.
- Phase C "H4 PASS vs B1 33 %" — harness artifact (retracted).

## Pending (blocked on host memory, then AVD queue C.1 → 3f → 3g)
- 3f bench: OFF / ON-uiautomation / ON-scrcpy — tap tail and per-event
  inject cost with the scrcpy backend.
- 3g: stage timings inside describe during transitions; popup/dialog
  window-filter safety; tap ordering fix.
- C.1: valid oracle, B1 baseline, H2 over same-screen steps, H4.
