# Results (CI): screen-graph Phase D.2 — honest routing (settled recording, measured RPCs)

Phase D.2 closes the D.1 review caveats (`2026-09-03-review-d1-findings.md`,
ACCEPT-WITH-CAVEATS). Routing was already real in D.1 (45/60 taps routed); D.2
removes the transient-node race that left 15 no-routes, replaces the two modelled
statistics with measured ones, and makes the accounting honest end to end.

- **HIGH-1 — settled after-fingerprint.** Recording keyed the after-node on the
  tap outcome's short-quiet fingerprint, which can be captured mid-transition and
  mint a transient node (D.1 held two byte-identical "Network & internet:
  Internet" nodes, one reached by BOTH the Network tap and the Sound tap, plus a
  root→root edge). Recording now reads the after-identity from a **settled**
  `getState` (waits for idle), keys node and content from that one snapshot, and
  records an edge only when the settled id changed OR the outcome reported no
  change. Result: the store has **0 duplicate screens** and O5 routes **60/60**.
- **HIGH-2 — measured RPCs.** `navigate-to` counts its real device RPCs; the
  bench publishes O5's measured RPCs per routed tap (**7**), replacing the
  modelled "2", and `actionRttMs` per config.
- **M1–M4, L1–L4** — bootstrap count read from JSON, out-degree reported with H3,
  host `H_id` golden guard, `UNVERIFIED` pre-flight gate, `infraPreAction` given a
  real setter, O3 relabelled graph-blind, `recordMs` per step published.

Every number below is **regenerated from the run artifact JSON**
(`bench-sg-2026-09-05T11-57-59-850Z.json`); the independent recompute reproduces
the harness-emitted `results-ci.md` in the same artifact to the digit.

## Run (HeiCg/argent, workflow `bench-open-vs-proprietary.yml`)

| Purpose | Run id | URL |
|---|---|---|
| **Matrix (FINAL — authoritative)** | **33964414774** | https://github.com/HeiCg/argent/actions/runs/33964414774 |

Branches: bench tree `feat/screen-graph-d` @ `59791d460`; workflow
`feat/bench-ci-d` @ `77cd4b9a`. 7 configs × 20 tasks × 5 reps = 100 task-runs per
config. Tokenizer js-tiktoken `o200k_base`. `skipped: {}`. Bootstrap
`B = 10000` (read from `env.bootstrapB`), seed `0x5eedc0de`.

## Pre-flight gate (full tree, destination presence required, UNVERIFIED gates)

Quoted from run 33964414774 `logs/sg-preflight.log`:

```
PROBLEM needles: 0 — none
[preflight] GATE PASS: PROBLEM needles: 0
```

Phase D.2 L1: a navigating task whose destination is unreachable in pre-flight is
now counted as **UNVERIFIED** and gates (fails if any remains after retries), not
silently reported "ok". The first D.2 attempt (run 33963806666) correctly failed
here on `settings-display` — a FALSE negative: its needle "Brightness level" is
genuinely on the Display screen, but the pre-flight swiped with a momentum fling
that reached Display only ~1/6. The pre-flight now uses the SAME controlled
`gesture-swipe` (durationMs 250) the matrix runs, with attempts raised to 10, so a
reachable destination verifies and UNVERIFIED means genuinely unreachable. This
run gates clean.

## Per-config — success (full 100 denominator), tokens/step, RTT

