# Ticket: consolidate 3h + 3i + 3j into `feat/android-open-server`, one CI branch, one scoreboard run

Repo: ARGENT FORK. Preconditions (do not start before all three are true):
- `feat/bench-ci-3h` has a GREEN run with device tests enforced (3h finish).
- `feat/bench-ci-3j` has the redir-by-default-on-emulator run reported (3j item 3d).
- `feat/bench-ci-c4` matrix run reported (C.4) — screen-graph is a separate job,
  consolidate its CI changes too but its code stays on `feat/screen-graph-c4`.

Worktree: `argent-fork` (main fork worktree) or a new `argent-final` under the
scratchpad; never the per-phase worktrees. NO local emulator/adb; CI only.

## Work
1. Code: fast-forward/merge `feat/android-open-server-p3h` and
   `feat/android-open-server-p3j` (which contains p3i) into `feat/android-open-server`.
   Resolve conflicts preferring the tested behaviour of each phase; rerun the
   full unit suite (tool-server, configuration-core, android-device-server
   unit tests) and the goldens; APK versionCode bumped once.
2. CI: merge `feat/bench-ci-3h`, `feat/bench-ci-3j`, `feat/bench-ci-c4` into
   `feat/bench-ci`. The workflow must keep: readiness gate before device tests
   and before every block; `set -o pipefail` on every piped step; device-test
   step `id: devtest` + `continue-on-error: true` + final `if: always()` gate
   that fails the job on `steps.devtest.outcome == 'failure'`; pre-flight
   needle gate over the full tree; screen-graph checkout pinned to the
   `feat/screen-graph-c4` head; `BENCH_REPS=5`; redir transport enabled for
   ON blocks; async effect oracle; all four blocks always run; merge fails at
   the end on any ON-block gate. Diff the merged yml against each source and
   list what each contributed.
3. One run of `-f suite=both` on `feat/bench-ci`. It must be GREEN (device tests
   enforced and passing). If red, fix the cause on the consolidated branches and
   rerun; never loosen a gate.
4. Report, from that single run id: the full latency table (every verb, all four
   blocks, p50/p95, N), effectZero/originLost per block, fallbacks per block,
   transport per block, tokens, fidelity, cold start, host RSS, OFF-1 vs OFF-2
   drift per verb, fling A/B gate, 3g stage table, same-sample describe
   decomposition; and the screen-graph per-config table with Wilson intervals,
   O5-pure/O5-mixed, H1–H4. Write it to
   `/Users/heicg/Desktop/projects/device-farm/docs/specs/2026-09-03-open-vs-proprietary-results-final-ci.md`
   (working tree only; do not commit in device-farm). Push the fork branches.

## Acceptance
Green run URL; every number labelled with statistic/block/N/run id; no blended
runs; a list of gates active in the workflow with the yml line for each.