| Config | success | cluster 95% (n=20) | Wilson (n=100) | fail (L/A/O/T/N) | nsteps | tok/step o200k p50 | tok/step o200k p95 | tok/step chars/4 p50 | obs RTT ms/step p50 | RTT count/step p50 |
|---|---|---|---|---|---|---|---|---|---|---|
| B1 (argent proprietary) | 98 % (98/100) | [95, 100] | [93, 99] | 2 (2/0/0/0/0) | 155 | 657 | 4161 | 473 | 447 | 2 |
| B2 (open, no graph) | 99 % (99/100) | [97, 100] | [95, 100] | 1 (0/0/0/0/1) | 155 | 627 | 4510 | 447 | 90 | 2 |
| O1 (+ query/diff) | 99 % (99/100) | [97, 100] | [95, 100] | 1 (0/0/0/0/1) | 155 | 179 | 515 | 103 | 4 | 2 |
| O2 (+ outcomes) | 100 % (100/100) | [100, 100] | [96, 100] | 0 | 155 | 54 | 515 | 33 | 3 | 2 |
| O3 (+ graph, graph-blind) | 100 % (100/100) | [100, 100] | [96, 100] | 0 | 155 | 598 | 4510 | 397 | 86 | 2 |
| O4 (graph, warm) | 99 % (99/100) | [97, 100] | [93, 99] | 1 (0/0/0/0/1) | 155 | 22 | 114 | 20 | 43 | 1 |
| O5 (+ navigate-to) | 99 % (99/100) | [97, 100] | [95, 100] | 1 (0/0/0/0/1) | 155 | 28 | 114 | 24 | 46 | 1 |

Token rows are **per-step observation payload**, launch step excluded (155 of 255
steps), oracle assertion query excluded (review label). O3 is **graph-blind** (L3):
it records into the store but never consults it (`config !== "O3"` guard), so it
pays a full describe every step — the intended cold contrast for H3, but it is a
graph-blind config, not an empty store.

### Measured cost per config (phase D.2 HIGH-2 / L4)

RTT count/step above is a logical count; these are the **measured** wall/RPC
figures. `recordMs` is the graph-recording wall time per step (settled getState +
store write), off the agent's timed tool cost — it attributes the ~1 s open-config
gap vs B1 the review asked for (D1-L4).

| Config | action wall ms/step p50 | recordMs/step p50 | measured RPCs / routed tap p50 |
|---|---|---|---|
| B1 | 190 | 0 (no open-server recording) | — |
| B2 | 1406 | 387 | — |
| O1 | 1441 | 368 | — |
| O2 | 1465 | 361 | — |
| O3 | 1381 | 355 | — |
| O4 | 1359 | 374 | — |
| O5 | 1553 | 8 | **7** (n=60 routed taps) |

O5's measured RPCs per routed tap is **7** — navigate-to's getState + getInfo + per
step (query + tap + getState) plus the bench's await-idle + queryPresent. This
replaces the D.1 modelled "2". O5's low recordMs (8) is because its known-target
taps go through `navigate-to`, not the recorded gesture-tap path; the store was
populated by O3/O4 earlier in the run.

## O5 navigate-to structure (structured records, ALL 60 attempted known-target taps)

| Outcome | Count |
|---|---|
| **routed** (reached, target present) | **60** |
| mis-landed | 0 |
| diverged-after-tap | 0 |
| no-route | 0 |
| fallbacks | 0/60 |

No-route split: ambiguous-target 0, no-known-path 0. Diverged split: all 0.
`recordSkippedNoIdHash` **0**.

- **O5-pure coverage: 60 of 60 known-target taps routed** — up from 45/60 in D.1.
  The 15 D.1 no-routes (all the `Internet` navTarget, indexed by two H_id nodes for
  one screen) are gone: HIGH-1's settled recording gives the Network & internet
  screen a single H_id, so `Internet` is now indexed by exactly one node.
- **Mis-lands: 0** — at or under the ≤ 2 bar. **Coverage 60/60 ≥ 30** — the bar is
  met.

| O5 row | success | tok/step o200k p50 | measured RPC/routed tap p50 | N |
|---|---|---|---|---|
| **O5-mixed** (all runs, the published O5) | 99/100 = 99 % · cluster [97, 100] · Wilson [95, 100] | 28 | — | 100 runs |
| **O5-pure** (runs whose every known-target tap routed) | 50/50 = 100 % [93, 100] | 29 | 7 | 50 runs |

**M4 label:** 50 of O5's 100 runs contain NO known-target tap (the 5 chrome + 5
same-screen tasks), so on those O5 is identical to O4; O5-pure is the 10 settings
navigation tasks (the same-screen and chrome tasks excluded), all of which routed.
O5-pure is a task-level subset, not an outcome-selected contrast, and H4 for O5 is
a low-power test of routing.

## Hypotheses (run 33964414774)

| Hypothesis | Statistic | Target | Measured | Verdict |
|---|---|---|---|---|
| H1 | O1 tokens/step vs B2, o200k p50, n=155/155 | ≤ 0.5× | 179/627 = **0.285×** | **PASS** |
| H2 (all steps) | B2 − O2 RTT-count/step p50, all steps | ≥ 1 | 2 − 2 = **0** | **FAIL** (structural) |
| H2 (same-screen) | B2 − O2 RTT-count/step p50, same-screen n=50/50 | ≥ 1 | 2 − 1 = **1** | **PASS** |
| H3 | O4 warm / O3 cold tokens/step, o200k p50, n=153/155 | ≤ 0.2× | 22/598 = **0.037×** | **PASS** |

**H1 label:** the ratio is not stable across phases (0.285× at C.4, 0.220× at
D/D.1, 0.285× here) — it moves with O1's selector policy, not the needle; ≤ 0.5×
holds in all. **H3 label:** warm observation is a ≤ 6-affordance graph summary,
cold is a full screen render, so the ratio tracks graph out-degree (M2). This
store: **10 nodes, 19 edges, max out-degree 14, mean 1.9** (`env.settingsGraph`).

**H4 — success non-inferior to each baseline**, full 100 denominator, paired
task-cluster bootstrap of Δ = config − baseline, B = 10000, inferior at > 5 pp
below:

| Baseline | Baseline success (cluster / Wilson) | Paired Δ verdict (O1..O5) |
|---|---|---|
| B1 (98 %, 98/100) [95,100]/[93,99] | | **PASS — none inferior.** O1 +1 [−2,4] · O2 +2 [0,5] · O3 +2 [0,5] · O4 +1 [−2,4] · **O5 +1 [−2,4]** |
| B2 (99 %, 99/100) [97,100]/[95,100] | | **PASS — none inferior.** O1 +0 [0,0] · O2 +1 [0,3] · O3 +1 [0,3] · O4 +0 [−3,3] · **O5 +0 [0,0]** |

Every open config, O5 included, is non-inferior to both baselines while O2/O4/O5
spend an order of magnitude fewer observation tokens. Note (review D1-L5): "13×
fewer tokens" is a 13× smaller observation PAYLOAD; the tap target still comes from
a live `locate`, symmetric across configs, so H1/H3 stand.

## Per-task success matrix (run 33964414774)

`Y` oracle met · `N` oracle unmet · `L` locate-failed (aborted).

| Task | B1 | B2 | O1 | O2 | O3 | O4 | O5 |
|---|---|---|---|---|---|---|---|
| settings-network | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| settings-connected | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| settings-apps | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| settings-notifications | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| settings-battery | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| settings-storage | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| settings-sound | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| settings-display | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YNYYY | YYYYY |
| settings-network-internet | YYLYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| settings-battery-then-back | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| chrome-open-page | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| chrome-heading-word | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| chrome-example-word | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| chrome-scroll-body | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| chrome-scroll-doc | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| same-settings-search | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| same-sound-noop | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| same-chrome-noop | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| same-display-slider | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| same-apps-noop | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |

The scattered failures the D.1 review noted are gone this run: the only non-Y cells
are B1 `settings-network-internet` rep 2 (one live locate-fail) and O4
`settings-display` rep 2 (one flaky fling). Both are single-rep, config-neutral.

## Fixes verified on the run's own store

- **0 duplicate screens** (`ScreenGraphStore.duplicateScreens()` invariant): no two
  nodes share compact + resourceIds + stateHash. The D.1 transient
  "Network & internet: Internet" pair is gone.
- **"Internet" indexed by exactly 1 node**; **0 nodes keyed by a structural hash**;
  `recordSkippedNoIdHash` 0. The store has 10 nodes / 19 edges.
- **60/60 routed, 0 diverged, 0 mis-landed** — Fix A + HIGH-1 together.
- Unit tests (run in the worktree before push): tsc clean; **236 pass / 2
  pre-existing skips**, including `ScreenGraphStore.duplicateScreens()` (the D.1
  33958064084 store violates it, a clean store does not) and the host `identityHash`
  golden guard.

## M3 — H_id test coverage (partially closed)

The host `identityHash` now has a golden regression guard
(`screen-hash.test.ts`), and this doc no longer cites host H_id tests as evidence
of DEVICE H_id stability. Still open: a Kotlin `ScreenHash.identity` unit test and
a host/device cross-check on a captured tree. Both need Gradle-test infrastructure
CI does not run and a captured hierarchical tree carrying a device `idHash`, which
no artifact provides. Left as a separate infra follow-up rather than shipped
unverifiable. Device H_id stability is instead evidenced empirically here: the
store has one H_id per screen and 0 duplicates.

## Acceptance check

| Criterion | Status |
|---|---|
| HIGH-1 duplicate node gone; settled recording; invariant test | **PASS** (0 duplicate screens) |
| HIGH-2 measured O5 RPCs published, modelled "2" dropped | **PASS** (7 measured RPCs/routed tap) |
| M1 bootstrap read from JSON | **PASS** (`env.bootstrapB` = 10000) |
| M2 out-degree reported with H3 | **PASS** (10 nodes / 19 edges / max 14 / mean 1.9) |
| M3 device H_id test | **PARTIAL** (host golden + doc wording; Kotlin/cross-check open) |
| M4 O5-pure labelled task-subset; H4 low-power | **PASS** (labelled) |
| L1 UNVERIFIED gates | **PASS** (gate clean after the swipe fix) |
| L2 infraPreAction has a setter | **PASS** (`erroredTaskRecord`) |
| L3 O3 graph-blind | **PASS** (relabelled) |
| L4 recordMs published | **PASS** (per-config table) |
| results doc regenerated from JSON; branches pushed; run URL | **PASS** |

## Superseded D.1 numbers (from run 33958064084)

| D.1 number | Why superseded |
|---|---|
| O5 routed 45/60 (15 no-route "ambiguous target") | The 15 were the `Internet` navTarget indexed by TWO H_id nodes for one screen — a transient node minted by a premature after-fingerprint. HIGH-1's settled recording gives one H_id; O5 now routes **60/60**. |
| "0 pollutant nodes" (D.1 doc) | False — the store held two byte-identical "Network & internet: Internet" nodes (D1-H1). Withdrawn; this run has **0 duplicate screens**, verified by the invariant. |
| O5 "honest RTT 2" / O5-pure "RTT-count 2" | Modelled; understated the router's real RPCs ~3×. Replaced by the **measured 7 RPCs per routed tap** (HIGH-2). |
| "20 000 resamples" (D.1 doc) | The code does 10 000; the doc now reads `env.bootstrapB`. |
| "the H_id unit tests pass" as device evidence | The tests exercise a host twin; withdrawn as device evidence (M3). |
| per-config success O5 99 (D.1) | Same value, but on a store with a duplicate node; re-measured on a clean store this run. |

## Files changed (bench tree `feat/screen-graph-d`, over D.1 @ 757956c57 → 59791d460)

- `src/utils/screen-graph-open-wiring.ts` — settled after-read + edge-record guard (HIGH-1); `recordMs` accumulator (L4).
- `src/tools/navigate-to/index.ts` — RPC-counting proxy + `rpcCount` (HIGH-2).
- `src/screen-graph/store.ts` — `duplicateScreens()` invariant (HIGH-1).
- `scripts/bench-screen-graph.ts` — capture `rpcCount`/`recordMs`/`measuredRpc`; publish measured RPC + actionRttMs; `infraPreAction` setter (L2); `env.bootstrapB` (M1); `env.settingsGraph` out-degree (M2).
- `src/screen-graph/bench/preflight.ts` + `scripts/bench-preflight.ts` — UNVERIFIED gates (L1); controlled `gesture-swipe` + attempts 10 so reachable destinations verify.
- Tests: `screen-graph-store-migration.test.ts` (duplicate-screen invariant); `screen-hash.test.ts` (host `identityHash` golden).
